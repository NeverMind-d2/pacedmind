"use client";

import { useEffect } from "react";
import { SITE } from "@/lib/site";

/** Loads Umami's tracker (SITE.analytics) on the live site only. It sets no cookies. */
export function Analytics() {
  useEffect(() => {
    const { websiteId, script, hostname } = SITE.analytics;
    if (!websiteId || location.hostname !== hostname) return;
    const tag = document.createElement("script");
    tag.src = script;
    tag.defer = true;
    tag.dataset.websiteId = websiteId;
    document.head.appendChild(tag);
  }, []);
  return null;
}
