import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type ItemFields, keyOf, parseFeed, REQUIRED_FIELDS } from "./feed";

const DEFAULT_COLLECTION = "feed_items";
const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 30;
const CRON_TASK = "sync";
/**
 * Each run reads one feed, taking them in turn. Feeds change slowly, and
 * YouTube refuses clients that ask too often.
 */
const CRON_SCHEDULE = "*/30 * * * *";
/** KV key: index of the feed the next run reads. */
const NEXT_FEED_KEY = "state:nextFeed";
/**
 * Time limit for one scheduled run. The host's default is 5 seconds, which
 * a deployed run can exceed when the database is far away.
 */
const CRON_TIMEOUT_MS = 120_000;
/** How many existing entries to check against, newest first. */
const EXISTING_LIMIT = 100;
/**
 * How many items to save or publish on each run. On a deployed site one
 * save and publish can take several seconds, and the Cloudflare sandbox
 * allows few subrequests per invocation; the rest wait for the next run.
 */
const MAX_PER_RUN = 1;

/**
 * What the plugin remembers about an item it has saved, keyed by a hash of
 * the item id. It is what stops an item deleted in the admin from coming back.
 */
interface SyncedItem {
	contentId: string;
	postedAt: string;
}

interface Existing {
	id: string;
	status: string;
	createdAt: string;
}

interface Settings {
	feedUrls: string[];
	limit: number;
	includeShorts: boolean;
	collection: string;
}

type SyncResult =
	| {
			status: "ok";
			feed: string;
			created: number;
			published: number;
			duplicatesRemoved: number;
			remaining: number;
	  }
	| { status: "not_configured" }
	| { status: "collection_invalid"; collection: string; problems: string[] }
	| { status: "fetch_failed"; feed: string; httpStatus: number };

async function scheduleSync(ctx: PluginContext) {
	await ctx.cron?.schedule(CRON_TASK, { schedule: CRON_SCHEDULE });
}

/** The feed URLs in the setting, one per line; lines that are not http(s) URLs are skipped. */
export function feedUrlsOf(value: unknown): string[] {
	if (typeof value !== "string") return [];
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => URL.canParse(line) && /^https?:$/.test(new URL(line).protocol));
}

/** The settings, or null while no usable feed URL is set. */
async function readSettings(ctx: PluginContext): Promise<Settings | null> {
	const feedUrls = feedUrlsOf(await ctx.settings.get("feed_urls"));
	if (feedUrls.length === 0) return null;
	const limit = Number(await ctx.settings.get("limit"));
	const collection = (await ctx.settings.get<string>("collection"))?.trim();
	return {
		feedUrls,
		limit: Number.isInteger(limit) && limit >= 1 && limit <= MAX_LIMIT ? limit : DEFAULT_LIMIT,
		includeShorts: (await ctx.settings.get<boolean>("include_shorts")) === true,
		collection: collection || DEFAULT_COLLECTION,
	};
}

/** Problems that would stop the plugin writing to the collection, if any. */
async function collectionProblems(ctx: PluginContext, slug: string): Promise<string[]> {
	const collection = await ctx.schema?.getCollection(slug);
	if (!collection) return [`collection "${slug}" does not exist`];
	const types = new Map(collection.fields.map((field) => [field.slug, field.type]));
	return Object.entries(REQUIRED_FIELDS).flatMap(([slug, type]) => {
		const actual = types.get(slug);
		if (!actual) return [`missing field "${slug}" (${type})`];
		return actual === type ? [] : [`field "${slug}" is ${actual}, expected ${type}`];
	});
}

/**
 * Entries already in the collection, grouped by the item they hold. A run
 * can be cut off between saving an entry and remembering it, so this, not
 * plugin storage, is what decides whether an item is already saved.
 */
async function existingByItemId(ctx: PluginContext, collection: string) {
	const { items } = await ctx.content!.list(collection, { limit: EXISTING_LIMIT });
	const byId = new Map<string, Existing[]>();
	for (const item of items) {
		const itemId = item.data.item_id;
		if (typeof itemId !== "string") continue;
		const list = byId.get(itemId) ?? [];
		list.push({ id: item.id, status: item.status, createdAt: item.createdAt });
		byId.set(itemId, list);
	}
	return byId;
}

/** The entry to keep among copies of one item: a published one, else the oldest. */
function keeperOf(copies: Existing[]): Existing {
	const sorted = [...copies].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return sorted.find((copy) => copy.status === "published") ?? sorted[0]!;
}

