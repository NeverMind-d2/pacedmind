"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { setFlowOnAction, updateProjectAction } from "@/app/actions";
import { reorderTasksAction, setNextProjectAction } from "@/app/(app)/roadmap/actions";
import { projectColor } from "@/lib/colors";
import { addDaysStr, dateOnly, dayDiff, fmtDay, fmtShort, parseLocal } from "@/lib/dates";
import { AGENT_LABEL, type AgentId, type Area, type Project, type Session, type Task, type TaskContext } from "@/lib/types";
import type { ProjectStats, StateTone, TaskState } from "@/server/timeline";
import { Diamond, Icon, StatusIcon } from "@/components/icons";
import { TaskDetail } from "@/components/task-detail";
import { Menu, Switch, cx, useAction } from "@/components/ui";
import { dayPos, tint, useWidth } from "./timeline";

export interface RoadmapItem {
  task: Task;
  /** Keys of the tasks this one comes after in the flow. */
  after: string[];
  startOfFlow: boolean;
  state: TaskState;
  session: Session | null;
}

const LEFT = 220;
const ROW = 40;
const HEAD = 32;
const AGENT_SHORT: Record<AgentId, string> = { claude: "Claude", codex: "Codex" };
const AGENT_DOT: Record<AgentId, string> = { claude: "#a1a1a8", codex: "#c4c4ca" };
const TONE: Record<StateTone, string> = {
  done: "text-mut2", waiting: "text-fg2", running: "text-fg3", active: "text-fg3", next: "text-mut", queued: "text-mut2", idle: "text-mut2",
};
const EMPTY: ProjectStats = { done: 0, total: 0, started: false };
const pv = "flex h-7 max-w-full items-center gap-2 rounded-md px-2 text-left text-fg2 hover:bg-hover";

/* ---------- project timeline ---------- */

