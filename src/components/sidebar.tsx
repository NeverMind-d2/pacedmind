"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, ProgressRing, type IconName } from "./icons";
import { cx } from "./ui";
import { fmtShort } from "@/lib/dates";
import type { Area, Project } from "@/lib/types";

const NAV: { href: string; label: string; icon: IconName; count?: "inbox" | "today" | "sessions" }[] = [
  { href: "/inbox", label: "Inbox", icon: "inbox", count: "inbox" },
  { href: "/today", label: "Today", icon: "sun", count: "today" },
  { href: "/upcoming", label: "Upcoming", icon: "clock" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/timeline", label: "Timeline", icon: "timeline" },
  { href: "/roadmap", label: "Roadmap", icon: "roadmap" },
  { href: "/flows", label: "Flows", icon: "flow" },
  { href: "/sessions", label: "Sessions", icon: "terminal", count: "sessions" },
];

export function openQuickAdd() {
  window.dispatchEvent(new CustomEvent("organizer:new"));
}

export function Sidebar({ areas, projects, counts, progress }: {
  areas: Area[];
  projects: Project[];
  counts: { inbox: number; today: number; sessions: number };
  progress: Record<string, number>;
}) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  const areaColor = (id: string) => areas.find((a) => a.id === id)?.color ?? "#85858c";
  const item = "flex h-[30px] items-center gap-2.5 rounded-md px-2 text-fg3 hover:bg-hover";
  return (
    <nav aria-label="Main" className="flex w-60 shrink-0 flex-col gap-[18px] overflow-y-auto px-2.5 py-3">
      <div className="flex items-center gap-1.5">
        <div className="flex h-8 flex-1 items-center gap-2 px-1.5">
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-accent text-[12px] font-semibold text-bg">O</span>
          <span className="text-[13.5px] font-semibold text-strong">Organizer</span>
        </div>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("organizer:palette"))} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-mut hover:bg-hover">
          <Icon name="search" />
        </button>
        <button type="button" onClick={openQuickAdd} aria-label="New task (C)" title="New task (C)"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line2 bg-raised text-fg2 hover:bg-hover">
          <Icon name="pen" size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-px">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cx(item, active(n.href) && "bg-[#0f0f11] text-strong")}>
            <Icon name={n.icon} />
            <span className="flex-1">{n.label}</span>
            {n.count && counts[n.count] > 0 && <span className="text-[11.5px] text-mut2">{counts[n.count]}</span>}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-px">
        <div className="flex h-[26px] items-center px-2 text-[12px] font-medium text-mut2">Areas</div>
        {areas.map((a) => (
          <Link key={a.id} href={`/area/${a.id}`} className={cx(item, active(`/area/${a.id}`) && "bg-[#0f0f11] text-strong")}>
            <span className="flex h-4 w-4 items-center justify-center rounded bg-white/[0.06]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.color }} />
            </span>
            <span className="flex-1">{a.name}</span>
            <span className="font-mono text-[10.5px] text-mut2">{a.key}</span>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-px">
        <div className="flex h-[26px] items-center px-2 text-[12px] font-medium text-mut2">Projects</div>
        {projects.map((p) => (
          <Link key={p.id} href={`/project/${p.id}`} className={cx(item, active(`/project/${p.id}`) && "bg-[#0f0f11] text-strong")}>
            <ProgressRing pct={progress[p.id] ?? 0} color={areaColor(p.areaId)} size={16} />
            <span className="flex-1 truncate">{p.name}</span>
            {p.targetDate && <span className="text-[11.5px] text-mut2">{fmtShort(p.targetDate)}</span>}
          </Link>
        ))}
      </div>

      <div className="flex-1" />
      <div className="flex flex-col gap-1.5">
        <Link href="/settings" className={cx(item, "text-mut", active("/settings") && "bg-[#0f0f11] text-strong")}>
          <Icon name="settings" />
          <span className="flex-1">Settings</span>
        </Link>
        <div className="flex items-center gap-2 px-2 text-[11.5px] text-mut2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#7fa894]" />
          Saved on this device
        </div>
      </div>
    </nav>
  );
}
