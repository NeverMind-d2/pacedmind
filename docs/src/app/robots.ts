import type { MetadataRoute } from 'next';

/**
 * NOTE: this file is largely INERT.
 *
 * The app runs with basePath '/docs', so this is served at
 * /docs/robots.txt, and robots.txt is only honoured at the domain root.
 * No crawler reads it. The one in force is the home page's
 * (../site/app/robots.ts), served at https://pacedmind.com/robots.txt, which
 * lists the docs sitemap below. Keep the two in sync.
 *
 * Nothing under /docs is disallowed on purpose: AI assistants read the
 * Markdown copies in /llms.mdx/, and link previews (including X's, which
 * honours robots.txt) fetch the images in /og/. The web server keeps the
 * Markdown copies out of search results with an `X-Robots-Tag: noindex`
 * header instead (see README.md).
 */
export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: 'https://pacedmind.com/docs/sitemap.xml',
    host: 'https://pacedmind.com',
  };
}