function ProjectTimeline({ from, days, now, projects, colorOf, stats, selectedId }: {
  from: string; days: number; now: string; projects: Project[]; colorOf: (p: Project) => string;
  stats: Record<string, ProjectStats>; selectedId: string | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(LEFT + 950);
  const dayW = Math.max(5, (width - LEFT) / days);
  const X = (d: number) => Math.round(d * dayW);
  const clampX = (d: number) => X(Math.max(0, Math.min(days, d)));
  const gridW = X(days);
  const today = dateOnly(now);
  const nowPos = dayPos(from, now);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const lines: { x: number; strong: boolean }[] = [];
  const months: { x: number; label: string }[] = [];
  for (let i = 1; i < days; i++) {
    const d = parseLocal(addDaysStr(from, i));
    if (d.getDate() === 1) {
      lines.push({ x: X(i), strong: true });
      months.push({ x: X(i), label: format(d, "MMMM") });
    } else if (i % 7 === 0) {
      lines.push({ x: X(i), strong: false });
    }
  }
  if (!months.length || months[0].x > 90) months.unshift({ x: 0, label: format(parseLocal(from), "MMMM") });

  const bars = projects.map((p, i) => {
    const st = stats[p.id] ?? EMPTY;
    let s = p.startDate ? dayDiff(from, p.startDate) : null;
    let e = p.targetDate ? dayDiff(from, p.targetDate) + 1 : null;
    if (s === null && e !== null) s = Math.min(e - 1, dayDiff(from, today));
    if (e === null && s !== null) e = Math.max(s + 1, days);
    const waiting = !st.started && !!p.startDate && p.startDate > today;
    const after = p.afterProjectId ? byId.get(p.afterProjectId) : undefined;
    const label = waiting
      ? after ? `Starts after ${after.name}` : `Starts ${fmtShort(p.startDate!)}`
      : st.total ? `${st.done} of ${st.total} ${st.total === 1 ? "task" : "tasks"}` : "No tasks yet";
    return { p, i, s, e, waiting, label, pct: st.total ? (st.done / st.total) * 100 : 0, color: colorOf(p) };
  });

  // A project that starts after another one: an arrow from the end of the first to the start of the second.
  const deps = bars.flatMap((b) => {
    const a = b.p.afterProjectId ? bars.find((x) => x.p.id === b.p.afterProjectId) : undefined;
    if (!a || a.e === null || b.s === null) return [];
    const x1 = X(a.e) + (a.p.targetDate ? 7 : 1);
    const y1 = a.i * ROW + ROW / 2;
    const x2 = X(b.s);
    const y2 = b.i * ROW + ROW / 2;
    const ym = y2 > y1 ? y2 - ROW / 2 : y2 + ROW / 2;
    const d = x2 - x1 >= 18 ? `M${x1} ${y1} H${x1 + 11} V${y2} H${x2 - 5}` : `M${x1} ${y1} H${x1 + 7} V${ym} H${x2 - 12} V${y2} H${x2 - 5}`;
    return [{ id: b.p.id, d, head: `M${x2 - 6} ${y2 - 4} L${x2 + 1} ${y2} L${x2 - 6} ${y2 + 4} Z` }];
  });

  const height = projects.length * ROW;
  return (
    <div ref={ref} className="max-h-[44vh] shrink-0 overflow-auto border-b border-line">
      <div style={{ width: LEFT + gridW }}>
        <div className="sticky top-0 z-20 flex border-b border-line bg-panel" style={{ height: HEAD }}>
          <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-panel px-5 text-[11.5px] text-mut2" style={{ width: LEFT }}>
            Projects
          </div>
          <div className="relative shrink-0 overflow-hidden" style={{ width: gridW }}>
            {months.map((m) => (
              <span key={m.x} className="absolute top-[9px] whitespace-nowrap pl-1.5 text-[11.5px] text-mut" style={{ left: m.x }}>{m.label}</span>
            ))}
            {nowPos >= 0 && nowPos <= days && (
              <span className="absolute top-[7px] flex h-[18px] -translate-x-1/2 items-center whitespace-nowrap rounded bg-accent-strong px-1.5 text-[11px] font-medium text-white"
                style={{ left: Math.min(Math.max(X(nowPos), 26), gridW - 26) }}>
                {fmtShort(today)}
              </span>
            )}
          </div>
        </div>

        <div className="relative" style={{ height }}>
          <svg width={gridW} height={height} className="pointer-events-none absolute top-0" style={{ left: LEFT }} aria-hidden="true">
            {lines.map((l) => <line key={l.x} x1={l.x + 0.5} x2={l.x + 0.5} y1={0} y2={height} stroke={l.strong ? "#17171a" : "#0a0a0c"} />)}
          </svg>
          {bars.map(({ p, s, e, waiting, label, pct, color }) => {
            const selected = p.id === selectedId;
            const visible = s !== null && e !== null && e > 0 && s < days;
            const left = s === null ? 0 : clampX(s);
            const barW = e === null ? 0 : Math.max(8, clampX(e) - left);
            const inside = barW >= label.length * 6.2 + 16;
            const target = p.targetDate && e !== null && e >= 0 && e <= days ? X(e) : null;
            const outLeft = left + barW + (target !== null ? 14 : 8);
            return (
              <Link key={p.id} href={`/roadmap?p=${encodeURIComponent(p.id)}`} scroll={false} aria-current={selected ? "true" : undefined}
                className={cx("group flex border-b border-[#0a0a0c]", selected ? "bg-sel" : "hover:bg-hover")} style={{ height: ROW }}>
                <div className={cx("sticky left-0 z-10 flex shrink-0 items-center gap-[9px] border-r border-line pl-5 pr-3", selected ? "bg-sel" : "bg-panel group-hover:bg-hover")}
                  style={{ width: LEFT }}>
                  <Diamond color={color} />
                  <span className="min-w-0 flex-1 truncate text-fg">{p.name}</span>
                  {p.agent && (
                    <span className="inline-flex h-[18px] shrink-0 items-center gap-[5px] rounded-full border border-line2 px-[7px] text-[11px] text-mut">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: AGENT_DOT[p.agent] }} />
                      {AGENT_SHORT[p.agent]}
                    </span>
                  )}
                </div>
                <div className="relative shrink-0 overflow-hidden" style={{ width: gridW }}>
                  {visible && (
                    <div className="absolute overflow-hidden rounded-[5px]"
                      style={{ top: 9, height: 22, left, width: barW, background: waiting ? "transparent" : tint(color, 14), border: `1px ${waiting ? "dashed" : "solid"} ${tint(color, waiting ? 45 : 36)}` }}>
                      {!waiting && <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: tint(color, 40) }} />}
                      {inside && (
                        <span className={cx("absolute left-2 top-[2px] whitespace-nowrap text-[11.5px] leading-4", waiting ? "text-mut2" : "text-fg")}>{label}</span>
                      )}
                    </div>
                  )}
                  {visible && !inside && (
                    <span className="absolute top-3 whitespace-nowrap text-[11.5px] leading-4 text-mut2"
                      style={outLeft + label.length * 6.2 <= gridW ? { left: outLeft } : { right: gridW - left + 8 }}>
                      {label}
                    </span>
                  )}
                  {target !== null && (
                    <span title={`Target date · ${fmtDay(p.targetDate!)}`} className="absolute flex" style={{ left: target - 6, top: 14 }}>
                      <Diamond color={color} size={12} hollow />
                    </span>
                  )}
                  {!visible && s !== null && e !== null && (
                    <span className={cx("absolute top-3 whitespace-nowrap text-[11px] leading-4 text-dim", e <= 0 ? "left-2" : "right-2")}>
                      {e <= 0 ? `‹ ${fmtShort(p.targetDate ?? addDaysStr(from, e - 1))}` : `${fmtShort(p.startDate ?? addDaysStr(from, s))} ›`}
                    </span>
                  )}
                  {s === null && <span className="absolute left-2 top-3 text-[11px] leading-4 text-dim">No dates yet</span>}
                </div>
              </Link>
            );
          })}
          {nowPos >= 0 && nowPos <= days && (
            <span className="pointer-events-none absolute inset-y-0 w-px" style={{ left: LEFT + X(nowPos), background: "rgb(139 142 245 / 0.7)" }} />
          )}
          {deps.length > 0 && (
            <svg width={gridW} height={height} className="pointer-events-none absolute top-0" style={{ left: LEFT }} aria-hidden="true">
              {deps.map((dp) => (
                <g key={dp.id}>
                  <path d={dp.d} fill="none" stroke="#a1a1a8" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d={dp.head} fill="#a1a1a8" />
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- task order ---------- */

function TaskOrder({ project, items, next, stats, sel, onSelect }: {
  project: Project; items: RoadmapItem[]; next: Project[]; stats: Record<string, ProjectStats>;
  sel: string | null; onSelect: (key: string) => void;
}) {
  const { run } = useAction();
  const [list, setList] = useOptimistic(items);
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const order = [...list];
    [order[i], order[j]] = [order[j], order[i]];
    run(async () => {
      setList(order);
      return reorderTasksAction(order.map((it) => it.task.id));
    });
  };
  const arrow = "flex h-6 w-6 items-center justify-center rounded text-mut2 hover:bg-sel hover:text-fg2 disabled:pointer-events-none disabled:opacity-30";
  const canOpen = (it: RoadmapItem) => it.state.tone === "waiting" && !!it.session;
  // Keeps the columns lined up when some rows have an "Open session" button.
  const actions = list.some(canOpen);

  return (
    <section aria-label="Task order" className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-5">
        <h2 className="mr-1 text-[12.5px] font-medium text-fg2">Task order</h2>
        <span className="truncate text-[12px] text-mut2">{project.name} · {list.length} {list.length === 1 ? "task" : "tasks"}</span>
        <span className="flex-1" />
        <Link href={`/flows?p=${encodeURIComponent(project.id)}`}
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-line2 px-2.5 text-[12px] text-fg3 hover:bg-hover">
          <Icon name="flow" size={12} strokeWidth={2} />Open as flow
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {list.map((it, i) => {
          const t = it.task;
          const done = t.status === "done";
          const waiting = it.state.tone === "waiting";
          const after = it.after.length ? `After ${it.after.join(", ")}` : it.startOfFlow ? "Start of flow" : "";
          return (
            <div key={t.id} onClick={() => onSelect(t.key)}
              className={cx("group flex h-[38px] cursor-pointer items-center gap-2.5 border-b border-hover pl-5 pr-3", t.key === sel ? "bg-sel" : "hover:bg-hover")}>
              <span className="w-4 shrink-0 font-mono text-[11px] text-dim">{i + 1}</span>
              <StatusIcon status={t.status} />
              <span className="w-[50px] shrink-0 font-mono text-[11.5px] text-mut2">{t.key}</span>
              <button type="button" className={cx("min-w-0 flex-1 truncate text-left", done ? "text-mut2" : "text-fg")}>{t.title}</button>
              <span title={after} className="hidden w-[110px] shrink-0 truncate text-[12px] text-dim min-[1360px]:block">{after}</span>
              <span className={cx("flex w-[210px] shrink-0 items-center justify-end gap-2 text-[12px]", TONE[it.state.tone])}>
                {waiting && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                <span className="truncate">{it.state.text}</span>
              </span>
              {actions && (
                <span className="flex w-[98px] shrink-0 justify-end">
                  {canOpen(it) && (
                    <Link href={`/sessions?s=${it.session!.id}`} onClick={(e) => e.stopPropagation()}
                      className="inline-flex h-6 items-center rounded-md border border-ctl px-2 text-[12px] text-fg2 hover:bg-sel">
                      Open session
                    </Link>
                  )}
                </span>
              )}
              <span className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" aria-label={`Move ${t.key} up`} title="Move up" disabled={i === 0} className={arrow}
                  onClick={(e) => { e.stopPropagation(); move(i, -1); }}>
                  <Icon name="chevronDown" size={13} strokeWidth={2.2} className="rotate-180" />
                </button>
                <button type="button" aria-label={`Move ${t.key} down`} title="Move down" disabled={i === list.length - 1} className={arrow}
                  onClick={(e) => { e.stopPropagation(); move(i, 1); }}>
                  <Icon name="chevronDown" size={13} strokeWidth={2.2} />
                </button>
              </span>
            </div>
          );
        })}
        {!list.length && (
          <div className="flex flex-col items-center gap-3 px-8 py-16 text-center">
            <div className="text-[14px] text-fg2">No tasks in {project.name} yet</div>
            <div className="text-[12.5px] text-mut2">
              Press <span className="rounded border border-ctl px-1.5 font-mono text-[11px]">C</span> anywhere to add a task.
            </div>
          </div>
        )}
        {next.map((q) => {
          const n = (stats[q.id] ?? EMPTY).total;
          return (
            <Link key={q.id} href={`/roadmap?p=${encodeURIComponent(q.id)}`} scroll={false}
              className="mx-5 mt-2 flex h-[38px] items-center gap-2.5 rounded-md border border-dashed border-ctl px-3 text-[12.5px] text-mut hover:bg-hover">
              <Icon name="arrowRight" size={14} strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate">
                Then {q.name}, {n ? `${n} ${n === 1 ? "task" : "tasks"}` : "no tasks yet"}, once {project.name} is done
              </span>
              {q.startDate && <span className="shrink-0 text-[12px] text-mut2">Est. {fmtShort(q.startDate)}</span>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- session settings for the project ---------- */

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-center gap-3 rounded-md px-2 text-[12.5px]">
      <span className="w-[112px] shrink-0 text-mut2">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

function SessionPanel({ project, projects, colorOf, terminal }: {
  project: Project; projects: Project[]; colorOf: (p: Project) => string; terminal: string;
}) {
  const { run } = useAction();
  const [folder, setFolder] = useState(project.folder ?? "");
  const byId = new Map(projects.map((p) => [p.id, p]));
  /** Whether `start` waits, directly or through other projects, for `targetId`. */
  const waitsFor = (start: Project, targetId: string) => {
    const seen = new Set<string>();
    for (let cur = start.afterProjectId; cur && !seen.has(cur); cur = byId.get(cur)?.afterProjectId ?? null) {
      if (cur === targetId) return true;
      seen.add(cur);
    }
    return false;
  };
  const others = projects.filter((p) => p.id !== project.id);
  const startsAfter = project.afterProjectId ? byId.get(project.afterProjectId) ?? null : null;
  const next = projects.filter((p) => p.afterProjectId === project.id);
  const agent: AgentId = project.agent ?? "claude";
  const save = (patch: Partial<Omit<Project, "id">>) => run(() => updateProjectAction(project.id, patch));
  const item = (p: Project) => ({ value: p.id as string | null, label: p.name, icon: <Diamond color={colorOf(p)} size={10} /> });

  return (
    <aside aria-label="Session settings" className="flex w-[380px] shrink-0 flex-col border-l border-line">
      <div className="flex h-11 shrink-0 items-center border-b border-line px-5">
        <h2 className="truncate text-[12.5px] font-medium text-fg2">Sessions · {project.name}</h2>
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2.5">
        <Setting label="Flow on">
          <span className="px-2"><Switch on={project.flowOn} label="Flow on" onChange={(v) => run(() => setFlowOnAction(project.id, v))} /></span>
          <span className="truncate text-mut">{project.flowOn ? "Next sessions start on their own" : "Paused"}</span>
        </Setting>
        <Setting label="Default agent">
          <Menu className="min-w-0" width={200}
            trigger={<button type="button" className={pv}>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: AGENT_DOT[agent] }} />{AGENT_LABEL[agent]}
            </button>}
            items={(Object.keys(AGENT_LABEL) as AgentId[]).map((a) => ({
              value: a, label: AGENT_LABEL[a], icon: <span className="h-1.5 w-1.5 rounded-full" style={{ background: AGENT_DOT[a] }} />,
            }))}
            onSelect={(v) => save({ agent: v })} />
        </Setting>
        <Setting label="Opens in">
          <span className="truncate px-2 text-fg2">{terminal}</span>
        </Setting>
        <Setting label="Folder">
          <input value={folder} aria-label="Folder" placeholder="A new folder per task" spellCheck={false}
            ref={(el) => { if (el && document.activeElement !== el) el.scrollLeft = el.scrollWidth; }}
            onChange={(e) => setFolder(e.target.value)}
            onBlur={(e) => {
              const value = e.currentTarget.value.trim();
              e.currentTarget.scrollLeft = e.currentTarget.scrollWidth;
              if (value !== (project.folder ?? "")) save({ folder: value || null });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setFolder(project.folder ?? "");
            }}
            className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 font-mono text-[11.5px] text-fg2 outline-none placeholder:font-sans placeholder:text-[12.5px] placeholder:text-mut2 hover:bg-hover focus:bg-hover" />
        </Setting>
        <Setting label="Starts after">
          <Menu className="min-w-0" width={240}
            trigger={<button type="button" className={cx(pv, !startsAfter && "text-mut2")}>
              {startsAfter && <Diamond color={colorOf(startsAfter)} size={10} />}
              <span className="truncate">{startsAfter?.name ?? "Nothing, starts any time"}</span>
            </button>}
            items={[{ value: null as string | null, label: "Nothing, starts any time" }, ...others.filter((p) => !waitsFor(p, project.id)).map(item)]}
            onSelect={(v) => save({ afterProjectId: v })} />
        </Setting>
        <Setting label="After this project">
          <Menu className="min-w-0" width={240}
            trigger={<button type="button" className={cx(pv, !next.length && "text-mut2")}>
              <span className="truncate">
                {next.length ? next.map((p) => (p.agent ? `${p.name}, in ${AGENT_LABEL[p.agent]}` : p.name)).join("; ") : "Nothing"}
              </span>
            </button>}
            items={[{ value: null as string | null, label: "Nothing" }, ...others.filter((p) => !waitsFor(project, p.id)).map(item)]}
            onSelect={(v) => run(() => setNextProjectAction(project.id, v))} />
        </Setting>
      </div>
      <p className="px-5 py-1.5 text-[12px] leading-[1.55] text-mut2">
        Organizer only tracks state. You work with the agent in its own terminal, and it tells Organizer when it starts and when it’s finished.
      </p>
    </aside>
  );
}

/* ---------- the view ---------- */

export function Roadmap(props: {
  /** First day of the project timeline, a Monday. */
  from: string;
  days: number;
  /** Server time, "YYYY-MM-DDTHH:mm:ss". */
  now: string;
  areas: Area[];
  projects: Project[];
  stats: Record<string, ProjectStats>;
  selectedId: string | null;
  /** Tasks of the selected project in their order. */
  items: RoadmapItem[];
  terminal: string;
  /** Finished sessions that wait for you. */
  waiting: number;
  ctx: TaskContext;
  initialKey: string | null;
}) {
  const { from, days, areas, projects, stats, items, ctx } = props;
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(props.initialKey);
  const project = projects.find((p) => p.id === props.selectedId) ?? null;
  const colorOf = (p: Project) => projectColor(p, areas);
  const selected = sel ? items.find((it) => it.task.key === sel)?.task ?? null : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, [role=dialog]")) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const first = parseLocal(from);
  const last = parseLocal(addDaysStr(from, days - 1));
  const range = `${format(first, first.getFullYear() === last.getFullYear() ? "MMM" : "MMM yyyy")} to ${format(last, "MMM yyyy")}`;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
        <Icon name="roadmap" className="text-mut" />
        <h1 className="text-[14px] font-semibold text-strong">Roadmap</h1>
        <span className="text-mut2">{range}</span>
        <div className="ml-1.5 flex h-7 items-center gap-0.5 rounded-[7px] border border-line bg-[#030303] p-0.5">
          <span aria-current="page" className="flex h-[22px] items-center gap-1.5 rounded-[5px] bg-[#141416] px-2.5 text-[12px] text-strong">
            <Icon name="roadmap" size={12} strokeWidth={2} />Roadmap
          </span>
          <Link href={project ? `/flows?p=${encodeURIComponent(project.id)}` : "/flows"}
            className="flex h-[22px] items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] text-mut hover:text-fg2">
            <Icon name="flow" size={12} strokeWidth={2} />Flow
          </Link>
        </div>
        <span className="flex-1" />
        {props.waiting > 0 && (
          <Link href="/sessions" className="inline-flex h-[26px] items-center gap-2 rounded-full px-2.5 text-[12px] text-mut hover:bg-hover">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {props.waiting === 1 ? "1 finished session waiting for you" : `${props.waiting} finished sessions waiting for you`}
          </Link>
        )}
        {project && (
          <Menu align="right" width={240}
            trigger={<button type="button" aria-label="Project"
              className="flex h-7 max-w-[240px] items-center gap-2 rounded-md border border-ctl px-2.5 text-[12.5px] text-fg2 hover:bg-hover">
              <Diamond color={colorOf(project)} size={10} />
              <span className="truncate">{project.name}</span>
              <Icon name="chevronDown" size={12} className="shrink-0 text-mut2" />
            </button>}
            items={projects.map((p) => ({ value: p.id, label: p.name, icon: <Diamond color={colorOf(p)} size={10} />, hint: areas.find((a) => a.id === p.areaId)?.name }))}
            onSelect={(id) => router.push(`/roadmap?p=${encodeURIComponent(id)}`, { scroll: false })} />
        )}
      </div>

      {project ? (
        <>
          <ProjectTimeline from={from} days={days} now={props.now} projects={projects} colorOf={colorOf} stats={stats} selectedId={project.id} />
          <div className="flex min-h-0 flex-1">
            <TaskOrder project={project} items={items} next={projects.filter((p) => p.afterProjectId === project.id)} stats={stats}
              sel={selected?.key ?? null} onSelect={(key) => setSel((s) => (s === key ? null : key))} />
            {selected ? (
              <TaskDetail key={`${selected.id}-${selected.updatedAt}`} task={selected} ctx={ctx} onClose={() => setSel(null)} />
            ) : (
              <SessionPanel key={`${project.id}:${project.folder ?? ""}`} project={project} projects={projects} colorOf={colorOf} terminal={props.terminal} />
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
          <div className="text-[14px] text-fg2">No projects yet</div>
          <div className="text-[12.5px] text-mut2">Projects and their target dates show up here once you add one.</div>
        </div>
      )}
    </div>
  );
}
