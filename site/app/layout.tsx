import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Jost } from "next/font/google";
import { SITE } from "@/lib/site";
import "./globals.css";

// Jost for the page: geometric, with round bowls and a single-storey "a" like the wordmark.
const jost = Jost({ variable: "--font-jost", subsets: ["latin", "latin-ext"] });
// The app's own typefaces, for the screens of the app.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin", "latin-ext"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const description = "A calm planner for your tasks, time blocks and deadlines. It starts your Claude Code and Codex sessions and tells you when one is waiting for you. Free and open source for Windows and macOS.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: "PacedMind: Find your pace.",
  description,
  applicationName: "PacedMind",
  openGraph: { type: "website", siteName: "PacedMind", title: "PacedMind: Find your pace.", description, url: "/" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

// Runs before the first paint, so the download for the visitor's system is the primary button
// without a flash (everything that isn't a Mac or an iPhone or iPad gets Windows), and marks that
// scripts run, which the screen deck waits for.
const OS_SCRIPT = `document.documentElement.dataset.os=/mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform||navigator.platform||navigator.userAgent)?"mac":"windows";document.documentElement.dataset.js=""`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jost.variable} ${geistSans.variable} ${geistMono.variable}`}>
      <head><script id="os" dangerouslySetInnerHTML={{ __html: OS_SCRIPT }} /></head>
      {/* The 3D deck reaches past the text column; clip it at the window edge so it never widens the page. */}
      <body><div className="overflow-x-clip">{children}</div></body>
    </html>
  );
}
