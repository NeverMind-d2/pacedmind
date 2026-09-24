import type { ReactNode } from "react";
import { Wordmark } from "./wordmark";

// A still of the app's Today view, built from the app's own sizes, icons and colors
// (src/components/task-list.tsx, task-row.tsx and sidebar.tsx), so it matches both themes.

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
  chevronDown: "M6 9l6 6 6-6",
  flag: "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z M4 22v-7",
};

const AREA = { work: "#7D93B5", personal: "#7FA894", dev: "#7AA3AD" };

const NAV: { label: string; icon: keyof typeof PATHS; count?: number; current?: boolean }[] = [
  { label: "Inbox", icon: "inbox" },
  { label: "Today", icon: "sun", count: 5, current: true },
  { label: "Upcoming", icon: "clock" },
  { label: "Calendar", icon: "calendar" },
  { label: "Timeline", icon: "timeline" },
  { label: "Projects", icon: "box" },
  { label: "Roadmap", icon: "roadmap" },
  { label: "Flows", icon: "flow" },
  { label: "Sessions", icon: "terminal", count: 1 },
];

type Status = "todo" | "progress" | "review" | "done";
type Task = {
  key: string; title: string; status: Status; priority: 0 | 2 | 3 | 4;
  session?: "finished" | "running"; label?: string; due: string;
};

const SCHEDULE = [
  { time: "08:30–08:45", title: "Standup", area: "Work", color: AREA.work, past: true },
  { time: "09:00–11:00", title: "Focus: pricing page", area: "Work", color: AREA.work, now: true },
  { time: "12:30–13:30", title: "Lunch with Ana", area: "Personal", color: AREA.personal },
];

const TASKS: Task[] = [
  { key: "WEB-12", title: "Write the pricing page", status: "review", priority: 2, session: "finished", label: "copy", due: "Today" },
  { key: "APP-31", title: "Fix calendar sync after sleep", status: "progress", priority: 3, session: "running", label: "sync", due: "Today" },
  { key: "WEB-14", title: "Compress the hero images", status: "todo", priority: 3, label: "assets", due: "17:00" },
  { key: "PER-8", title: "Book the dentist", status: "todo", priority: 4, due: "Today" },
  { key: "DEV-3", title: "Renew the domain", status: "done", priority: 0, due: "Today" },
];

function Icon({ name, size = 16, strokeWidth = 1.8, className }: { name: keyof typeof PATHS; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={PATHS[name]} />
    </svg>
  );
}