async function publish(ctx: PluginContext, collection: string, id: string): Promise<boolean> {
	try {
		const versioned = await ctx.content!.getVersioned!(collection, id);
		if (!versioned) return false;
		if (versioned.item.status !== "published") {
			await ctx.content!.publish!(collection, id, { _rev: versioned._rev });
		}
		return true;
	} catch (error) {
		ctx.log.error("Saved a feed item but could not publish it", {
			contentId: id,
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

/** The newest items the settings ask for. */
function wanted(items: ItemFields[], settings: Settings): ItemFields[] {
	return items
		.filter((item) => settings.includeShorts || item.kind !== "short")
		.slice(0, settings.limit);
}

async function sync(ctx: PluginContext): Promise<SyncResult> {
	const settings = await readSettings(ctx);
	if (!settings) return { status: "not_configured" };
	const { collection } = settings;

	const problems = await collectionProblems(ctx, collection);
	if (problems.length > 0) {
		ctx.log.warn("RSS Feed cannot write to the collection", { collection, problems });
		return { status: "collection_invalid", collection, problems };
	}

	const turn = Number(await ctx.kv.get(NEXT_FEED_KEY)) || 0;
	const feed = settings.feedUrls[turn % settings.feedUrls.length]!;
	await ctx.kv.set(NEXT_FEED_KEY, (turn + 1) % settings.feedUrls.length);

	// YouTube's feeds sometimes answer 404 or 500 for a while. Nothing is
	// changed then; this feed is tried again on its next turn.
	const response = await ctx.http!.fetch(feed, {
		headers: { accept: "application/atom+xml, application/rss+xml, application/xml, text/xml" },
	});
	if (!response.ok) {
		ctx.log.warn("Feed request failed", { feed, status: response.status });
		return { status: "fetch_failed", feed, httpStatus: response.status };
	}
	const items = wanted(parseFeed(await response.text(), feed), settings);
	const keys = await Promise.all(items.map((item) => keyOf(item.item_id)));

	const synced = ctx.storage.items!;
	const [existing, remembered] = await Promise.all([
		existingByItemId(ctx, collection),
		synced.getMany(keys),
	]);

	// Copies left by runs that were cut off: keep one, move the rest to the trash.
	let duplicatesRemoved = 0;
	for (const copies of existing.values()) {
		if (copies.length < 2) continue;
		const keep = keeperOf(copies);
		for (const copy of copies) {
			if (copy === keep) continue;
			if (await ctx.content!.delete!(collection, copy.id)) duplicatesRemoved++;
		}
		copies.splice(0, copies.length, keep);
	}

	let budget = MAX_PER_RUN;
	let published = 0;

	// Saved earlier but never published.
	for (const [i, item] of items.entries()) {
		if (budget === 0) break;
		const entry = existing.get(item.item_id)?.[0];
		if (!entry || entry.status === "published") continue;
		budget--;
		if (await publish(ctx, collection, entry.id)) published++;
		if (!remembered.has(keys[i]!)) {
			await synced.put(keys[i]!, { contentId: entry.id, postedAt: item.posted_at } satisfies SyncedItem);
		}
	}

	// Not saved yet, and not deleted in the admin after an earlier save.
	const pending = items.flatMap((item, i) =>
		!existing.has(item.item_id) && !remembered.has(keys[i]!) ? [{ item, key: keys[i]! }] : [],
	);
	let created = 0;
	for (const { item, key } of pending.slice(0, budget)) {
		const entry = await ctx.content!.create!(collection, { ...item });
		await synced.put(key, { contentId: entry.id, postedAt: item.posted_at } satisfies SyncedItem);
		created++;
		if (await publish(ctx, collection, entry.id)) published++;
	}

	await ctx.kv.set("state:lastSync", new Date().toISOString());
	return {
		status: "ok",
		feed,
		created,
		published,
		duplicatesRemoved,
		remaining: pending.length - created,
	};
}

const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:install": async (_event, ctx) => scheduleSync(ctx),
		"plugin:activate": async (_event, ctx) => scheduleSync(ctx),
		cron: {
			timeout: CRON_TIMEOUT_MS,
			handler: async (event, ctx) => {
				if (event.name !== CRON_TASK) return;
				const result = await sync(ctx);
				if (
					result.status === "ok" &&
					(result.created > 0 || result.published > 0 || result.duplicatesRemoved > 0)
				) {
					ctx.log.info(
						`RSS Feed synced: ${result.created} saved, ${result.published} published, ${result.duplicatesRemoved} duplicates removed, ${result.remaining} waiting`,
					);
				}
			},
		},
	},
	routes: {
		// Admin-only (the default `plugins:manage` permission): run a sync now.
		sync: {
			methods: ["POST"],
			handler: async (_routeCtx, ctx) => sync(ctx),
		},
	},
};

export default plugin;
