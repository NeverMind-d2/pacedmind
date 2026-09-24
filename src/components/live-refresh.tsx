"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the page when data changed somewhere else, e.g. an agent reported progress over MCP. */
export function LiveRefresh({ every = 4000 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last: string | null = null;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await fetch("/api/state", { cache: "no-store" });
        const { version } = (await r.json()) as { version: string };
        if (last !== null && version !== last) router.refresh();
        last = version;
      } catch {
        // The server is restarting; try again on the next tick.
      } finally {
        busy = false;
      }
    };
    check();
    const id = window.setInterval(check, every);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, every]);
  return null;
}
