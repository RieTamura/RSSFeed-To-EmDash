import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { keyOf, REQUIRED_FIELDS } from "../src/feed";

import youtube from "./fixtures/youtube.xml?raw";

const FEED_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=UCexample";

let host: PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

async function setup(options: { collection?: boolean; feedUrl?: string | null } = {}) {
	host = await createPluginRuntimeTestHost();
	if (options.collection !== false) {
		await host.fixtures.collection({
			slug: "feed_items",
			label: "Feed items",
			supports: ["drafts", "revisions"],
			fields: Object.entries(REQUIRED_FIELDS).map(([slug, type]) => ({
				slug,
				label: slug,
				type: type as never,
			})),
		});
	}
	if (options.feedUrl !== null) {
		await host.fixtures.plugin.setting("feed_url", options.feedUrl ?? FEED_URL);
	}
	return host;
}

async function runSyncRoute(host: PluginRuntimeTestHost) {
	return host.transport.invokeRoute("sync", {}, { method: "POST" });
}

describe("schedule", () => {
	it("schedules the sync task every 30 minutes when the plugin is activated", async () => {
		const h = await setup();
		await h.actions.plugin.activate();
		const tasks = await h.inspect.scheduledTasks();
		expect(tasks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "sync", schedule: "*/30 * * * *", enabled: 1 }),
			]),
		);
	});
});

function feedResponse(xml = youtube) {
	return new Response(xml, { headers: { "content-type": "application/atom+xml; charset=UTF-8" } });
}

describe("sync", () => {
	it("saves and publishes the newest video, skipping Shorts", async () => {
		const h = await setup();
		await h.http.respond(FEED_URL, feedResponse());

		const result = await runSyncRoute(h);

		expect(result).toEqual({ status: "ok", created: 1, published: 1, duplicatesRemoved: 0, remaining: 1 });
		const items = await h.inspect.content.list("feed_items");
		expect(items).toHaveLength(1);
		expect(items[0]?.status).toBe("published");
		expect(items[0]?.data).toMatchObject({
			item_id: "yt:video:video000002",
			item_url: "https://www.youtube.com/watch?v=video000002",
			source: "youtube",
			kind: "video",
		});
		expect(await h.inspect.storage.get("items", await keyOf("yt:video:video000002"))).toMatchObject({
			contentId: items[0]?.id,
		});
	});

	it("saves one item per run and the rest on later runs, without saving any twice", async () => {
		const h = await setup();
		const results = [];
		for (let i = 0; i < 3; i++) {
			await h.http.respond(FEED_URL, feedResponse());
			results.push((await runSyncRoute(h)) as { created: number; remaining: number });
		}
		expect(results.map((r) => r.created)).toEqual([1, 1, 0]);
		expect(results.map((r) => r.remaining)).toEqual([1, 0, 0]);
		const items = await h.inspect.content.list("feed_items");
		expect(items.map((item) => item.data.item_id).sort()).toEqual(["yt:video:video000001", "yt:video:video000002"]);
	});

	it("saves Shorts when the setting is on", async () => {
		const h = await setup();
		await h.fixtures.plugin.setting("include_shorts", true);
		await h.http.respond(FEED_URL, feedResponse());
		await runSyncRoute(h);
		const items = await h.inspect.content.list("feed_items");
		expect(items[0]?.data).toMatchObject({ item_id: "yt:video:short00001", kind: "short" });
	});

	it("saves only as many items as the limit setting asks for", async () => {
		const h = await setup();
		await h.fixtures.plugin.setting("limit", 1);
		await h.http.respond(FEED_URL, feedResponse());
		expect(await runSyncRoute(h)).toMatchObject({ created: 1, remaining: 0 });
	});

	it("publishes an item saved by a run that was cut off before remembering it", async () => {
		const h = await setup();
		const draft = await h.fixtures.content("feed_items", {
			slug: "video-2",
			data: { title: "video 2", item_id: "yt:video:video000002" },
		});
		await h.http.respond(FEED_URL, feedResponse());

		const result = await runSyncRoute(h);

		expect(result).toMatchObject({ created: 0, published: 1 });
		expect((await h.inspect.content.get("feed_items", draft.id))?.status).toBe("published");
	});

	it("moves extra copies of an item to the trash, keeping one", async () => {
		const h = await setup();
		const data = { title: "video 2", item_id: "yt:video:video000002" };
		const first = await h.fixtures.content("feed_items", { slug: "v-1", data });
		await h.fixtures.content("feed_items", { slug: "v-2", data });
		await h.http.respond(FEED_URL, feedResponse());

		const result = await runSyncRoute(h);

		expect(result).toMatchObject({ duplicatesRemoved: 1, published: 1, created: 0 });
		expect((await h.inspect.content.get("feed_items", first.id))?.status).toBe("published");
	});

	it("does not bring back an item deleted in the admin", async () => {
		const h = await setup();
		await h.fixtures.plugin.setting("limit", 1);
		await h.fixtures.plugin.storage("items", await keyOf("yt:video:video000002"), {
			contentId: "gone",
			postedAt: "2026-10-27T11:00:00.000Z",
		});
		await h.http.respond(FEED_URL, feedResponse());

		expect(await runSyncRoute(h)).toMatchObject({ created: 0, remaining: 0 });
		expect(await h.inspect.content.list("feed_items")).toHaveLength(0);
	});

	it("changes nothing when YouTube answers 404 for a while", async () => {
		const h = await setup();
		await h.http.respond(FEED_URL, new Response("Not Found", { status: 404 }));
		expect(await runSyncRoute(h)).toEqual({ status: "fetch_failed", httpStatus: 404 });
		expect(await h.inspect.content.list("feed_items")).toHaveLength(0);
	});

	it("does nothing until a feed URL is set", async () => {
		const h = await setup({ feedUrl: null });
		expect(await runSyncRoute(h)).toEqual({ status: "not_configured" });
		expect(h.http.requests()).toHaveLength(0);
	});

	it("does nothing when the feed URL is not a URL", async () => {
		const h = await setup({ feedUrl: "not a url" });
		expect(await runSyncRoute(h)).toEqual({ status: "not_configured" });
	});

	it("reports a missing collection instead of fetching", async () => {
		const h = await setup({ collection: false });
		expect(await runSyncRoute(h)).toMatchObject({
			status: "collection_invalid",
			collection: "feed_items",
			problems: ['collection "feed_items" does not exist'],
		});
		expect(h.http.requests()).toHaveLength(0);
	});
});
