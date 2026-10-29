/** Where an item came from. */
export type FeedSource = "youtube" | "note" | "zenn" | "hatena" | "other";

/** What an item is. */
export type FeedKind = "video" | "short" | "article";

/** The entry fields the plugin writes for each item. */
export interface ItemFields {
	title: string;
	summary: string;
	item_url: string;
	item_id: string;
	posted_at: string;
	thumbnail: { url: string; width?: number; height?: number } | null;
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
