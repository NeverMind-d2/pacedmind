import './global.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Jost } from 'next/font/google';

// The 404 page for any URL under /docs that matches no page: out/404.html in the static build.
// It bypasses the [lang] layout (a root layout under a dynamic segment can't render it), so it
// loads its own styles and fonts, and applies the stored theme itself.

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'latin-ext'] });
const jost = Jost({ variable: '--font-jost', subsets: ['latin', 'latin-ext'] });

export const metadata: Metadata = {
  title: 'Page not found | PacedMind Docs',
  description: 'This page of the PacedMind documentation does not exist.',
};

// Before the first paint: the theme chosen on the docs (stored by next-themes as "theme"), else the system's.
const THEME_SCRIPT = `(() => { try { const t = localStorage.getItem('theme'); const dark = t === 'dark' || ((!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.classList.toggle('dark', dark); } catch {} })();`;

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${geistSans.variable} ${jost.variable} font-sans`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col bg-fd-background text-fd-foreground">
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-24">
          <p className="text-sm font-medium text-fd-muted-foreground">404</p>
          <h1 className="mt-3 font-display text-4xl font-light tracking-tight md:text-5xl">This page doesn&apos;t exist</h1>
          <p className="mt-5 text-base leading-relaxed text-fd-muted-foreground">
            The page may have moved, or the address has a typo. Start from the documentation&apos;s home page, which lists every
            guide, or open the full index.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/" className="rounded-md bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand/90">
              PacedMind Docs
            </Link>
            <a href="/docs/llms.txt" className="rounded-md border border-fd-border px-4 py-2 text-center text-sm hover:bg-fd-accent">
              Index of all pages
            </a>
            <a href="https://pacedmind.com/" className="rounded-md border border-fd-border px-4 py-2 text-center text-sm hover:bg-fd-accent">
              pacedmind.com
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
