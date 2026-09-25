# PacedMind Docs

The end-user documentation for PacedMind, served at **https://pacedmind.com/docs**. It's a standalone [Fumadocs](https://fumadocs.dev) project on Next.js 16, like the home page in `../site`, with its own dependencies. `npm run build` writes plain files to `out/`, so the docs need no server of their own.

It follows the structure of the Persate docs: `source.config.ts`, MDX pages in `content/docs` ordered by `meta.json`, `[lang]` routes with `defineI18n`, `llms.txt` routes for AI tools, a link-preview image per page, and a sitemap dated from git.

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

### For the home page's SEO files

`../site` owns the root files. They should point to the docs:

* `https://pacedmind.com/robots.txt`: add `Sitemap: https://pacedmind.com/docs/sitemap.xml` (or list it in a sitemap index), and don't disallow `/docs/llms.mdx/` or `/docs/og/`: AI assistants read the Markdown copies, and link previews (X honours robots.txt) fetch the images.
* `https://pacedmind.com/llms.txt`: link to `https://pacedmind.com/docs/llms.txt` and `https://pacedmind.com/docs/llms-full.txt`.

To keep the Markdown copies out of search results, the web server sends `X-Robots-Tag: noindex` for `/docs/llms.mdx/` (below).

## Deploy

Put the two static builds in one folder: the home page at its root and the docs in `docs/` inside it.

```bash
(cd site && npm run build)
(cd docs && npm run build)
rsync -a --delete --exclude /docs/ site/out/ server:/srv/pacedmind/www/
rsync -a --delete docs/out/ server:/srv/pacedmind/www/docs/
```

The docs' files already carry the `/docs` prefix in every link and asset URL, so they work from that folder as they are.

### Caddy

```caddy
pacedmind.com {
	root * /srv/pacedmind/www
	encode zstd gzip

	# Optional: /docs/<page>.mdx returns the page as Markdown, as on Fumadocs sites with a server.
	@mdx path_regexp mdx ^/docs/(.+)\.mdx$
	rewrite @mdx /docs/llms.mdx/{re.mdx.1}/content.md

	header /docs/llms.mdx/* {
		Content-Type "text/markdown; charset=utf-8"
		X-Robots-Tag "noindex"
	}
	header /docs/api/search Content-Type "application/json"
	header /_next/static/* Cache-Control "public, max-age=31536000, immutable"
	header /docs/_next/static/* Cache-Control "public, max-age=31536000, immutable"

	try_files {path} {path}.html {path}/index.html
	file_server

	handle_errors 404 {
		@docs path /docs /docs/*
		rewrite @docs /docs/404.html
		rewrite * /404.html
		file_server
	}
}
```

### Nginx

```nginx
server {
    server_name pacedmind.com;
    root /srv/pacedmind/www;

    location / {
        try_files $uri $uri.html $uri/index.html =404;
    }

    location /docs/ {
        try_files $uri $uri.html $uri/index.html =404;
        error_page 404 /docs/404.html;
    }

    location /docs/llms.mdx/ {
        types { }
        default_type "text/markdown; charset=utf-8";
        add_header X-Robots-Tag "noindex";
    }

    location = /docs/api/search {
        default_type application/json;
    }

    # Optional: /docs/<page>.mdx returns the page as Markdown.
    location ~ ^/docs/(.+)\.mdx$ {
        default_type "text/markdown; charset=utf-8";
        try_files /docs/llms.mdx/$1/content.md =404;
    }

    location ~ ^/(docs/)?_next/static/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    error_page 404 /404.html;
}
```

## How the static export works

Fumadocs sites usually run on a Next.js server. These parts make the docs work as plain files:

* **`output: 'export'`** for `next build` only. `next dev` keeps a normal server, because it needs a rewrite that a static export refuses (`next.config.mjs`).
* **English without `/en/`.** `hideLocale: 'default-locale'` writes English links without a language prefix. A server would rewrite them to the `[lang]` routes with a proxy; instead, `scripts/postbuild.mjs` moves `out/en/` to the root of `out/` after the build, and `next dev` uses a rewrite in `next.config.mjs`. Other languages keep their folder, such as `out/pl/`.
* **Prefetch files on Windows.** Next.js writes the router's per-segment files as nested folders when it builds on Windows (its segment paths keep backslashes). The browser asks for dotted file names, gets 404s, and falls back to the page's full payload. `scripts/postbuild.mjs` renames them. Builds on Linux don't need it.
* **Static search.** `src/app/api/search/route.ts` exports the whole index at build time (`staticGET`), and `src/components/SearchDialog.tsx` searches it in the browser. The index is about 2.9 MB, 550 KB compressed, downloaded on the first search. The built-in static dialog passes the locale code (`en`) to Orama, which only accepts language names (`english`), so its search stays empty; the custom dialog maps it.
* **The 404 page** is `src/app/global-not-found.tsx` (`experimental.globalNotFound`), because the root layout sits under `[lang]`.

What a static export can't do, compared with a Fumadocs server:

* **Content negotiation.** A server can answer `Accept: text/markdown` with the page's Markdown. Here, AI tools use `/docs/llms.txt` and the `llms.mdx` URLs instead; the web server can add the `.mdx` suffix URLs (above).
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

`public/screenshots/` holds screenshots of the app's views, taken from the development server (`npm run dev` in the repository root) with its sample data, in the dark theme, at 1920 × 1200. Before taking new ones, replace the sample data's folder paths, which contain the local user name. Pages embed them with a plain `<img>` and the `/docs` prefix, as Next's image optimizer isn't available in a static export.

## GitHub links

The **View on GitHub** option and the GitHub icon stay hidden until the repository is public: set `repoPublic: true` in `src/lib/shared.ts`. Page sources are then linked at `docs/content/docs/` in the repository.
