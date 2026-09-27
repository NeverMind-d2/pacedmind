# Checks and search engines

https://pacedmind.com is two static builds on the OVH VPS (Ubuntu 26.04, Caddy from Ubuntu's repositories), next to the web app at app.pacedmind.com: the home page (`site/out`) in `/srv/pacedmind/site`, and the docs (`docs/out`, basePath `/docs`) in `/srv/pacedmind/docs`, served at `/docs`. The repository's `deploy/` sets up the server, holds its whole Caddy config (`deploy/Caddyfile`) and uploads all three: see `deploy/README.md`. This page has the checks after a deploy and the setup for search engines.

## Check

```bash
curl -sI http://pacedmind.com/                # 308 to https://pacedmind.com/
curl -sI "http://www.pacedmind.com/?a=1"      # 301 to https://pacedmind.com/?a=1, in one hop
curl -sI https://pacedmind.com/index.html     # 301 to /
curl -sI https://pacedmind.com/nope           # 404, the site's 404 page
curl -sI -H 'Accept-Encoding: gzip' https://pacedmind.com/ # content-encoding: gzip, cache-control: no-cache
curl -sI https://pacedmind.com/docs/          # 301 to /docs
curl -sI https://pacedmind.com/docs/nope      # 404, the docs' 404 page
curl -sI https://pacedmind.com/docs/views/timeline.mdx     # text/markdown, x-robots-tag: noindex
curl -sI https://pacedmind.com/docs/api/search             # application/json, x-robots-tag: noindex
curl -s https://pacedmind.com/robots.txt
curl -s https://pacedmind.com/sitemap.xml
curl -s https://pacedmind.com/llms.txt
```

Then paste https://pacedmind.com/ into:

- the Schema Markup Validator (https://validator.schema.org/): it should find Organization, WebSite, SoftwareApplication and FAQPage without errors;
- Google's Rich Results Test (https://search.google.com/test/rich-results). It may report no eligible rich results, and that's expected: Google shows app results only with ratings, and FAQ results only for government and health sites. The data is still read;
- PageSpeed Insights (https://pagespeed.web.dev/), for Core Web Vitals.

## Google Search Console

1. Open https://search.google.com/search-console and choose **Add property**, then **Domain**, and enter `pacedmind.com`. A Domain property covers http and https, and www and the bare domain, so redirects and canonicals are reported together.
2. Google shows a TXT record, `google-site-verification=…`. In the OVH DNS zone choose **Add an entry**, then **TXT**, leave the subdomain empty, and paste the whole value. Back in Search Console, click **Verify**. DNS can take up to a few hours; keep the record afterwards.
   - Without access to the DNS, add a **URL prefix** property for `https://pacedmind.com/` instead and choose **HTML tag**. Copy only the `content` value into `verification.google` in `site/lib/site.ts`, then build, deploy and click **Verify**.
3. Under **Indexing → Sitemaps**, submit `https://pacedmind.com/sitemap.xml` and `https://pacedmind.com/docs/sitemap.xml`. Both should read **Success**. robots.txt names both, so crawlers find them either way.
4. In **URL inspection** (the search bar at the top), enter `https://pacedmind.com/`, choose **Test live URL**, and check that it says the page can be indexed. **View tested page** shows the HTML Google rendered, with the FAQ and the JSON-LD in it. Then choose **Request indexing**, and do the same for `https://pacedmind.com/docs`. Once a page is indexed, its user-declared and Google-selected canonical should be the same URL.
5. After a few days, open **Indexing → Pages**. The home page and the docs pages should be under Indexed. These reasons for pages not indexed are expected: **Page with redirect** (http, www, `.html` and `/index.html` addresses), **Not found (404)**, and **Excluded by 'noindex' tag** (the files Next.js fetches for navigation, the docs' Markdown copies and their search index). Look into anything else, such as **Duplicate, Google chose different canonical than user**.
6. **Settings → robots.txt** shows whether Google could fetch it. **Experience → Core Web Vitals** says "Not enough usage data" until enough Chrome users have visited.

## Bing Webmaster Tools

Bing's index also feeds Microsoft Copilot and DuckDuckGo, and some AI answer engines draw on it.

1. Sign in at https://www.bing.com/webmasters.
2. Choose **Import from Google Search Console**: it brings the verified site and its sitemaps along. Or add `https://pacedmind.com/` by hand and verify it with the CNAME record Bing shows (added in the OVH DNS zone), or with the meta tag: copy its `content` value into `verification.bing` in `site/lib/site.ts`, build, deploy and verify.
3. Under **Sitemaps**, submit both sitemap URLs if the import didn't bring them.
4. In **URL Inspection**, inspect `https://pacedmind.com/` and request indexing.

## When something changes

- A new page on the site: give it `pageMetadata("/path")` (lib/seo.ts) and add it to `app/sitemap.ts` with the files it's made of. Never list a URL that robots.txt disallows.
- New robots rules in the docs app: repeat them in `site/app/robots.ts` with the `/docs` prefix, because only the root robots.txt counts. Today the docs disallow nothing.
- A new domain: `SITE.url` in `site/lib/site.ts`, `siteUrl` in `docs/src/lib/shared.ts`, the host names in `deploy/Caddyfile`, and a new Search Console property.
