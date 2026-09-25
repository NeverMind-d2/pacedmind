import { createMDX } from 'fumadocs-mdx/next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

const withMDX = createMDX();

// Keep in step with `i18n` in src/lib/i18n.ts and scripts/postbuild.mjs.
const defaultLanguage = 'en';
const otherLanguages = [];

/**
 * The default language is served without a prefix (/docs/views/today, not
 * /docs/en/views/today): `hideLocale: 'default-locale'`. A static export has no
 * proxy to rewrite URLs, so the build moves the default language's files to the
 * root instead (scripts/postbuild.mjs). `next dev` gets the same URLs
 * from this rewrite. It runs after files and static routes are matched, so
 * /api/search, /sitemap.xml and the public folder are not rewritten.
 */
const localePrefix = [defaultLanguage, ...otherLanguages].join('|');
const devRewrites = [
  { source: '/', destination: `/${defaultLanguage}` },
  {
    source: `/:path((?!(?:${localePrefix})(?:/|$)).*)`,
    destination: `/${defaultLanguage}/:path`,
  },
];

/** @type {(phase: string) => import('next').NextConfig} */
export default function config(phase) {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return withMDX({
    reactStrictMode: true,
    // Mounted as a subdirectory of the main site (pacedmind.com/docs), beside the
    // home page from ../site, so search authority stays on a single property and
    // the docs can appear as sitelinks under pacedmind.com.
    basePath: '/docs',
    // `npm run build` writes plain files to out/ for Caddy or Nginx (README.md).
    // Only for the build: a static export refuses rewrites, which `next dev` needs.
    output: dev ? undefined : 'export',
    devIndicators: false,
    // src/app/global-not-found.tsx: a styled 404 (out/404.html). The root layout sits under the
    // [lang] segment, so there is no layout a regular not-found page could use.
    experimental: { globalNotFound: true },
    // The docs sit inside the app's repository, which has its own lockfile higher
    // up. Without this, Turbopack would treat the whole repository as the project.
    turbopack: { root: import.meta.dirname },
    ...(dev && {
      async rewrites() {
        return { beforeFiles: [], afterFiles: devRewrites, fallback: [] };
      },
    }),
  });
}
