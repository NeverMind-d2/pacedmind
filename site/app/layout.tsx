import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Jost } from "next/font/google";
import { SITE } from "@/lib/site";
import { NAME, SEARCH_DESCRIPTION, SEARCH_TITLE } from "@/lib/content";
import { graph, organization, website } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
import { Analytics } from "@/components/analytics";
import "./globals.css";

// Jost for the page: geometric, with round bowls and a single-storey "a" like the wordmark. Every
// subset stays available; `subsets` only picks what's preloaded, and the first paint needs Latin.
const jost = Jost({ variable: "--font-jost", subsets: ["latin"] });
// The app's own typefaces, for its pieces drawn further down the page (the day strip, the command
// palette's results) and the commands to copy. None of them is in the first view, so these aren't
// preloaded: they load once the browser lays those parts out, instead of competing with the first paint.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], preload: false });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], preload: false });

// Defaults for every page. Each page adds its own canonical URL through pageMetadata() in lib/seo.ts.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SEARCH_TITLE, template: `%s · ${NAME}` },
  description: SEARCH_DESCRIPTION,
  applicationName: NAME,
  twitter: { card: "summary_large_image" },
  verification: {
    google: SITE.verification.google || undefined,
    other: SITE.verification.bing ? { "msvalidate.01": SITE.verification.bing } : undefined,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  colorScheme: "light dark",
};

// Runs before the first paint, so the download for the visitor's system is the primary button
// without a flash (everything that isn't a Mac or an iPhone or iPad gets Windows), and marks that
// scripts run, which the screen deck waits for.
const OS_SCRIPT = `document.documentElement.dataset.os=/mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform||navigator.platform||navigator.userAgent)?"mac":"windows";document.documentElement.dataset.js=""`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jost.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <head><script id="os" dangerouslySetInnerHTML={{ __html: OS_SCRIPT }} /></head>
      <body>
        <JsonLd data={graph(organization(), website())} />
        {/* The 3D deck reaches past the text column; clip it at the window edge so it never widens the page. */}
        <div className="overflow-x-clip">{children}</div>
        <Analytics />
      </body>
    </html>
  );
}
