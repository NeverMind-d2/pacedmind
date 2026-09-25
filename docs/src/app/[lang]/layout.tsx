import '../global.css';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Jost } from 'next/font/google';
import { DocsProvider } from '@/components/DocsProvider';
import StaticSearchDialog from '@/components/SearchDialog';
import { i18n } from '@/lib/i18n';
import { siteUrl } from '@/lib/shared';

// The app's own typefaces for the text, and Jost (as on pacedmind.com) for titles.
const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'latin-ext'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const jost = Jost({ variable: '--font-jost', subsets: ['latin', 'latin-ext'] });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    template: '%s | PacedMind Docs',
    default: 'PacedMind Docs',
  },
  description:
    'User guide for PacedMind, the personal planner for tasks, time blocks and deadlines that also starts and tracks Claude Code and Codex sessions.',
  applicationName: 'PacedMind',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#010101' },
  ],
};

const locales = [{ name: 'English', locale: 'en' }];

// UI strings per language; English uses the Fumadocs defaults. Add a language here with its
// translations (search, toc, lastUpdate, chooseLanguage, nextPage, previousPage, chooseTheme,
// editOnGithub) when it gets pages.
const translations: Record<string, Record<string, string>> = {};

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export default async function Layout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  return (
    <html
      lang={lang}
      className={`${geistSans.variable} ${geistMono.variable} ${jost.variable} font-sans`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <DocsProvider
          i18n={{ locale: lang, locales, translations: translations[lang] }}
          search={{
            // Static search: the build writes the index to /docs/api/search and
            // the browser searches it, so no server is needed.
            SearchDialog: StaticSearchDialog,
          }}
          theme={{
            attribute: 'class',
            defaultTheme: 'system',
            enableSystem: true,
            disableTransitionOnChange: true,
          }}
        >
          {children}
        </DocsProvider>
      </body>
    </html>
  );
}
