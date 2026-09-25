/**
 * Public addresses. The repository has no public remote yet, so its links are the expected ones:
 * change them here when the repository and its releases exist.
 */
export const SITE = {
  // The one canonical origin, without www and without a trailing slash. The server redirects
  // http:// and www.pacedmind.com here (deploy/).
  url: "https://pacedmind.com",
  // The documentation, a separate app served from the same domain.
  docs: "/docs",
  repo: "https://github.com/NeverMind-d2/pacedmind",
  downloads: {
    windows: "https://github.com/NeverMind-d2/pacedmind/releases/latest",
    mac: "https://github.com/NeverMind-d2/pacedmind/releases/latest",
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
