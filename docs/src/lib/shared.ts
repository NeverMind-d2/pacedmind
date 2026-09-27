export const appName = 'PacedMind Docs';

// With basePath '/docs' on the Next.js app, the docs are mounted at
// pacedmind.com/docs/* externally. Internally the app sees URLs without the
// /docs prefix, so all internal route helpers below stay rooted at "/".
export const docsRoute = '/';
export const docsImageRoute = '/og';
export const docsContentRoute = '/llms.mdx';

// Public-facing absolute origin (used by sitemap, JSON-LD, canonical URLs).
// Keep in step with SITE.url in ../site/lib/site.ts.
export const siteUrl = 'https://pacedmind.com';
export const docsUrl = `${siteUrl}/docs`;

/**
 * The schema.org entities the home page describes (../site/lib/seo.ts). The docs'
 * JSON-LD points at them by @id instead of describing PacedMind again, so search and
 * answer engines see one organization, one website and one app. Keep the ids exact:
 * `https://pacedmind.com/#organization`, with the slash.
 */
export const schemaIds = {
  organization: `${siteUrl}/#organization`,
  website: `${siteUrl}/#website`,
  software: `${siteUrl}/#software`,
};

/**
 * Umami, cookieless visitor statistics (../deploy/umami). The same website as the home page's
 * (SITE.analytics in ../site/lib/site.ts; keep the two in step), so one website counts the whole
 * domain. The tracker comes from pacedmind.com itself (the server passes /stats/* through to Umami)
 * and loads only on that host, so local builds count nothing. An empty websiteId turns it off.
 */
export const analytics = {
  websiteId: 'dbfe3125-591a-4b12-bd01-56e61aa753d2',
  script: '/stats/script.js',
  hostname: 'pacedmind.com',
};

/** The publisher and author of every page: a reference to the home page's Organization. */
export const organizationRef = {
  '@type': 'Organization',
  '@id': schemaIds.organization,
  name: 'PacedMind',
  url: siteUrl,
};

/**
 * The repository the docs are edited in. The "View on GitHub" links stay hidden
 * until `repoPublic` is true, so the published docs never link to a private repo.
 * Page sources live under docs/content/docs/ in it.
 */
export const gitConfig = {
  user: 'Pacedmind',
  repo: 'pacedmind',
  branch: 'master',
  repoPublic: true,
};

export const repoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
