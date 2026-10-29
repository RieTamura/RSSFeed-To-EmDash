import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { REQUIRED_FIELDS } from "./feed";

const DEFAULT_COLLECTION = "feed_items";
const DEFAULT_LIMIT = 15;
const CRON_TASK = "sync";
/** Feeds change slowly, and YouTube refuses clients that ask too often. */
const CRON_SCHEDULE = "*/30 * * * *";
/**
 * Time limit for one scheduled run. The host's default is 5 seconds, which
 * a deployed run can exceed when the database is far away.
 */
const CRON_TIMEOUT_MS = 120_000;

interface Settings {
	feedUrl: string;
	limit: number;
	includeShorts: boolean;
	collection: string;
}

type SyncResult =
	| { status: "ok"; created: number; published: number; remaining: number }
	| { status: "not_configured" }
	| { status: "collection_invalid"; collection: string; problems: string[] };

async function scheduleSync(ctx: PluginContext) {
	await ctx.cron?.schedule(CRON_TASK, { schedule: CRON_SCHEDULE });
}

/** The settings, or null while no usable feed URL is set. */
async function readSettings(ctx: PluginContext): Promise<Settings | null> {
	const feedUrl = (await ctx.settings.get<string>("feed_url"))?.trim();
	if (!feedUrl || !URL.canParse(feedUrl)) return null;
	const limit = Number(await ctx.settings.get("limit"));
	const collection = (await ctx.settings.get<string>("collection"))?.trim();
	return {
		feedUrl,
		limit: Number.isInteger(limit) && limit >= 1 && limit <= 15 ? limit : DEFAULT_LIMIT,
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

async function sync(ctx: PluginContext): Promise<SyncResult> {
	const settings = await readSettings(ctx);
	if (!settings) return { status: "not_configured" };

	const problems = await collectionProblems(ctx, settings.collection);
	if (problems.length > 0) {
		ctx.log.warn("RSS Feed cannot write to the collection", {
			collection: settings.collection,
			problems,
		});
		return { status: "collection_invalid", collection: settings.collection, problems };
	}

	// Fetching the feed and saving its items comes in step 3 of design/plan-rss-feed.md.
	return { status: "ok", created: 0, published: 0, remaining: 0 };
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
				if (result.status === "ok" && (result.created > 0 || result.published > 0)) {
					ctx.log.info(
						`RSS Feed synced: ${result.created} saved, ${result.published} published, ${result.remaining} waiting`,
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
