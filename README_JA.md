# RSS Feed To EmDash

RSS と Atom のフィード（YouTube のチャンネルや、note、Zenn、はてなブログのブログなど）の新しい項目を、サイトのコレクションにコピーする EmDash プラグインです。テーマで記事と並べて表示できます。

30分ごとにフィードを1つ読みます（30分ごとに次のフィードに移ります）。YouTube のショートは、設定でオンにしない限り入れません。新しい項目は1件ずつエントリーとして保存して公開します。公開するとコレクションのキャッシュが消えるので、キャッシュされたページにも次のアクセスから出ます。1回に保存するのは1件で、残りは次の回からです。フィードが読めないとき（YouTube のフィードは、数時間から数日のあいだ 404 を返すことがあります）は何も変えず、次の順番でもう一度読みます。管理画面で消した項目は、もう一度保存しません。

このプラグインは項目を保存するだけです。サイトでどう見せるかはテーマで決めます。ほかのコレクションと同じように読み出してください。

[English](README.md)

## 入れ方

入れ方は2つあります。

| 入れ元 | 動く場所 | Cloudflare のプラン | 入れ方・更新のしかた |
| --- | --- | --- | --- |
| EmDash のプラグインレジストリ | サンドボックスの中 | **Workers の有料プラン**（サンドボックスに必要） | 管理画面から |
| GitHub | サイト本体の中 | **無料プランで動く** | `npm install` のあと、**デプロイ** |

### レジストリから入れる

管理画面の「レジストリ」で **RSS Feed To EmDash** を探して入れます。Cloudflare では、レジストリのプラグインはサンドボックスの中で動くため、Workers の有料プランが必要です。

### GitHub から入れる

GitHub から入れます。入れるときに npm がビルドします。

```sh
npm install github:RieTamura/RSSFeed-To-EmDash
```

そのあと `astro.config.mjs` で、サイト本体の中で動かします（Worker Loader は要りません）。

```js
import rssFeed from "rss-feed";

emdash({
	// ...
	plugins: [rssFeed],
});
```

そのあとサイトをデプロイします。あとで更新するときも、同じ `npm install` を実行してから**デプロイ**します（この入れ方では、管理画面から更新できません）。

## 使い方

1. コレクションを作ります（slug の初期値は `feed_items`）。フィールドは次のとおりです。

   | フィールド | 型 |
   | --- | --- |
   | `title` | string |
   | `summary` | text |
   | `item_url` | string |
   | `item_id` | string |
   | `posted_at` | datetime |
   | `thumbnail` | json |
   | `source` | string |
   | `kind` | string |

2. プラグインの設定に、フィードの URL を1行に1つずつ書きます。

   | サービス | フィードの URL |
   | --- | --- |
   | YouTube | `https://www.youtube.com/feeds/videos.xml?channel_id=…` |
   | note | `https://note.com/<ユーザー名>/rss` |
   | Zenn | `https://zenn.dev/<ユーザー名>/feed` |
   | はてなブログ | `https://<ブログ>.hatenablog.com/rss`（`.hatenablog.jp`、`.hateblo.jp`、`.hatenadiary.com`、`.hatenadiary.jp` も可） |

   プラグインがアクセスできるのはこのサービスだけです。ほかのフィードや、独自ドメインのはてなブログは読めません。
3. 必要なら、フィードごとに入れる件数（1〜30）と、YouTube のショートを入れるかを選びます。

項目には `source`（`youtube`、`note`、`zenn`、`hatena`）と `kind`（`video`、`short`、`article`）が入ります。

## 表示のしかた

テーマでコレクションを読み出し、`posted_at` の新しい順に並べます。例は [英語の README](README.md#showing-the-items) にあります。`error` を確かめておくと、コレクションをまだ作っていないサイトでもページが壊れません。

## 開発

```sh
npm install
npm run validate
npm run typecheck
npm run test
npm run build
```

Cloudflare のサンドボックスでは、1回の実行で外とやりとりできるのは10回までです。`ctx` の呼び出しは、設定、ログ、KV も含めて1回に数えます。項目を1件保存する回は9回使うので、同期の処理に `ctx` の呼び出しを足すときは、1回あたりの上限から差し引いてください。

## 問題の報告

[Issues](https://github.com/RieTamura/RSSFeed-To-EmDash/issues) にお願いします。

## ライセンス

MIT