function StatusIcon({ status }: { status: Status }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
      {status === "done" ? (
        <>
          <circle cx="7" cy="7" r="6.75" fill="var(--color-app-accent)" />
          <path d="M4.4 7.2 L6.2 9 L9.7 5.3" fill="none" stroke="var(--color-app-panel)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
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

function PriorityIcon({ priority }: { priority: Task["priority"] }) {
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

function Group({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex h-[34px] items-center gap-2 border-b border-app-line bg-app-raised pl-5 pr-4 text-[12.5px] font-medium text-app-fg2">
      <Icon name="chevronDown" size={12} strokeWidth={2.4} className="text-app-mut2" />
      {name}
      <span className="font-normal text-app-mut2">{count}</span>
    </div>
  );
}

function Chip({ children, round, className = "" }: { children: ReactNode; round?: boolean; className?: string }) {
  return (
    <span className={`h-5 shrink-0 items-center gap-1.5 border border-app-ctl text-[11.5px] ${round ? "rounded-full px-2" : "rounded-[5px] px-1.5"} ${className}`}>
      {children}
    </span>
  );
}

export function TodayPreview() {
  return (
    <div role="img" aria-label="The Today view in PacedMind: the day's schedule with a focus block happening now, and the tasks due today, including a Claude Code session that has finished and is waiting for review."
      className="@container overflow-hidden rounded-[14px] border border-app-line2 bg-app-bg font-sans text-[13px] text-app-fg">
      <div aria-hidden="true">
        <div className="flex h-10 items-center gap-0.5 border-b border-app-line px-2 text-app-mut">
          <span className="flex h-8 w-8 items-center justify-center"><Icon name="back" size={15} /></span>
          <span className="flex h-8 w-8 items-center justify-center opacity-40"><Icon name="forward" size={15} /></span>
          <Wordmark id="preview-wordmark" className="ml-2 w-[112px] text-app-strong" />
        </div>
        <div className="flex">
          <nav className="hidden w-[232px] shrink-0 flex-col gap-px p-2 pt-2.5 @min-[760px]:flex">
            <span className="mb-2 flex h-8 items-center gap-2.5 px-2.5 text-app-mut">
              <Icon name="search" size={15} />Search
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-app-dim">Ctrl K</span>
            </span>
            {NAV.map((item) => (
              <span key={item.label} className={`flex h-[30px] items-center gap-2.5 rounded-md px-2.5 ${item.current ? "bg-app-sel text-app-strong" : "text-app-fg2"}`}>
                <Icon name={item.icon} size={15} className={item.current ? "text-app-fg2" : "text-app-mut"} />
                {item.label}
                <span className="flex-1" />
                {item.count && <span className="text-[12px] text-app-mut2">{item.count}</span>}
              </span>
            ))}
            <span className="mb-1 mt-4 px-2.5 text-[12px] text-app-mut2">Areas</span>
            {[["Work", "WRK", AREA.work], ["Personal", "PER", AREA.personal], ["Dev", "DEV", AREA.dev]].map(([name, key, color]) => (
              <span key={key} className="flex h-[30px] items-center gap-2.5 px-2.5 text-app-fg2">
                <span className="mx-[3.5px] h-2 w-2 rounded-full" style={{ background: color }} />
                {name}
                <span className="flex-1" />
                <span className="font-mono text-[11px] text-app-dim">{key}</span>
              </span>
            ))}
          </nav>
          <div className="m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-app-line bg-app-panel @min-[760px]:ml-0">
            <div className="flex h-[52px] items-center gap-2.5 border-b border-app-line pl-5 pr-4">
              <Icon name="sun" className="text-app-mut" />
              <span className="text-[14px] font-semibold text-app-strong">Today</span>
              <span className="flex-1" />
              <span className="flex h-7 items-center gap-1.5 rounded-md border border-app-line2 px-2.5 text-[12.5px] text-app-fg2">
                <Icon name="plus" size={13} />New task
              </span>
            </div>
            <Group name="Schedule" count={SCHEDULE.length} />
            {SCHEDULE.map((e) => (
              <div key={e.time} className={`flex h-[38px] items-center gap-3 border-b border-app-hover pl-5 pr-4 ${e.past ? "text-app-mut2" : ""}`}>
                <span className={`w-[96px] shrink-0 font-mono text-[11.5px] ${e.past ? "text-app-dim" : "text-app-mut"}`}>{e.time}</span>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.color }} />
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                {e.now && <span className="rounded-full bg-app-accent/15 px-2 py-0.5 text-[11.5px] font-medium text-app-accent-fg">Now</span>}
                <span className="hidden w-16 shrink-0 text-right text-[11.5px] text-app-mut2 @min-[520px]:block">{e.area}</span>
              </div>
            ))}
            <Group name="Due today" count={TASKS.length} />
            {TASKS.map((t) => {
              const done = t.status === "done";
              return (
                <div key={t.key} className="flex h-[38px] items-center gap-2.5 border-b border-app-hover pl-5 pr-4 last:border-b-0">
                  <span className="flex w-4 shrink-0 justify-center"><PriorityIcon priority={t.priority} /></span>
                  <span className="hidden w-[54px] shrink-0 font-mono text-[11.5px] text-app-mut2 @min-[440px]:block">{t.key}</span>
                  <span className="flex w-[18px] shrink-0 justify-center"><StatusIcon status={t.status} /></span>
                  <span className={`min-w-0 flex-1 truncate ${done ? "text-app-mut2 line-through" : ""}`}>{t.title}</span>
                  {t.session === "finished" && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-app-fg3">
                      <span className="h-1.5 w-1.5 rounded-full bg-app-accent" />Session finished
                    </span>
                  )}
                  {t.session === "running" && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-app-mut">
                      <span className="h-1.5 w-1.5 rounded-full bg-app-fg3" />Codex running
                    </span>
                  )}
                  {t.label && (
                    <Chip round className="hidden text-app-mut @min-[640px]:inline-flex">
                      <span className="h-1.5 w-1.5 rounded-full bg-app-mut2" />{t.label}
                    </Chip>
                  )}
                  <Chip className={`hidden @min-[520px]:inline-flex ${done ? "text-app-dim" : "text-app-fg2"}`}>
                    <Icon name="flag" size={11} strokeWidth={2.2} />{t.due}
                  </Chip>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
