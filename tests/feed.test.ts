import { describe, expect, it } from "vitest";

import { parseFeed, sourceOf } from "../src/feed";

import hatenaAtom from "./fixtures/hatena-atom.xml?raw";
import rss from "./fixtures/rss.xml?raw";
import youtube from "./fixtures/youtube.xml?raw";

const YOUTUBE_URL = "https://www.youtube.com/feeds/videos.xml?channel_id=UCexample";

describe("parseFeed: YouTube (Atom)", () => {
	const items = parseFeed(youtube, YOUTUBE_URL);

	it("reads every entry, newest first", () => {
		expect(items.map((item) => item.item_id)).toEqual([
			"yt:video:short00001",
			"yt:video:video000002",
			"yt:video:video000001",
		]);
	});

	it("reads the fields of a video and decodes entities", () => {
		expect(items[1]).toEqual({
			title: '【座談会 #2】Q&A と "最新" のアップデート',
			summary: "今週の話題です。 チャプター 00:00 はじめに & あいさつ",
			item_url: "https://www.youtube.com/watch?v=video000002",
			item_id: "yt:video:video000002",
			posted_at: "2026-10-27T11:00:00.000Z",
			thumbnail: { url: "https://i2.ytimg.com/vi/video000002/hqdefault.jpg", width: 480, height: 360 },
			source: "youtube",
			kind: "video",
		});
	});

	it("tells Shorts by their link", () => {
		expect(items.map((item) => item.kind)).toEqual(["short", "video", "video"]);
	});

	it("does not take the channel's own title or link", () => {
		expect(items.some((item) => item.title === "Example Channel")).toBe(false);
	});

	it("keeps an empty description empty", () => {
		expect(items[2]?.summary).toBe("");
	});
});

describe("parseFeed: RSS 2.0", () => {
	const items = parseFeed(rss, "https://example.com/feed");

	it("skips items without a date", () => {
		expect(items.map((item) => item.item_url)).toEqual([
			"https://example.com/posts/2",
			"https://example.com/posts/1",
		]);
	});

	it("reads CDATA, strips HTML and note's 続きをみる link from the description, and reads a text thumbnail", () => {
		expect(items[0]).toMatchObject({
			title: "CDATA の題 & 記号",
			summary: "本文の はじめ です。& も入る。",
			item_id: "https://example.com/posts/2",
			posted_at: "2026-10-28T00:30:00.000Z",
			thumbnail: { url: "https://example.com/images/2.png" },
			source: "other",
			kind: "article",
		});
	});

	it("uses the link as the id without a guid, and an enclosure as the thumbnail even with Zenn's type=\"false\"", () => {
		expect(items[1]).toMatchObject({
			summary: "段落 もう一つ",
			item_id: "https://example.com/posts/1",
			thumbnail: { url: "https://example.com/images/1.jpg" },
		});
	});

	it("returns nothing for something that is not a feed", () => {
		expect(parseFeed("<!DOCTYPE html><html><title>Error 404</title></html>", "https://example.com/feed")).toEqual([]);
	});
});

describe("parseFeed: Hatena Blog (Atom)", () => {
	it("reads the entry and takes the eyecatch from <link rel=\"enclosure\">", () => {
		expect(parseFeed(hatenaAtom, "https://example.hatenablog.com/feed")).toEqual([
			{
				title: "はてなブログの記事",
				summary: "記事の書き出しです。",
				item_url: "https://example.hatenablog.com/entry/2026/10/23/110000",
				item_id: "hatenablog://entry/2",
				posted_at: "2026-10-23T02:00:00.000Z",
				thumbnail: { url: "https://cdn.example.com/eyecatch.png" },
				source: "hatena",
				kind: "article",
			},
		]);
	});
});

describe("sourceOf", () => {
	it("knows the services this site uses", () => {
		expect(sourceOf(YOUTUBE_URL)).toBe("youtube");
		expect(sourceOf("https://note.com/example/rss")).toBe("note");
		expect(sourceOf("https://zenn.dev/example/feed")).toBe("zenn");
		expect(sourceOf("https://example.hatenablog.com/rss")).toBe("hatena");
		expect(sourceOf("https://notyoutube.com/feed")).toBe("other");
	});
});
