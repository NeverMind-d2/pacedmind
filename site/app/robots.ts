import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

// Written to out/robots.txt at build time.
export const dynamic = "force-static";

// Crawlers read robots.txt only at the root of the domain, so this file is the one in force for the
// docs at /docs too: the docs app's own robots.txt ends up at /docs/robots.txt, where no crawler
// looks. Keep the two in step, with the /docs prefix on any rule the docs add.
//
// The docs disallow nothing, on purpose: assistants read the Markdown copies in /docs/llms.mdx/, and
// link previews fetch the images in /docs/og/ (X's crawler honours robots.txt). The web server keeps
// the Markdown copies out of search results with an X-Robots-Tag: noindex header instead (deploy/),
// which is also what keeps a URL out of the index: a disallow only stops the crawl.

// Answer engines and AI crawlers, named so their access is explicit: some follow only a group that
// names them. They get the same rules as everyone else.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/" },
      { userAgent: AI_CRAWLERS, allow: "/" },
    ],
    // This site's pages, and the docs' pages.
    sitemap: [absoluteUrl("/sitemap.xml"), absoluteUrl("/docs/sitemap.xml")],
  };
}
