import type { ReactNode } from "react";
import { Wordmark } from "../wordmark";

// Stills of the app, built from its own sizes, icons and color tokens (src/components/ in the app),
// so they follow the page's light or dark theme. Every screen is SCREEN.w × SCREEN.h.

export const SCREEN = { w: 1056, h: 640 };
export const AREA = { work: "#7D93B5", personal: "#7FA894", dev: "#7AA3AD" };
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

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
  flow: "M4 4h6v6H4z M14 14h6v6h-6z M10 7h2a3 3 0 0 1 3 3v4",
  terminal: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M7 10l3 2-3 2 M12 15h5",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  chevronDown: "M6 9l6 6 6-6",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
  check: "M5 12l5 5 9-10",
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

export function PriorityIcon({ priority }: { priority: 0 | 2 | 3 | 4 }) {
  const lit = { 0: 0, 2: 3, 3: 2, 4: 1 }[priority];
  const fill = (n: number) => (lit >= n ? "var(--color-app-fg3)" : "var(--color-app-ctl)");
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      <rect x="1" y="8" width="3" height="5" rx="1" fill={fill(1)} />
      <rect x="5.5" y="5" width="3" height="8" rx="1" fill={fill(2)} />
      <rect x="10" y="2" width="3" height="11" rx="1" fill={fill(3)} />
    </svg>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-app-ctl px-2 text-[11.5px] text-app-mut ${className}`}>
      {children}
    </span>
  );
}

export function Header({ icon, title, sub, children }: { icon: IconName; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-app-line pl-5 pr-4">
      <Icon name={icon} className="text-app-mut" />
      <span className="text-[14px] font-semibold text-app-strong">{title}</span>
      {sub && <span className="text-app-mut2">{sub}</span>}
      <span className="flex-1" />
      {children}
    </div>
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

export function Segmented({ options, current }: { options: [IconName | null, string][]; current: string }) {
  return (
    <span className="flex rounded-[7px] border border-app-line p-0.5">
      {options.map(([icon, label]) => (
        <span key={label} className={`flex items-center gap-1.5 rounded-[5px] px-2.5 py-[3px] text-[12.5px] ${label === current ? "bg-app-sel text-app-strong" : "text-app-mut"}`}>
          {icon && <Icon name={icon} size={13} />}{label}
        </span>
      ))}
    </span>
  );
}

const NAV: [string, IconName, number?][] = [
  ["Inbox", "inbox"], ["Today", "sun", 5], ["Upcoming", "clock"], ["Calendar", "calendar"], ["Timeline", "timeline"],
  ["Projects", "box"], ["Roadmap", "roadmap"], ["Flows", "flow"], ["Sessions", "terminal", 1],
];

/**
 * The app's window: title bar with the wordmark, the sidebar, and the view's panel. Its made-up tasks
 * and times are never quoted in a search result (data-nosnippet).
 */
export function AppWindow({ id, current, label, children }: { id: string; current: string; label: string; children: ReactNode }) {
  return (
    <div role="img" aria-label={label} data-nosnippet=""
      className="flex flex-col overflow-hidden rounded-[14px] border border-app-line2 bg-app-bg font-app text-[13px] text-app-fg"
      style={{ width: SCREEN.w, height: SCREEN.h }}>
      <div aria-hidden="true" className="flex h-10 shrink-0 items-center gap-0.5 border-b border-app-line px-2 text-app-mut">
        <span className="flex h-8 w-8 items-center justify-center"><Icon name="back" size={15} /></span>
        <span className="flex h-8 w-8 items-center justify-center opacity-40"><Icon name="forward" size={15} /></span>
        <Wordmark id={`${id}-wordmark`} className="ml-2 w-[112px] text-app-strong" />
      </div>
      <div aria-hidden="true" className="flex min-h-0 flex-1">
        <div className="flex w-[220px] shrink-0 flex-col gap-px p-2 pt-2.5">
          <span className="mb-2 flex h-8 items-center gap-2.5 px-2.5 text-app-mut">
            <Icon name="search" size={15} />Search
            <span className="flex-1" />
            <span className="font-mono text-[11px] text-app-dim">Ctrl K</span>
          </span>
          {NAV.map(([name, icon, count]) => {
            const on = name === current;
            return (
              <span key={name} className={`flex h-[30px] items-center gap-2.5 rounded-md px-2.5 ${on ? "bg-app-sel text-app-strong" : "text-app-fg2"}`}>
                <Icon name={icon} size={15} className={on ? "text-app-fg2" : "text-app-mut"} />
                {name}
                <span className="flex-1" />
                {count && <span className="text-[12px] text-app-mut2">{count}</span>}
              </span>
            );
          })}
          <span className="mb-1 mt-4 px-2.5 text-[12px] text-app-mut2">Areas</span>
          {([["Work", "WRK", AREA.work], ["Personal", "PER", AREA.personal], ["Dev", "DEV", AREA.dev]] as const).map(([name, key, color]) => (
            <span key={key} className="flex h-[30px] items-center gap-2.5 px-2.5 text-app-fg2">
              <span className="mx-[3.5px] h-2 w-2 rounded-full" style={{ background: color }} />
              {name}
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-app-dim">{key}</span>
            </span>
          ))}
        </div>
        <div className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-app-line bg-app-panel">
          {children}
        </div>
      </div>
    </div>
  );
}
