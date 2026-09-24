# PacedMind website

The public home page: a static Next.js site, separate from the desktop app. It has its own dependencies, and `npm run build` writes plain files to `out/`.

```bash
cd site
npm install
npm run dev      # http://127.0.0.1:4330
npm run build    # static files in out/
```

Deploy `out/` to any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages). Before the first deploy, set the domain, the repository and the download links in `lib/site.ts`.

## Cloud price

Cloud costs the same as Spotify Premium Individual in each country (in India, where that plan is called Premium Standard). The prices are in `prices.json`. Visitors see the price for their country, guessed from their time zone and then their browser language, and can pick another country. Anyone else sees the US price. The page itself never names Spotify: it says "a music subscription".

Check the prices regularly:

```bash
npm run prices              # compares prices.json with spotify.com; exits with 1 if a price changed
npm run prices -- --write   # also saves the new prices and today's date
```

A change of more than 40% is never saved, because it more likely means the page was misread: check that country by hand. To add a country, add it to `prices.json` with `"amount": 0` and run with `--write`.

## Design

- The page is set in Jost, a geometric face that matches the wordmark; the app's screens use the app's own Geist. The accent is the app's navy, only on the primary download button. Light and dark follow the visitor's system.
- `components/screens/` redraws the app's Today, Timeline and Flow views with the app's own sizes and color tokens, so they follow the theme. Update them when the app's look changes.
- `components/screen-deck.tsx` shows the three screens in 3D. Each holds the front for six seconds (the line under its tab shows the time left), then steps back as the next comes forward. Hovering pauses it, picking a tab stops it, and the arrow keys move between tabs. With reduced motion it neither cycles nor animates.

## Brand assets

- `public/brand/wordmark.png` is the approved wordmark (the app's `public/brand/pacedmind-wordmark.png`), cropped to the letters with the ink as alpha, so the page can draw it in any color. `lib/brand.ts` has the letter bounds and the intro timing: the page opens on the pd emblem, then the last d travels right and the letters appear as it passes them.
- `public/brand/emblem.svg`, `app/icon.svg`, `app/favicon.ico` and `app/apple-icon.png` are the pd emblem.
- `app/opengraph-image.png` is the link preview: the wordmark and "Find your pace." in Jost Light, 1200×630.
