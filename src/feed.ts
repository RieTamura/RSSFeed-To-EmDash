/** Where an item came from. */
export type FeedSource = "youtube" | "note" | "zenn" | "hatena" | "other";

/** What an item is. */
export type FeedKind = "video" | "short" | "article";

export interface Thumbnail {
	url: string;
	width?: number;
	height?: number;
}

/** The entry fields the plugin writes for each item. */
export interface ItemFields {
	title: string;
	summary: string;
	item_url: string;
	item_id: string;
	posted_at: string;
	thumbnail: Thumbnail | null;
	source: FeedSource;
	kind: FeedKind;
}

/** Field types the target collection must have. */
export const REQUIRED_FIELDS: Record<keyof ItemFields, string> = {
	title: "string",
	summary: "text",
	item_url: "string",
	item_id: "string",
	posted_at: "datetime",
	thumbnail: "json",
	source: "string",
	kind: "string",
};

const SUMMARY_LENGTH = 300;

/** A storage key for an item id, which can be a long URL. */
export async function keyOf(itemId: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(itemId));
	return [...new Uint8Array(digest).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
		if (name[0] === "#") {
			const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
			return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
		}
		return ENTITIES[name.toLowerCase()] ?? match;
	});
}

/** The text of an element's content: CDATA sections are kept as they are, the rest is decoded. */
function textOf(inner: string): string {
	return inner
		.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/)
		.map((part) => (part.startsWith("<![CDATA[") ? part.slice(9, -3) : decodeEntities(part)))
		.join("")
		.trim();
}

/** HTML or text squeezed into one plain line. */
function plainText(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function escapeName(name: string): string {
	return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The raw content of every `<name>…</name>` element in `xml`. */
function elements(xml: string, name: string): string[] {
	const pattern = new RegExp(`<${escapeName(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeName(name)}>`, "g");
	return [...xml.matchAll(pattern)].map((match) => match[1]!);
}

/** The text of the first `<name>` element, or "". */
function childText(xml: string, name: string): string {
	const inner = elements(xml, name)[0];
	return inner === undefined ? "" : textOf(inner);
}

/** The attribute part of every `<name …>` start tag, including self-closing ones. */
function startTags(xml: string, name: string): string[] {
	const pattern = new RegExp(`<${escapeName(name)}(?=[\\s/>])([^>]*)>`, "g");
	return [...xml.matchAll(pattern)].map((match) => match[1]!);
}

function attr(attrs: string, name: string): string | undefined {
	const match = new RegExp(`\\s${escapeName(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
	const value = match?.[1] ?? match?.[2];
	return value === undefined ? undefined : decodeEntities(value);
}

function numberAttr(attrs: string, name: string): number | undefined {
	const value = Number(attr(attrs, name));
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

function isoDate(value: string): string | null {
	const time = Date.parse(value);
	return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function summaryOf(html: string): string {
	const text = plainText(html);
	return text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH - 1)}…` : text;
}

export function sourceOf(feedUrl: string): FeedSource {
	const host = new URL(feedUrl).hostname;
	const is = (domain: string) => host === domain || host.endsWith(`.${domain}`);
	if (is("youtube.com")) return "youtube";
	if (is("note.com")) return "note";
	if (is("zenn.dev")) return "zenn";
	if (["hatenablog.com", "hatenablog.jp", "hateblo.jp", "hatenadiary.com", "hatenadiary.jp"].some(is)) {
		return "hatena";
	}
	return "other";
}

function kindOf(source: FeedSource, url: string): FeedKind {
	if (source !== "youtube") return "article";
	return new URL(url).pathname.startsWith("/shorts/") ? "short" : "video";
}

function thumbnailOf(item: string): Thumbnail | null {
	// Media RSS: <media:thumbnail url="…" width="…" height="…"/> (YouTube, Zenn) or <media:thumbnail>url</media:thumbnail> (note)
	const tag = startTags(item, "media:thumbnail")[0];
	if (tag !== undefined) {
		const url = attr(tag, "url") ?? childText(item, "media:thumbnail");
		if (url) return { url, width: numberAttr(tag, "width"), height: numberAttr(tag, "height") };
	}
	for (const enclosure of startTags(item, "enclosure")) {
		const url = attr(enclosure, "url");
		if (url && attr(enclosure, "type")?.startsWith("image/")) return { url };
	}
	return null;
}

function atomLink(entry: string): string {
	const links = startTags(entry, "link");
	const alternate = links.find((tag) => (attr(tag, "rel") ?? "alternate") === "alternate");
	return alternate === undefined ? "" : (attr(alternate, "href") ?? "");
}

function toFields(
	raw: { title: string; url: string; id: string; date: string; summary: string; item: string },
	source: FeedSource,
): ItemFields | null {
	const postedAt = isoDate(raw.date);
	if (!raw.url || !URL.canParse(raw.url) || !postedAt) return null;
	return {
		title: plainText(raw.title),
		summary: summaryOf(raw.summary),
		item_url: raw.url,
		item_id: raw.id || raw.url,
		posted_at: postedAt,
		thumbnail: thumbnailOf(raw.item),
		source,
		kind: kindOf(source, raw.url),
	};
}

/**
 * The items of an Atom or RSS 2.0 feed, newest first. Items without a
 * usable link or date are skipped. Workers have no XML parser, so this
 * reads only the elements the plugin needs.
 */
export function parseFeed(xml: string, feedUrl: string): ItemFields[] {
	const source = sourceOf(feedUrl);
	const atomEntries = elements(xml, "entry");
	const raws =
		atomEntries.length > 0
			? atomEntries.map((entry) => ({
					title: childText(entry, "title"),
					url: atomLink(entry),
					id: childText(entry, "id"),
					date: childText(entry, "published") || childText(entry, "updated"),
					summary:
						childText(entry, "media:description") ||
						childText(entry, "summary") ||
						childText(entry, "content"),
					item: entry,
				}))
			: elements(xml, "item").map((item) => ({
					title: childText(item, "title"),
					url: childText(item, "link"),
					id: childText(item, "guid"),
					date: childText(item, "pubDate") || childText(item, "dc:date"),
					summary: childText(item, "description"),
					item,
				}));
	return raws
		.map((raw) => toFields(raw, source))
		.filter((fields): fields is ItemFields => fields !== null)
		.sort((a, b) => b.posted_at.localeCompare(a.posted_at));
}
