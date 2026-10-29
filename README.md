# RSS Feed

An EmDash plugin that copies the newest items of an RSS or Atom feed, such as a YouTube channel, into a collection on your site, so your theme can show them next to your posts.

Work in progress: the plugin checks its settings and the collection, but does not read feeds yet.

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

2. In the plugin settings, set the feed URL. For a YouTube channel, use `https://www.youtube.com/feeds/videos.xml?channel_id=…`.
3. Optionally choose how many items to import (1–15) and whether to include YouTube Shorts.

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
