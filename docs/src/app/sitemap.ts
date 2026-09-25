import { execFileSync } from 'node:child_process';

import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { i18n } from '@/lib/i18n';
import { siteUrl } from '@/lib/shared';

// Written to out/sitemap.xml by the static build, served at /docs/sitemap.xml.
export const dynamic = 'force-static';

/**
 * Last commit date of a page's MDX source.
 *
 * This replaces a single `new Date()` shared by every entry, which stamped the
 * whole sitemap as "modified now" on every build, telling crawlers that all
 * URLs change constantly, which devalues the freshness signal rather than
 * strengthening it.
 *
 * Uses git rather than the filesystem mtime **on purpose**: git does not
 * preserve mtimes, so on a CI checkout every file's mtime is the checkout
 * time. That would reproduce the original bug while looking like real data —
 * timestamps that differ only by milliseconds. Commit dates are stable across
 * checkouts and are the only honest source here.
 *
 * Caveat: a shallow clone (actions/checkout defaults to fetch-depth 1) only
 * knows the tip commit, so every page collapses to that one date. It is still
 * a real date and still stable between builds that change nothing. If per-page
 * accuracy matters, set fetch-depth: 0 in the workflow.
 *
 * Returns undefined — omitting the field — rather than falling back to "now".
 * No date is better than a wrong one. Pages that aren't committed yet have none.
 *
 * The build runs in docs/, so git resolves `content/docs/...` inside the docs
 * folder of the PacedMind repository.
 */
const gitDateCache = new Map<string, Date | undefined>();

function gitLastModified(relativePath: string): Date | undefined {
  const cached = gitDateCache.get(relativePath);
  if (cached !== undefined || gitDateCache.has(relativePath)) return cached;

  let result: Date | undefined;
  try {
    const iso = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', `content/docs/${relativePath}`],
      { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    if (iso) {
      const parsed = new Date(iso);
      if (!Number.isNaN(parsed.getTime())) result = parsed;
    }
  } catch {
    result = undefined;
  }

  gitDateCache.set(relativePath, result);
  return result;
}

/**
 * Builds the public URL for a given (locale, slugs[]) pair, accounting for
 * basePath '/docs' and the hideLocale: 'default-locale' setting.
 *
 *  ('en', [])                       -> https://pacedmind.com/docs
 *  ('en', ['getting-started'])      -> https://pacedmind.com/docs/getting-started
 *  ('pl', [])                       -> https://pacedmind.com/docs/pl
 *  ('pl', ['getting-started'])      -> https://pacedmind.com/docs/pl/getting-started
 */
function urlFor(locale: string, slugs: string[]): string {
  const langPart = locale === i18n.defaultLanguage ? '' : `/${locale}`;
  const slugPart = slugs.length > 0 ? `/${slugs.join('/')}` : '';
  return `${siteUrl}/docs${langPart}${slugPart}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  // Group pages by slug (joined) so we can emit one sitemap entry per page,
  // each carrying alternates.languages for the en/pl pair.
  const bySlug = new Map<
    string,
    { slugs: string[]; perLocale: Map<string, Date | undefined> }
  >();

  for (const lang of i18n.languages) {
    for (const page of source.getPages(lang)) {
      const key = page.slugs.join('/');
      const entry =
        bySlug.get(key) ?? { slugs: page.slugs, perLocale: new Map() };
      entry.perLocale.set(lang, gitLastModified(page.path));
      bySlug.set(key, entry);
    }
  }

  // The section landing pages have no single source file of their own, so the
  // home entries carry the newest page mtime — the last time anything in the
  // documentation actually changed.
  const allMtimes = Array.from(bySlug.values())
    .flatMap(({ perLocale }) => Array.from(perLocale.values()))
    .filter((d): d is Date => d instanceof Date);
  const newestMtime = allMtimes.length
    ? new Date(Math.max(...allMtimes.map((d) => d.getTime())))
    : undefined;

  // Home pages (one per locale).
  const homeEntries = i18n.languages.map((lang) => ({
    url: urlFor(lang, []),
    lastModified: newestMtime,
    changeFrequency: 'monthly' as const,
    priority: lang === i18n.defaultLanguage ? 1.0 : 0.9,
    alternates: {
      languages: Object.fromEntries(
        i18n.languages.map((l) => [l, urlFor(l, [])]),
      ),
    },
  }));

  // Guide pages, with alternates for each locale that has the page.
  const pageEntries = Array.from(bySlug.values()).map(
    ({ slugs, perLocale }) => {
      const localesWithPage = Array.from(perLocale.keys());
      const primaryLocale =
        localesWithPage.find((l) => l === i18n.defaultLanguage) ??
        localesWithPage[0];

      // Prefer the primary locale's own mtime; fall back to the newest sibling
      // so an entry is never stamped with an unrelated date.
      const localeMtimes = Array.from(perLocale.values()).filter(
        (d): d is Date => d instanceof Date,
      );

      return {
        url: urlFor(primaryLocale, slugs),
        lastModified:
          perLocale.get(primaryLocale) ??
          (localeMtimes.length
            ? new Date(Math.max(...localeMtimes.map((d) => d.getTime())))
            : undefined),
        changeFrequency: 'weekly' as const,
        priority: 0.8,
        alternates: {
          languages: Object.fromEntries(
            localesWithPage.map((l) => [l, urlFor(l, slugs)]),
          ),
        },
      };
    },
  );

  return [...homeEntries, ...pageEntries];
}
