# RSS Feed To EmDash

An EmDash plugin that copies the newest items of RSS and Atom feeds, such as a YouTube channel or a blog on note, Zenn or Hatena Blog, into a collection on your site, so your theme can show them next to your posts.

Every 30 minutes it reads one of your feeds, the next one each half hour, skips YouTube Shorts unless you turn them on, and saves each new item as an entry, then publishes it. Publishing purges the collection's cache tag, so cached pages pick the item up on the next request. It saves one new item per run and picks up the rest on later runs. If a feed cannot be read (YouTube's feeds sometimes answer 404 for hours or days), nothing changes and the feed is tried again on its next turn. An item you delete in the admin is not saved again.

The plugin only stores the items. How they look on the site is up to your theme: query the collection like any other.

[日本語の説明はこちら](README_JA.md)

## Install

There are two ways to install it.

| From | Runs | Cloudflare plan | Install and update |
| --- | --- | --- | --- |
| The EmDash plugin registry | In the plugin sandbox | **Workers Paid** (the sandbox needs it) | From the admin |
| GitHub | In-process, with your site | **Workers Free is fine** | `npm install`, then **deploy** |

### From the registry

In the admin, open **Registry**, search for **RSS Feed To EmDash** and install it. On Cloudflare, registry plugins run in the plugin sandbox, which needs the Workers Paid plan.

### From GitHub

Install it from GitHub; npm builds it on install:

```sh
npm install github:RieTamura/RSSFeed-To-EmDash
```

Then run it in-process from `astro.config.mjs`, which needs no Worker Loader:

```js
import rssFeed from "rss-feed";

emdash({
	// ...
	plugins: [rssFeed],
});
```

Then deploy the site. To update the plugin later, run the same `npm install` again and **deploy**; the admin cannot update a plugin installed this way.

## Setup

1. Create a collection (default slug `feed_items`) with these fields:

   | Field | Type |
   | --- | --- |
   | `title` | string |
   | `summary` | text |
   | `item_url` | string |
   | `item_id` | string |
   | `posted_at` | datetime |
   | `thumbnail` | json |
   | `source` | string |
   | `kind` | string |

2. In the plugin settings, list your feeds, one per line:

   | Service | Feed URL |
   | --- | --- |
   | YouTube | `https://www.youtube.com/feeds/videos.xml?channel_id=…` |
   | note | `https://note.com/<user>/rss` |
   | Zenn | `https://zenn.dev/<user>/feed` |
   | Hatena Blog | `https://<blog>.hatenablog.com/rss` (also `.hatenablog.jp`, `.hateblo.jp`, `.hatenadiary.com`, `.hatenadiary.jp`) |

   The plugin may only reach these hosts, so other feeds, and Hatena Blog on a custom domain, cannot be read.
3. Optionally choose how many items of each feed to import (1–30) and whether to include YouTube Shorts.

Each item records its `source` (`youtube`, `note`, `zenn`, `hatena`) and `kind` (`video`, `short`, `article`).

## Showing the items

Query the collection in your theme, newest first by `posted_at`:

```astro
---
import { getEmDashCollection } from "emdash";

const { entries, cacheHint, error } = await getEmDashCollection("feed_items");
const videos = error
	? []
	: entries
			.filter((entry) => entry.data.source === "youtube" && entry.data.kind !== "short")
			.sort((a, b) => Date.parse(b.data.posted_at) - Date.parse(a.data.posted_at));
if (Astro.cache?.enabled && !error) Astro.cache.set(cacheHint);
---

<ul class="video-grid">
	{videos.map((video) => (
		<li>
			<a href={video.data.item_url} rel="noopener">
				{video.data.thumbnail && <img src={video.data.thumbnail.url} alt="" loading="lazy" />}
				<span>{video.data.title}</span>
			</a>
		</li>
	))}
</ul>

<style>
	.video-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 16px;
		padding: 0;
		list-style: none;
	}

	/* YouTube's thumbnails are 4:3 with black bars; crop them to 16:9 */
	.video-grid img {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
	}
</style>
```

Checking `error` keeps the page working on a site where the collection does not exist yet.

## Develop

```sh
npm install
npm run validate
npm run typecheck
npm run test
npm run build
```

`npm run test` builds the plugin and runs its tests through Worker Loader using EmDash's production sandbox wrapper and host bridge.

Bump `version` in `package.json` when you ship a release. `emdash-plugin.jsonc` omits `version`; the build reads it from `package.json`.

The Cloudflare sandbox allows 10 subrequests per run, and every `ctx` call counts as one (settings, logs and KV too). A run that saves an item makes 9, so keep new `ctx` calls out of the sync path or take them from the per-run budget.

## Security

Report problems in [Issues](https://github.com/RieTamura/RSSFeed-To-EmDash/issues).

## License

MIT
