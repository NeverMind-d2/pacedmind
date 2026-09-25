// The one canonical origin, without www and without a trailing slash. The server redirects
// http:// and www.pacedmind.com here (deploy/).
const url = "https://pacedmind.com";

/** Public addresses: the site, its docs and the downloads. */
export const SITE = {
  url,
  // The documentation, a separate app served from the same domain.
  docs: "/docs",
  // The current installers, which `npm run release` uploads (deploy/Caddyfile leads these to them).
  downloads: {
    windows: `${url}/download/windows`,
    mac: `${url}/download/mac`,
  },
  // Search engine ownership tokens, printed as <meta> tags when set. Leave them empty when the
  // domain is verified through DNS, which also covers every subdomain and protocol.
  verification: {
    google: "", // Google Search Console: the content of google-site-verification
    bing: "", // Bing Webmaster Tools: the content of msvalidate.01
  },
  // Umami, cookieless visitor statistics (deploy/umami), shared with the docs (analytics in
  // docs/src/lib/shared.ts): one website counts the whole domain. The tracker comes from this site
  // (the server passes /stats/* through to Umami) and loads only on this host, so local builds count
  // nothing. websiteId is the website's id in the dashboard at stats.pacedmind.com; empty turns it off.
  analytics: {
    websiteId: "dbfe3125-591a-4b12-bd01-56e61aa753d2",
    script: "/stats/script.js",
    hostname: "pacedmind.com",
  },
} as const;

/** The absolute URL of a path on the site, written the way Next writes the page's canonical link. */
export function absoluteUrl(path: string) {
  return path === "/" ? SITE.url : `${SITE.url}${path}`;
}

/** Makes Umami count a click on a download button as a "Download" event, with the system and where the button is. */
export function downloadEvent(os: "windows" | "mac", place: "hero" | "pricing") {
  return { "data-umami-event": "Download", "data-umami-event-os": os, "data-umami-event-place": place };
}
