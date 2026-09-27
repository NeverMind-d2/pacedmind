"use client";

import { useSyncExternalStore } from "react";
import { SITE } from "@/lib/site";
import { isCount } from "@/lib/github";
import { Icon } from "@/components/screens/parts";

// The count the server keeps current (deploy/github-stars.mjs), asked for once, by the first count on the page.
// Until it arrives, and when there's none (as with `npm run dev`), every count shows the one from the page's build.
let latest: number | null = null;
let asked = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!asked) {
    asked = true;
    fetch(SITE.stars)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCount(data?.stars)) return;
        latest = data.stars;
        listeners.forEach((l) => l());
      })
      .catch(() => {});
  }
  return () => listeners.delete(listener);
};

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** The repository's stars on GitHub, with a star; nothing when the count isn't known. */
export function StarCount({ initial, className = "" }: { initial: number | null; className?: string }) {
  const stars = useSyncExternalStore(subscribe, () => latest, () => null) ?? initial;
  if (stars === null) return null;
  const said = `${stars.toLocaleString("en")} ${stars === 1 ? "star" : "stars"}`;
  return (
    <span title={`${said} on GitHub`} className={`inline-flex items-center gap-1 tabular-nums ${className}`}>
      <Icon name="star" size={14} />
      <span aria-hidden="true">{compact.format(stars)}</span>
      <span className="sr-only">{said}</span>
    </span>
  );
}
