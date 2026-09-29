// Pieces of the app drawn on the page (the command palette's results, the day strip), from its own sizes, icons and
// color tokens (src/components/ in the app), so they follow the page's light or dark theme; and the size of the
// screenshots in the hero's deck.

/** The deck's screens: screenshots of this shape (site/screens, `npm run screenshots` in the app), drawn this size. */
export const SCREEN = { w: 1056, h: 640 };
export const AREA = { work: "#7D93B5", personal: "#7FA894", dev: "#7AA3AD" };

const PATHS = {
  back: "M19 12H5M11 6l-6 6 6 6",
  forward: "M5 12h14M13 6l6 6-6 6",
  search: "M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0 M20 20l-3.5-3.5",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z",
  sun: "M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  clock: "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0 M12 7v5l3 2",
  calendar: "M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M3 9h18M8 2v4M16 2v4",
  timeline: "M4 6h9M9 12h11M6 18h8",
  box: "M21 8l-9-5-9 5v8l9 5 9-5z M3 8l9 5 9-5 M12 13v8",
  roadmap: "M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15",
  terminal: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M7 10l3 2-3 2 M12 15h5",
  appWindow: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M3 9h18 M6.5 6.5h.01 M9.5 6.5h.01",
  cloud: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chevronDown: "M6 9l6 6 6-6",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
  check: "M5 12l5 5 9-10",
  // The page's open-source parts, from Feather.
  code: "M16 18l6-6-6-6 M8 6l-6 6 6 6",
  pullRequest: "M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M13 6h3a2 2 0 0 1 2 2v7 M6 9v12",
  star: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z",
  copy: "M11 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
};
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, strokeWidth = 1.8, className = "" }: { name: IconName; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export type Status = "backlog" | "todo" | "progress" | "review" | "done";

export function StatusIcon({ status }: { status: Status }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      {status === "done" ? (
        <>
          <circle cx="7" cy="7" r="6.75" fill="var(--color-app-accent)" />
          <path d="M4.4 7.2 L6.2 9 L9.7 5.3" fill="none" stroke="var(--color-app-panel)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === "backlog" ? (
        <circle cx="7" cy="7" r="6" fill="none" strokeWidth="1.5" strokeDasharray="2 2" stroke="var(--color-app-mut2)" />
      ) : (
        <>
          <circle cx="7" cy="7" r="6" fill="none" strokeWidth="1.5" stroke={status === "progress" ? "var(--color-app-mut)" : "var(--color-app-fg3)"} />
          {status === "progress" && <path d="M7 3 A4 4 0 0 1 7 11 Z" fill="var(--color-app-mut)" />}
          {status === "review" && <path d="M7 7 L7 3 A4 4 0 1 1 3 7 Z" fill="var(--color-app-fg3)" />}
        </>
      )}
    </svg>
  );
}

export function Group({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-app-line bg-app-raised pl-5 pr-4 text-[12.5px] font-medium text-app-fg2">
      <Icon name="chevronDown" size={12} strokeWidth={2.4} className="text-app-mut2" />
      {name}
      <span className="font-normal text-app-mut2">{count}</span>
    </div>
  );
}
