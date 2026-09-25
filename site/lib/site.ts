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
} as const;

/** The absolute URL of a path on the site, written the way Next writes the page's canonical link. */
export function absoluteUrl(path: string) {
  return path === "/" ? SITE.url : `${SITE.url}${path}`;
}
