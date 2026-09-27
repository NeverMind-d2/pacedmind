# PacedMind website

The public home page: a static Next.js site, separate from the desktop app. It has its own dependencies, and `npm run build` writes plain files to `out/`.

```bash
cd site
npm install
npm run dev      # http://127.0.0.1:4330
npm run build    # static files in out/
```

The site runs at https://pacedmind.com, with the docs (`../docs`, also a static export) at `/docs` on the same domain. The server setup and the deploy script for both are in the repository's `deploy/` (see `deploy/Caddyfile`), and `deploy/README.md` here has the steps for Google Search Console and Bing Webmaster Tools. Any static host works if it does what the Caddyfile does: serve `{path}.html` for `{path}`, answer unknown addresses with `404.html` and a 404 status, and redirect `www` and `http://` to `https://pacedmind.com`. The download buttons point at `/download/windows` and `/download/mac`, which lead to the installers that `npm run release` (in the repository's root) builds and uploads.

## Prices

There are two plans. One device is free and needs no account. Cloud costs the same as Spotify Premium Individual in each country (in India, where that plan is called Premium Standard) and starts with 7 days free. The prices are in `prices.json`. Visitors see the prices for their country, guessed from their time zone and then their browser language, and can pick another country. Anyone else sees the US price. The page itself never names Spotify: it says "a music subscription".

Check the prices regularly:

```bash
npm run prices              # compares prices.json with spotify.com; exits with 1 if a price changed
npm run prices -- --write   # also saves the new prices and today's date
```

A change of more than 40% is never saved, because it more likely means the page was misread: check that country by hand. To add a country, add it to `prices.json` with `"amount": 0` and run with `--write`.

## Search and answer engines

- The page's words live in `lib/content.ts`, which the page, `/llms.txt`, `/llms-full.txt` and the structured data all read, so they can't drift apart (the hero and the pricing heading are still written out in `app/page.tsx` too). The FAQ there is shown on the page and repeated in its FAQPage data word for word; never add a question to one without the other. The entity is always "PacedMind".
- The FAQ's price question and llms.txt say what the pricing section says (`COST` in `lib/content.ts`). In the JSON-LD, the SoftwareApplication offers One device at a price of 0. Cloud gets no Offer: its price differs by country, and one Offer can't state that.
- Every page that should be found gets its canonical URL, link preview and robots tag from `pageMetadata()` in `lib/seo.ts`. URLs have no trailing slash, and `SITE.url` in `lib/site.ts` is the one origin.
- `lib/seo.ts` also builds the JSON-LD: Organization and WebSite on every page, SoftwareApplication, SoftwareSourceCode and FAQPage on the home page, joined by stable `@id`s. The docs point at the same ids (`https://pacedmind.com/#organization`, `#website`, `#software`) rather than describe PacedMind again.
- `app/sitemap.ts` lists this site's pages, dated by the last commit that changed them (build from a checkout with its history). `app/robots.ts` is the only robots.txt crawlers read for the whole domain: it names both sitemaps, and repeats any rule the docs app adds, with the `/docs` prefix. The docs disallow nothing: assistants read `/docs/llms.mdx/` and link previews fetch `/docs/og/`, and the server sends `X-Robots-Tag: noindex` for the Markdown copies instead.
- `/llms.txt` introduces PacedMind for assistants and links the docs' `/docs/llms.txt` and `/docs/llms-full.txt`; `/llms-full.txt` has the page as text, with Cloud's planned price in every country.
- Performance: only Jost's Latin file is preloaded, the CSS is inlined into the HTML (`next.config.mjs`), and the page's images are imported, so their URLs carry a content hash and can be cached for a year.

## Visitor statistics

Umami counts visits without cookies (the repository's `deploy/README.md`, step 5). `components/analytics.tsx` loads its tracker from `/stats/script.js` on pacedmind.com only, so `npm run dev` and local builds count nothing, and only once `SITE.analytics.websiteId` in `lib/site.ts` is set. The docs use the same website id. A link with `downloadEvent()`'s attributes is also counted as a `Download` event when clicked: give any new download button one.

## Open source and the GitHub stars

The header links to the repository on GitHub with its star count, and so does the open-source section (`#open-source`, words in `OPEN_SOURCE` in `lib/content.ts`), with the commands that build the app. The hero's "Open source." leads there. The repository's name is `SITE.repo` in `lib/site.ts`.

- The count in the HTML comes from GitHub's API while the page is built (`lib/github.ts`), so it's there from the first paint. If GitHub doesn't answer, the page shows the link without a count.
- In the browser, `components/star-count.tsx` then reads `/github.json`, which the server refreshes every ten minutes (`deploy/github-stars.mjs`, the repository's `deploy/README.md`), so the count stays current between deploys and visitors' browsers never contact GitHub. `npm run dev` has no `/github.json` and keeps the build's count.
- Phones show the GitHub mark and the count without the word, and the narrowest (under 360 px) the mark alone.

## Design

- The page is set in Jost, a geometric face that matches the wordmark; the app's screens use the app's own Geist. The accent is the app's navy, only on the primary download button. Light and dark follow the visitor's system.
- `components/screens/` redraws the app's Today, Timeline and Flow views with the app's own sizes and color tokens, so they follow the theme. Update them when the app's look changes.
- `components/screen-deck.tsx` shows the three screens in 3D. Each holds the front for six seconds (the line under its tab shows the time left), then steps back as the next comes forward. Hovering pauses it, picking a tab stops it, and the arrow keys move between tabs. With reduced motion it neither cycles nor animates.

## Brand assets

- `public/brand/wordmark.png` is the approved wordmark (the app's `public/brand/pacedmind-wordmark.png`), cropped to the letters with the ink as alpha, so the page can draw it in any color. `lib/brand.ts` has the letter bounds and the intro timing: the page opens on the pd emblem, then the last d travels right and the letters appear as it passes them.
- `public/brand/emblem.svg`, `app/icon.svg`, `app/favicon.ico` and `app/apple-icon.png` are the pd emblem. So are `public/icon-192.png` and `public/icon-512.png`, for the web manifest and the Organization logo, rendered by the app's `scripts/make-icons.mjs` (the 512 is the app's `public/brand/pacedmind-emblem.png`).
- `app/opengraph-image.png` is the link preview: the wordmark and "Find your pace." in Jost Light, 1200×630.
