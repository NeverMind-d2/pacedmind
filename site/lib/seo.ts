import type { Metadata } from "next";
import { SITE, absoluteUrl } from "@/lib/site";
import { DESCRIPTION, NAME, ONE_DEVICE, TITLE } from "@/lib/content";

/**
 * What every page that should be found needs: one canonical URL, the same URL for link previews, and
 * permission for large image previews. The 404 page doesn't use this, so it declares none of it.
 * A page's own title and description (the layout's otherwise) go to the link preview too; without
 * them the preview says the brand line, like the preview image.
 */
export function pageMetadata(path: string, page: { title?: string; description?: string } = {}): Metadata {
  return {
    ...page,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: NAME,
      locale: "en_US",
      url: path,
      title: page.title ? `${page.title} · ${NAME}` : TITLE,
      description: page.description ?? DESCRIPTION,
    },
    robots: { index: true, follow: true, "max-image-preview": "large" },
  };
}

/**
 * Structured data (schema.org JSON-LD) for search and answer engines. Everything here describes what
 * the page itself says; nothing is claimed that a visitor can't see.
 *
 * The @ids are stable anchors: nodes point at each other by @id instead of repeating themselves,
 * and the docs at /docs should point at these same ids rather than describe PacedMind again.
 */
export const IDS = {
  organization: `${SITE.url}/#organization`,
  website: `${SITE.url}/#website`,
  software: `${SITE.url}/#software`,
  faq: `${SITE.url}/#faq`,
};

type Node = Record<string, unknown>;

export const graph = (...nodes: Node[]) => ({ "@context": "https://schema.org", "@graph": nodes });

export function organization(): Node {
  return {
    "@type": "Organization",
    "@id": IDS.organization,
    name: NAME,
    url: absoluteUrl("/"),
    logo: { "@type": "ImageObject", url: absoluteUrl("/icon-512.png"), width: 512, height: 512 },
    // Add sameAs only for profiles that exist and are public: a dead link there counts against the site.
  };
}

/** Gives search results the site name "PacedMind". */
export function website(): Node {
  return {
    "@type": "WebSite",
    "@id": IDS.website,
    name: NAME,
    url: absoluteUrl("/"),
    inLanguage: "en",
    publisher: { "@id": IDS.organization },
  };
}

/**
 * The app. It has no Offer until its plans can be bought and are on the page: the prices differ by
 * country, which one Offer can't say honestly. Google shows a software rich result only with genuine
 * ratings or reviews, so this is for understanding the entity, not for stars.
 */
export function softwareApplication(): Node {
  return {
    "@type": "SoftwareApplication",
    "@id": IDS.software,
    name: NAME,
    description: DESCRIPTION,
    url: absoluteUrl("/"),
    image: absoluteUrl("/opengraph-image.png"),
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "Planner",
    operatingSystem: "Windows, macOS",
    downloadUrl: [...new Set(Object.values(SITE.downloads))],
    featureList: ONE_DEVICE,
    publisher: { "@id": IDS.organization },
  };
}

/**
 * The questions the page shows, as the page shows them. Google keeps FAQ rich results for government
 * and health sites, but answer engines read this, and it must never list a question the page doesn't.
 */
export function faqPage(entries: readonly { question: string; answer: string }[]): Node {
  return {
    "@type": "FAQPage",
    "@id": IDS.faq,
    isPartOf: { "@id": IDS.website },
    about: { "@id": IDS.software },
    mainEntity: entries.map(({ question, answer }) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
}
