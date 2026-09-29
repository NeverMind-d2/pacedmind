# PacedMind Docs

The end-user documentation for PacedMind, served at **https://pacedmind.com/docs**. It's a standalone [Fumadocs](https://fumadocs.dev) project on Next.js 16, like the home page in `../site`, with its own dependencies. `npm run build` writes plain files to `out/`, so the docs need no server of their own.

It has the usual Fumadocs structure: `source.config.ts`, MDX pages in `content/docs` ordered by `meta.json`, `[lang]` routes with `defineI18n`, `llms.txt` routes for AI tools, a link-preview image per page, and a sitemap dated from git.

```bash
cd docs
npm install        # also runs fumadocs-mdx, which generates .source/
npm run dev        # http://127.0.0.1:4340/docs, with hot reload
npm run build      # static files in out/
npm start          # serves out/ at http://127.0.0.1:4341/docs, the way the web server will
npm run lint
npm run types:check
```

Read [AGENTS.md](AGENTS.md) before editing pages: it has the conventions and the two MDX traps.

## What gets published

Everything lives under `/docs` (`basePath: '/docs'`), so search authority stays on pacedmind.com.

| URL | What |
| --- | --- |
| `/docs` | The docs home page, with a tile per section. |
| `/docs/<section>/<page>` | The pages, such as `/docs/views/timeline`. |
| `/docs/sitemap.xml` | Every page with its canonical URL; `lastmod` is the page's last commit date (pages not committed yet have none). |
| `/docs/llms.txt` | The [llms.txt](https://llmstxt.org) index: every page with its description and absolute URL. |
| `/docs/llms-full.txt` | The whole guide as one Markdown file. |
| `/docs/llms.mdx/<page>/content.md` | One page as Markdown, such as `/docs/llms.mdx/views/timeline/content.md`. The **Copy Markdown** and **Open** buttons on each page use it. |
| `/docs/og/<page>/image.png` | The page's link-preview image (1200 × 630). |
| `/docs/api/search` | The search index, a JSON file without an extension. The search dialog downloads it and searches in the browser. |
| `/docs/robots.txt` | Inert: crawlers only read robots.txt at the domain root. |
| `/docs/404.html` | The page for unknown addresses. |

### What the home page's files say about the docs

`../site` owns the files at the domain root, where crawlers look for them:

* `https://pacedmind.com/robots.txt` (`site/app/robots.ts`) lists `https://pacedmind.com/docs/sitemap.xml` and disallows nothing under `/docs`. AI assistants read the Markdown copies in `/docs/llms.mdx/`, and link previews (X's crawler follows robots.txt) fetch the images in `/docs/og/`.
* `https://pacedmind.com/llms.txt` (`site/lib/llms.ts`) links to `/docs/llms.txt` and `/docs/llms-full.txt`, and the docs' `llms.txt` links back to it.
* The docs' JSON-LD points at the home page's Organization, WebSite and SoftwareApplication by `@id` (`schemaIds` in `src/lib/shared.ts`) instead of describing PacedMind again.

The web server keeps the Markdown copies, the search index and the navigation files out of search results with an `X-Robots-Tag: noindex` header.

Pages whose titles are the same in different sections (Tasks is a concept and a set of MCP tools) get their section's title in the `<title>`, such as "Tasks – Tool reference", because search engines treat pages with the same title as duplicates.

### Visitor statistics

The docs count visits in the same Umami website as the home page (`deploy/README.md`, step 5). `src/components/Analytics.tsx` loads the tracker from `/stats/script.js` on pacedmind.com only, once `analytics.websiteId` in `src/lib/shared.ts` is set, and it follows page changes in the browser by itself.

## Deploy

The server setup is in the repository's `deploy/`: `deploy/Caddyfile` is the whole Caddy config for pacedmind.com and its `/docs`, and `deploy/deploy.sh` uploads `site/out` and `docs/out` (see `deploy/README.md`). Build first:

```bash
(cd docs && npm ci && npm run build)
APP_PLACEHOLDER=1 deploy/deploy.sh ubuntu@<server>
```

`docs/out` goes to `/srv/pacedmind/docs`, served at `/docs`. The docs' files already carry the `/docs` prefix in every link and asset URL. Whatever serves them has to:

* map `/docs/<path>` to `<path>`, `<path>.html` or `<path>/index.html`, in that order (a section has both `views.html` and a `views/` folder, so `.html` must come before the folder);
* answer unknown addresses under `/docs` with `404.html` and a 404 status;
* send `text/markdown; charset=utf-8` for `/docs/llms.mdx/` and `application/json` for `/docs/api/search`, a file without an extension.

## How the static export works

Fumadocs sites usually run on a Next.js server. These parts make the docs work as plain files:

* **`output: 'export'`** for `next build` only. `next dev` keeps a normal server, because it needs a rewrite that a static export refuses (`next.config.mjs`).
* **English without `/en/`.** `hideLocale: 'default-locale'` writes English links without a language prefix. A server would rewrite them to the `[lang]` routes with a proxy; instead, `scripts/postbuild.mjs` moves `out/en/` to the root of `out/` after the build, and `next dev` uses a rewrite in `next.config.mjs`. Other languages keep their folder, such as `out/pl/`.
* **Prefetch files on Windows.** Next.js writes the router's per-segment files as nested folders when it builds on Windows (its segment paths keep backslashes). The browser asks for dotted file names, gets 404s, and falls back to the page's full payload. `scripts/postbuild.mjs` renames them. Builds on Linux don't need it.
* **Static search.** `src/app/api/search/route.ts` exports the whole index at build time (`staticGET`), and `src/components/SearchDialog.tsx` searches it in the browser. The index is about 2.9 MB, 550 KB compressed, downloaded on the first search. The built-in static dialog passes the locale code (`en`) to Orama, which only accepts language names (`english`), so its search stays empty; the custom dialog maps it.
* **The 404 page** is `src/app/global-not-found.tsx` (`experimental.globalNotFound`), because the root layout sits under `[lang]`.

What a static export can't do, compared with a Fumadocs server:

* **Content negotiation.** A server can answer `Accept: text/markdown` with the page's Markdown. Here, AI tools use `/docs/llms.txt` and the `llms.mdx` URLs instead, and `deploy/Caddyfile` also serves `/docs/<page>.mdx` as the page's Markdown.
* **Search on the server.** The browser downloads the index once instead of querying a search API. Hosted search would need a server or a search service.

Neither needs a server for the docs to work.

## Languages

The docs are English only, set up for more languages. To add Polish:

1. Add `'pl'` to `languages` in `src/lib/i18n.ts` and to `otherLanguages` in `next.config.mjs`.
2. Add the UI strings to `translations` in `src/app/[lang]/layout.tsx`, the language to `locales`, and `pl: { language: 'english' }` (Orama has no Polish stemmer) to `localeMap` in `src/app/api/search/route.ts` and to `ORAMA_LANGUAGE` in `src/components/SearchDialog.tsx`.
3. Add `<page>.pl.mdx` next to each page and `meta.pl.json` next to each `meta.json`, with the same sections in the same order.
4. Translate the home page copy in `src/app/[lang]/(home)/page.tsx`.

The Polish pages are then published under `/docs/pl/...`, with `hreflang` alternates in the sitemap and the page metadata.

## Screenshots

`public/screenshots/` holds screenshots of the app's views, from the development server's sample data, in the dark theme, at 1920 × 1200. `npm run screenshots -- docs` in the repository root takes them all again: it runs a development server of its own with an empty home folder, so no folder, session or setting of this computer shows, and its clock reads 10:40 today. A new screenshot goes into its list in `scripts/screenshots.mjs`. Pages embed them with a plain `<img>` and the `/docs` prefix, as Next's image optimizer isn't available in a static export.

## GitHub links

The **View on GitHub** option and the GitHub icon stay hidden until the repository is public: set `repoPublic: true` in `src/lib/shared.ts`. Page sources are then linked at `docs/content/docs/` in the repository.
