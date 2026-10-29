import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

import { REQUIRED_FIELDS } from "../src/feed";

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

describe("sync", () => {
	it("does nothing until a feed URL is set", async () => {
		const h = await setup({ feedUrl: null });
		expect(await runSyncRoute(h)).toEqual({ status: "not_configured" });
	});

	it("does nothing when the feed URL is not a URL", async () => {
		const h = await setup({ feedUrl: "not a url" });
		expect(await runSyncRoute(h)).toEqual({ status: "not_configured" });
	});

	it("reports a missing collection", async () => {
		const h = await setup({ collection: false });
		expect(await runSyncRoute(h)).toMatchObject({
			status: "collection_invalid",
			collection: "feed_items",
			problems: ['collection "feed_items" does not exist'],
		});
	});

	it("runs when the feed URL and collection are ready", async () => {
		const h = await setup();
		expect(await runSyncRoute(h)).toEqual({ status: "ok", created: 0, published: 0, remaining: 0 });
	});
});
