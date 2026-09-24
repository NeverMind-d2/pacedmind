import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE } from "@/lib/site";
import "./globals.css";

// The app's typefaces, so the page reads like the product it shows.
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
// without a flash. Everything that isn't a Mac or an iPhone or iPad gets Windows.
const OS_SCRIPT = `document.documentElement.dataset.os=/mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform||navigator.platform||navigator.userAgent)?"mac":"windows"`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <head><script id="os" dangerouslySetInnerHTML={{ __html: OS_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
