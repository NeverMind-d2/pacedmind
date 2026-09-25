import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { i18n } from './i18n';
import { docsUrl, siteUrl } from './shared';

export const source = loader({
  // The Next.js app runs with basePath '/docs', so internally the docs
  // are rooted at '/'. Fumadocs page URLs therefore use '/' as the base;
  // Next.js prepends '/docs' when rendering links.
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
  i18n,
});

// External absolute paths for OG / llms.mdx routes. metadataBase resolves
// relative paths from origin only, so we include the basePath here so the
// final absolute URLs (e.g. og:image) come out as
//   https://pacedmind.com/docs/og/.../image.png
const externalLocale = (locale?: string) => {
  if (!locale || locale === i18n.defaultLanguage) return '';
  return `/${locale}`;
};

export function getPageImage(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png'];
  return {
    segments,
    url: `/docs${externalLocale(page.locale)}/og/${segments.join('/')}`,
  };
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md'];
  return {
    segments,
    url: `/docs${externalLocale(page.locale)}/llms.mdx/${segments.join('/')}`,
  };
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title} (${publicUrl(page.locale ?? i18n.defaultLanguage, page.slugs)})

${absoluteLinks(processed)}`;
}

/**
 * The pages link to each other without the base path (/views/timeline) and embed images with it
 * (/docs/screenshots/…). Read outside the site, as llms.txt files and Markdown copies are, those
 * would resolve against pacedmind.com's root, so they become absolute URLs.
 */
function absoluteLinks(markdown: string): string {
  return markdown
    .replace(/\]\((\/(?!docs\/)[^)\s]*)\)/g, (_, path: string) => `](${docsUrl}${path === '/' ? '' : path})`)
    .replace(/src="\/docs\//g, `src="${docsUrl}/`);
}

/**
 * Builds the absolute public URL for a given (locale, slugs[]) pair.
 * Mirrors the logic in sitemap.ts so canonical, hreflang, and og:url
 * tags match what the sitemap advertises.
 *
 *  ('en', [])                  -> https://pacedmind.com/docs
 *  ('en', ['getting-started']) -> https://pacedmind.com/docs/getting-started
 *  ('pl', ['getting-started']) -> https://pacedmind.com/docs/pl/getting-started
 */
export function publicUrl(locale: string, slugs: string[] = []): string {
  const langPart = locale === i18n.defaultLanguage ? '' : `/${locale}`;
  const slugPart = slugs.length > 0 ? `/${slugs.join('/')}` : '';
  return `${siteUrl}/docs${langPart}${slugPart}`;
}

/** Returns { canonical, languages } shaped for Next.js Metadata.alternates. */
export function pageAlternates(page: (typeof source)['$inferPage']): {
  canonical: string;
  languages: Record<string, string>;
} {
  const locale = page.locale ?? i18n.defaultLanguage;
  const languages: Record<string, string> = {};
  for (const lang of i18n.languages) {
    // Only emit hreflang for languages that actually have this page.
    const altPage = source.getPage(page.slugs, lang);
    if (altPage) languages[lang] = publicUrl(lang, page.slugs);
  }
  // x-default points to the canonical (default-locale) version, per
  // Google's hreflang guidance for sites without geo-targeting.
  const defaultPage = source.getPage(page.slugs, i18n.defaultLanguage);
  if (defaultPage) {
    languages['x-default'] = publicUrl(i18n.defaultLanguage, page.slugs);
  }
  return {
    canonical: publicUrl(locale, page.slugs),
    languages,
  };
}
