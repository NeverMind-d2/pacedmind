"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { format, getISOWeek } from "date-fns";
import { addDaysStr, dateOnly, dayDiff, fmtDay, fmtShort, minutesOf, parseLocal, timeOf, toStamp } from "@/lib/dates";
import {
  AGENT_LABEL, type Area, type FlowEdge, type Project, type Session, type SessionStatus, type Task, type TaskContext,
} from "@/lib/types";
import type { DayLoad, TaskState } from "@/server/timeline";
import { Diamond, Icon, ProgressRing } from "@/components/icons";
import { TaskDetail } from "@/components/task-detail";
import { Dot, Segmented, cx } from "@/components/ui";

/* ---------- small helpers, also used by the roadmap ---------- */

/** A color at the given opacity, for area-colored bars and outlines. */
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Fractional days from `from` (local midnight) to a date or timestamp. */
export function dayPos(from: string, stamp: string): number {
  const t = timeOf(stamp);
  return dayDiff(from, stamp) + (t ? minutesOf(t) / 1440 : 0);
}

/** An element's width, kept up to date. `fallback` is used until it has been measured. */
export function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/* ---------- layout ---------- */

export type TimelineZoom = "week" | "month" | "quarter";

const ZOOM: Record<TimelineZoom, { label: string; days: number; minDay: number }> = {
  week: { label: "Week", days: 7, minDay: 72 },
  month: { label: "Month", days: 28, minDay: 18 },
  quarter: { label: "Quarter", days: 91, minDay: 5 },
};

type Layer = "tasks" | "sessions" | "blocks" | "deadlines" | "deps";

const LAYERS: { id: Layer; label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "sessions", label: "Sessions" },
  { id: "blocks", label: "Time blocks" },
  { id: "deadlines", label: "Deadlines" },
  { id: "deps", label: "Dependencies" },
];

const TREE = 260;
const ROW_H = { cap: 40, area: 30, proj: 32, task: 28 };
/** Task bars sit at the top of their row; agent sessions run in a thin lane below them. */
const BAR_TOP = 4;
const BAR_H = 18;
const BAR_MID = BAR_TOP + BAR_H / 2;
const LANE_TOP = 24;
const NAV = "inline-flex h-7 w-7 items-center justify-center rounded-md text-mut hover:bg-hover hover:text-fg2";

interface Span {
  s: number;
  e: number;
}

interface TaskSpan extends Span {
  due: number | null;
}

interface Scale {
  from: string;
  days: number;
  dayW: number;
  gridW: number;
  X: (d: number) => number;
  now: string;
  nowPos: number;
  today: string;
}

type AreaRow = { kind: "area"; id: string; y: number; h: number; areaId: string; name: string; color: string | null; open: boolean };
type ProjectRow = {
  kind: "proj"; id: string; y: number; h: number; project: Project; color: string; open: boolean;
  done: number; total: number; started: boolean; span: Span | null;
};
type TaskRow = { kind: "task"; id: string; y: number; h: number; task: Task; color: string; indent: number; span: TaskSpan; sessions: Session[] };
type Row = { kind: "cap"; id: string; y: number; h: number } | AreaRow | ProjectRow | TaskRow;

const isActive = (x: Session) => x.status === "running" || x.status === "starting";
const isOpenTask = (t: Task) => t.status !== "done" && t.status !== "canceled";

/**
 * Start: the planned day, else the day its first session started, else the day it was created; a task that
 * hasn't started and has neither waits for the tasks it depends on. End: the deadline, or the estimate in 8-hour days.
 */
function taskSpans(tasks: Task[], sessionsOf: Map<number, Session[]>, edges: FlowEdge[], from: string): Map<number, TaskSpan> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const sources = new Map<number, number[]>();
  for (const e of edges) sources.set(e.toTaskId, [...(sources.get(e.toTaskId) ?? []), e.fromTaskId]);
  const out = new Map<number, TaskSpan>();
  const visiting = new Set<number>();
  const spanOf = (t: Task): TaskSpan => {
    const known = out.get(t.id);
    if (known) return known;
    visiting.add(t.id);
    const first = sessionsOf.get(t.id)?.[0];
    let s = dayDiff(from, t.plannedDate ?? dateOnly(first?.startedAt ?? t.createdAt));
    if (!t.plannedDate && !first && (t.status === "todo" || t.status === "backlog")) {
      for (const id of sources.get(t.id) ?? []) {
        const src = byId.get(id);
        if (src && !visiting.has(id)) s = Math.max(s, Math.ceil(spanOf(src).e));
      }
    }
    const due = t.dueDate ? (timeOf(t.dueDate) ? dayPos(from, t.dueDate) : dayDiff(from, t.dueDate) + 1) : null;
    const span = { s, e: due !== null && due > s ? due : s + Math.max(1, Math.ceil(t.estimateMin / 480)), due };
    visiting.delete(t.id);
    out.set(t.id, span);
    return span;
  };
  for (const t of tasks) spanOf(t);
  return out;
}

function sessionSpan(x: Session, from: string, now: string): Span {
  return { s: dayPos(from, x.startedAt), e: dayPos(from, isActive(x) ? now : x.finishedAt ?? x.endedAt ?? x.startedAt) };
}

function buildRows(input: {
  areas: Area[]; projects: Project[]; tasks: Task[]; sessionsOf: Map<number, Session[]>; spans: Map<number, TaskSpan>;
  sc: Scale; expanded: Record<string, boolean>; collapsed: Record<string, boolean>;
}): { rows: Row[]; height: number } {
  const { areas, projects, tasks, sessionsOf, spans, sc, expanded, collapsed } = input;
  const inRange = (sp: Span) => sp.e > 0 && sp.s < sc.days;
  // Open tasks always get a row; finished ones only while their bar or a session is in view.
  const shown = (t: Task) =>
    t.status !== "canceled" &&
    (isOpenTask(t) || inRange(spans.get(t.id)!) || (sessionsOf.get(t.id) ?? []).some((x) => inRange(sessionSpan(x, sc.from, sc.now))));
  const byStart = (a: Task, b: Task) => spans.get(a.id)!.s - spans.get(b.id)!.s || a.id - b.id;
  const areaIds = new Set(areas.map((a) => a.id));
  const projectIds = new Set(projects.map((p) => p.id));

  const rows: Row[] = [];
  let y = 0;
  const add = (r: Row) => {
    rows.push(r);
    y += r.h;
  };
  const taskRow = (t: Task, indent: number, color: string): TaskRow => ({
    kind: "task", id: `t${t.id}`, y, h: ROW_H.task, task: t, color, indent, span: spans.get(t.id)!, sessions: sessionsOf.get(t.id) ?? [],
  });

  add({ kind: "cap", id: "cap", y, h: ROW_H.cap });
  const groups = [...areas.map((a) => ({ id: a.id, name: a.name, color: a.color as string | null })), { id: "", name: "Inbox", color: null }];
  for (const g of groups) {
    const own = projects.filter((p) => (g.id ? p.areaId === g.id : !areaIds.has(p.areaId)));
    const loose = tasks
      .filter((t) => (!t.projectId || !projectIds.has(t.projectId)) && (g.id ? t.areaId === g.id : !t.areaId || !areaIds.has(t.areaId)))
      .filter(shown)
      .sort(byStart);
    if (!g.id && !own.length && !loose.length) continue;
    const open = !collapsed[g.id];
    add({ kind: "area", id: `a-${g.id}`, y, h: ROW_H.area, areaId: g.id, name: g.name, color: g.color, open });
    if (!open) continue;
    const color = g.color ?? "#85858c";
    for (const p of own) {
      const pts = tasks.filter((t) => t.projectId === p.id && t.status !== "canceled");
      const dated = pts.some((t) => t.plannedDate || t.dueDate || sessionsOf.has(t.id));
      const isOpen = pts.length > 0 && (expanded[p.id] ?? dated);
      const s = p.startDate ? dayDiff(sc.from, p.startDate) : pts.length ? Math.min(...pts.map((t) => spans.get(t.id)!.s)) : null;
      const e = p.targetDate ? dayDiff(sc.from, p.targetDate) + 1 : pts.length ? Math.max(...pts.map((t) => spans.get(t.id)!.e)) : null;
      add({
        kind: "proj", id: `p-${p.id}`, y, h: ROW_H.proj, project: p, color, open: isOpen,
        done: pts.filter((t) => t.status === "done").length, total: pts.length,
        started: pts.some((t) => t.status === "progress" || t.status === "review" || t.status === "done"),
        span: s !== null && e !== null && e > s ? { s, e } : null,
      });
      if (isOpen) {
        for (const t of pts.filter(shown).sort((a, b) => a.sortOrder - b.sortOrder || byStart(a, b))) add(taskRow(t, 44, color));
      }
    }
    for (const t of loose) add(taskRow(t, 26, color));
  }
  return { rows, height: y };
}

/* ---------- bar looks: color is the area, state is fill, outline and opacity ---------- */

interface Look {
  bg: string;
  bd: string;
  fg: string;
  dashed?: boolean;
  check?: boolean;
  dot?: boolean;
}

function barLook(t: Task, latest: Session | undefined, color: string): Look {
  if (!isOpenTask(t)) return { bg: tint(color, 10), bd: tint(color, 22), fg: "text-mut2", check: t.status === "done" };
  if (latest?.status === "finished") return { bg: tint(color, 20), bd: "rgb(139 142 245 / 0.7)", fg: "text-fg2", dot: true };
  if ((latest && isActive(latest)) || t.status === "progress" || t.status === "review") {
    return { bg: tint(color, 34), bd: tint(color, 62), fg: "text-strong" };
  }
  if (t.status === "backlog") return { bg: "transparent", bd: tint(color, 34), fg: "text-mut2", dashed: true };
  return { bg: tint(color, 5), bd: tint(color, 50), fg: "text-mut", dashed: true };
}

function sessionColor(x: Session, color: string): string {
  if (isActive(x)) return color;
  if (x.status === "finished") return "#8b8ef5";
  if (x.status === "done") return tint(color, 50);
  return "#3a3a3f";
}

const SESSION_STATE: Record<SessionStatus, string> = {
  starting: "starting", running: "running", finished: "finished, waiting for you", done: "done", closed: "closed", failed: "couldn't start",
};

function sessionTitle(x: Session): string {
  const end = x.finishedAt ?? x.endedAt;
  const start = format(parseLocal(x.startedAt), "EEE d MMM, HH:mm");
  const until = isActive(x) || !end ? "now" : format(parseLocal(end), dateOnly(end) === dateOnly(x.startedAt) ? "HH:mm" : "EEE d MMM, HH:mm");
  return `${AGENT_LABEL[x.agent]} session · ${start} to ${until} · ${SESSION_STATE[x.status]}`;
}

const hours = (min: number) => (min < 60 ? `${min}m` : `${Math.round(min / 6) / 10}h`);

/** Rough width of an 11px label, to decide whether it fits inside a bar. */
const textWidth = (s: string) => s.length * 6;

/** A small date hint at the edge for bars that are outside the visible range. */
function EdgeHint({ span, sc }: { span: Span; sc: Scale }) {
  if (span.e > 0 && span.s < sc.days) return null;
  const before = span.e <= 0;
  const day = addDaysStr(sc.from, before ? Math.ceil(span.e) - 1 : Math.floor(span.s));
  return (
    <span className={cx("absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-dim", before ? "left-1.5" : "right-1.5")}>
      {before ? `‹ ${fmtShort(day)}` : `${fmtShort(day)} ›`}
    </span>
  );
}

/* ---------- lanes ---------- */

function CapLane({ loads, dayMinutes, sc }: { loads: Record<string, DayLoad>; dayMinutes: number; sc: Scale }) {
  const w = Math.max(3, Math.min(28, sc.dayW * 0.52));
  return Array.from({ length: sc.days }, (_, i) => {
    const day = addDaysStr(sc.from, i);
    const past = day < sc.today;
    const min = (past ? loads[day]?.done : loads[day]?.planned) ?? 0;
    const x0 = sc.X(i);
    const cw = sc.X(i + 1) - x0;
    const label = `${format(parseLocal(day), "EEE d MMM")} · ${min ? `${hours(min)} ${past ? "done" : "planned"}` : past ? "nothing done" : "nothing planned"}`;
    return (
      <span key={day} title={label} className="absolute inset-y-0" style={{ left: x0, width: cw }}>
        <span className="absolute bottom-1.5 rounded-[2px]"
          style={{ left: (cw - w) / 2, width: w, height: Math.max(2, Math.round(Math.min(1, min / dayMinutes) * 26)), background: day === sc.today ? "#a1a1a8" : past ? "#252528" : "#3a3a3f" }} />
        {sc.dayW >= 60 && min > 0 && (
          <span className="absolute bottom-1 text-[11px] text-mut2" style={{ left: (cw + w) / 2 + 6 }}>{hours(min)}</span>
        )}
      </span>
    );
  });
}

function ProjectLane({ row, sc }: { row: ProjectRow; sc: Scale }) {
  const { project: p, color, span } = row;
  if (!span) return null;
  const clampX = (d: number) => sc.X(Math.max(0, Math.min(sc.days, d)));
  const visible = span.e > 0 && span.s < sc.days;
  const left = clampX(span.s) + 1;
  const width = Math.max(6, clampX(span.e) - 1 - left);
  const later = !row.started && !!p.startDate && p.startDate > sc.today;
  const pct = row.total ? Math.round((row.done / row.total) * 100) : 0;
  const text = later ? `Starts ${fmtShort(p.startDate!)}` : `${pct}%`;
  const inside = width >= textWidth(text) + 16;
  const target = p.targetDate ? dayDiff(sc.from, p.targetDate) + 0.5 : null;
  const showTarget = target !== null && target >= 0 && target < sc.days;
  return (
    <>
      {visible && (
        <div className="absolute flex items-center overflow-hidden rounded"
          style={{ top: 7, height: 16, left, width, background: later ? "transparent" : tint(color, 13), border: `1px ${later ? "dashed" : "solid"} ${tint(color, later ? 40 : 34)}` }}>
          {!later && <span className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: tint(color, 36) }} />}
          {inside && <span className="relative px-1.5 text-[11px] leading-[14px] text-fg2">{text}</span>}
        </div>
      )}
      {visible && !inside && (
        <span className="absolute whitespace-nowrap text-[11px] leading-4 text-mut2" style={{ top: 7, left: left + width + (showTarget ? 14 : 6) }}>
          {text}
        </span>
      )}
      {showTarget && (
        <span title={`Target date · ${fmtDay(p.targetDate!)}`} className="absolute flex" style={{ left: sc.X(target!) - 5.5, top: 10 }}>
          <Diamond color={color} hollow />
        </span>
      )}
      <EdgeHint span={span} sc={sc} />
    </>
  );
}

function TaskLane({ row, state, sc, layers }: { row: TaskRow; state: TaskState | undefined; sc: Scale; layers: Record<Layer, boolean> }) {
  const { task: t, color, span, sessions } = row;
  const look = barLook(t, sessions[sessions.length - 1], color);
  const clampX = (d: number) => sc.X(Math.max(0, Math.min(sc.days, d)));
  const visible = span.e > 0 && span.s < sc.days;
  const left = clampX(span.s) + 1;
  const width = Math.max(6, clampX(span.e) - 1 - left);
  const text = state?.short ?? "";
  const inside = width >= textWidth(text) + (look.check ? 30 : 16);

  const due = span.due;
  const flag = layers.deadlines && due !== null && due >= 0 && due <= sc.days;
  const overdue = isOpenTask(t) && due !== null && due < sc.nowPos;
  const flagX = due === null ? 0 : sc.X(due) + 2;
  // Things drawn right after the bar: the deadline flag (when the bar runs up to it), the "waiting for you" dot, the label.
  let after = left + width + 4;
  if (flag && due! > span.s) after = Math.max(after, flagX + 14);
  const dotX = after;
  if (look.dot) after += 11;
  const outRight = after + 2 + textWidth(text) <= sc.gridW || left < textWidth(text) + 12;

  return (
    <>
      {layers.tasks && visible && (
        <>
          <div title={`${t.key} · ${state?.text ?? ""}`}
            className={cx("absolute flex items-center gap-[5px] overflow-hidden whitespace-nowrap rounded px-1.5 text-[11px]", look.fg)}
            style={{ top: BAR_TOP, height: BAR_H, left, width, background: look.bg, border: `1px ${look.dashed ? "dashed" : "solid"} ${look.bd}` }}>
            {look.check && <Icon name="check" size={10} strokeWidth={2.8} className="shrink-0" />}
            {inside && <span className="truncate">{text}</span>}
          </div>
          {look.dot && <span className="absolute h-[7px] w-[7px] rounded-full bg-accent" style={{ left: dotX, top: BAR_MID - 3 }} />}
          {!inside && text && (
            <span className="absolute whitespace-nowrap text-[11px] leading-4 text-mut2"
              style={outRight ? { top: BAR_TOP + 1, left: after + 2 } : { top: BAR_TOP + 1, right: sc.gridW - left + 6 }}>
              {text}
            </span>
          )}
        </>
      )}
      {layers.tasks && isOpenTask(t) && <EdgeHint span={span} sc={sc} />}
      {flag && (
        <span title={`${overdue ? "Overdue, was due" : "Due"} ${fmtDay(t.dueDate!)}${timeOf(t.dueDate) ? `, ${timeOf(t.dueDate)}` : ""}`}
          className={cx("absolute flex", !isOpenTask(t) ? "text-dim" : overdue ? "text-danger" : "text-mut")} style={{ left: flagX, top: BAR_MID - 6 }}>
          <Icon name="flag" size={11} strokeWidth={2.4} />
        </span>
      )}
      {layers.sessions && sessions.map((x) => {
        const sp = sessionSpan(x, sc.from, sc.now);
        if (sp.e < 0 || sp.s > sc.days) return null;
        const l = clampX(sp.s);
        return (
          <span key={x.id} title={sessionTitle(x)} className="absolute flex h-[9px] items-center" style={{ top: LANE_TOP - 3, left: l, width: Math.max(6, clampX(sp.e) - l) }}>
            <span className="h-[3px] w-full rounded-full" style={{ background: sessionColor(x, color) }} />
          </span>
        );
      })}
    </>
  );
}

/* ---------- header with weeks and days ---------- */

function DayHeader({ sc, zoom }: { sc: Scale; zoom: TimelineZoom }) {
  const out: ReactNode[] = [];
  const pill = (day: string, d: Date, i: number) => {
    const isToday = day === sc.today;
    const weekend = i % 7 >= 5;
    return (
      <span className={cx("inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[3px] text-[11px]",
        isToday ? "bg-accent text-bg" : weekend ? "text-dim" : day < sc.today ? "text-mut2" : "text-fg3")}>
        {d.getDate()}
      </span>
    );
  };
  for (let i = 0; i < sc.days; i++) {
    const day = addDaysStr(sc.from, i);
    const d = parseLocal(day);
    const x0 = sc.X(i);
    const cw = sc.X(i + 1) - x0;
    if (zoom === "quarter") {
      // Months on top, Mondays below (today's week shows today's number instead). The range starts on a Monday.
      if (d.getDate() === 1 || (i === 0 && d.getDate() < 22)) {
        out.push(<span key={`m${i}`} className="absolute top-[5px] whitespace-nowrap pl-1.5 text-[11px] text-mut" style={{ left: x0 }}>{format(d, "MMMM")}</span>);
      }
      const thisWeek = dayDiff(day, sc.today) >= 0 && dayDiff(day, sc.today) < 7;
      if (i % 7 === 0 && !thisWeek) {
        out.push(<span key={`w${i}`} className={cx("absolute top-[22px] pl-0.5 text-[11px] leading-[18px]", day < sc.today ? "text-mut2" : "text-fg3")} style={{ left: x0 }}>{d.getDate()}</span>);
      }
      if (day === sc.today) {
        out.push(<span key="today" className="absolute top-[22px] -translate-x-1/2" style={{ left: x0 + cw / 2 }}>{pill(day, d, i)}</span>);
      }
      continue;
    }
    if (i % 7 === 0) {
      out.push(
        <span key={`w${i}`} className="absolute top-[5px] whitespace-nowrap pl-1.5 text-[11px] text-mut" style={{ left: x0 }}>
          Week {getISOWeek(d)} · {format(d, "d MMM")}
        </span>,
      );
    }
    out.push(
      <span key={`d${i}`} className="absolute top-[22px] flex h-[18px] items-center justify-center gap-1" style={{ left: x0, width: cw }}>
        {zoom === "week" && <span className={cx("text-[11px]", i % 7 >= 5 ? "text-dim" : "text-mut2")}>{format(d, "EEE")}</span>}
        {pill(day, d, i)}
      </span>,
    );
  }
  return out;
}

/* ---------- the view ---------- */

function rangeLabel(from: string, days: number) {
  const a = parseLocal(from);
  const b = parseLocal(addDaysStr(from, days - 1));
  return `${format(a, a.getFullYear() === b.getFullYear() ? "d MMM" : "d MMM yyyy")} to ${format(b, "d MMM yyyy")}`;
}

export function Timeline(props: {
  /** Monday the range starts on, "YYYY-MM-DD". */
  from: string;
  /** Server time, "YYYY-MM-DDTHH:mm:ss". */
  now: string;
  zoom: TimelineZoom;
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  edges: FlowEdge[];
  states: Record<number, TaskState>;
  loads: Record<string, DayLoad>;
  /** Focus minutes in a full working day, the height of a full "Your time" bar. */
  dayMinutes: number;
  ctx: TaskContext;
  initialKey: string | null;
}) {
  const { from, areas, projects, tasks, sessions, edges, states, loads, dayMinutes, ctx } = props;
  const [zoom, setZoom] = useState(props.zoom);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ tasks: true, sessions: true, blocks: true, deadlines: true, deps: true });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<string | null>(props.initialKey);
  const [tick, setTick] = useState<string | null>(null);
  const [scrollRef, width] = useWidth<HTMLDivElement>(TREE + 924);

  useEffect(() => {
    const id = setInterval(() => setTick(toStamp(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea, [role=dialog]")) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const now = tick && tick > props.now ? tick : props.now;
  const { days, minDay } = ZOOM[zoom];
  const dayW = Math.max(minDay, (width - TREE) / days);
  const X = (d: number) => Math.round(d * dayW);
  const sc: Scale = { from, days, dayW, gridW: X(days), X, now, nowPos: dayPos(from, now), today: dateOnly(now) };

  const sessionsOf = new Map<number, Session[]>();
  for (const x of [...sessions].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    sessionsOf.set(x.taskId, [...(sessionsOf.get(x.taskId) ?? []), x]);
  }
  const spans = taskSpans(tasks, sessionsOf, edges, from);
  const { rows, height } = buildRows({ areas, projects, tasks, sessionsOf, spans, sc, expanded, collapsed });

  const taskRows = new Map(rows.filter((r): r is TaskRow => r.kind === "task").map((r) => [r.task.id, r]));
  const deps = layers.deps && layers.tasks
    ? edges.flatMap((e) => {
      const a = taskRows.get(e.fromTaskId);
      const b = taskRows.get(e.toTaskId);
      if (!a || !b) return [];
      // Leaves from under the end of the earlier bar, so it never runs through that bar's label.
      const down = b.y > a.y;
      const x1 = Math.max(X(a.span.s) + 3, X(a.span.e) - 5);
      const y1 = a.y + (down ? BAR_TOP + BAR_H : BAR_TOP);
      const x2 = X(b.span.s);
      const y2 = b.y + BAR_MID;
      const ym = down ? b.y : b.y + b.h;
      return [{
        id: e.id,
        d: `M${x1} ${y1} V${ym} H${x2 - 6} V${y2} H${x2 - 1}`,
        head: `M${x2 - 5} ${y2 - 3} L${x2 - 1} ${y2} L${x2 - 5} ${y2 + 3}`,
      }];
    })
    : [];

  const selected = sel ? tasks.find((t) => t.key === sel) ?? null : null;
  const select = (t: Task) => setSel((s) => (s === t.key ? null : t.key));

  const href = (start: string | null) => {
    const q = new URLSearchParams();
    if (start) q.set("from", start);
    if (zoom !== "month") q.set("zoom", zoom);
    const s = q.toString();
    return s ? `/timeline?${s}` : "/timeline";
  };
  // The zoom only changes the layout, so it is kept in the URL without asking the server again.
  const pickZoom = (z: TimelineZoom) => {
    setZoom(z);
    const q = new URLSearchParams(window.location.search);
    if (z === "month") q.delete("zoom");
    else q.set("zoom", z);
    const s = q.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  };

  return (
    <div className="flex min-w-0 flex-1">
      <section aria-label="Timeline" className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
          <Icon name="timeline" className="text-mut" />
          <h1 className="text-[14px] font-semibold text-strong">Timeline</h1>
          <span className="text-mut2">{rangeLabel(from, days)}</span>
          <div className="ml-1.5 flex items-center gap-0.5">
            <Link href={href(addDaysStr(from, -days))} aria-label="Earlier" title="Earlier" className={NAV}>
              <Icon name="chevronLeft" size={14} strokeWidth={2} />
            </Link>
            <Link href={href(addDaysStr(from, days))} aria-label="Later" title="Later" className={NAV}>
              <Icon name="chevronRight" size={14} strokeWidth={2} />
            </Link>
            <Link href={href(null)} className="ml-0.5 inline-flex h-[26px] items-center rounded-md border border-line2 px-2 text-[12.5px] text-fg3 hover:bg-hover">
              Today
            </Link>
          </div>
          <span className="flex-1" />
          <Segmented value={zoom} onChange={pickZoom}
            options={(Object.keys(ZOOM) as TimelineZoom[]).map((z) => ({ value: z, label: ZOOM[z].label }))} />
        </div>

        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-5 text-[12px]">
          <span className="mr-1 text-mut2">Show</span>
          {LAYERS.map((l) => (
            <button key={l.id} type="button" aria-pressed={layers[l.id]} onClick={() => setLayers((v) => ({ ...v, [l.id]: !v[l.id] }))}
              className={cx("flex h-[26px] items-center gap-1.5 rounded-full border px-2.5 hover:bg-hover", layers[l.id] ? "border-ctl text-fg2" : "border-line text-dim")}>
              <span className={cx("h-1.5 w-1.5 rounded-full", layers[l.id] ? "bg-mut" : "bg-[#252528]")} />
              {l.label}
            </button>
          ))}
          <span className="flex-1" />
          <span className="text-mut2">Grouped by area</span>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          <div style={{ width: TREE + sc.gridW }}>
            <div className="sticky top-0 z-20 flex h-11 border-b border-line bg-panel">
              <div className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-panel pl-5 pr-4 text-[11.5px] text-mut2" style={{ width: TREE }}>
                Areas, projects and tasks
              </div>
              <div className="relative shrink-0 overflow-hidden" style={{ width: sc.gridW }}>
                <DayHeader sc={sc} zoom={zoom} />
              </div>
            </div>

            <div className="relative" style={{ height }}>
              {Array.from({ length: days }, (_, i) => i).filter((i) => i % 7 >= 5).map((i) => (
                <span key={i} className="pointer-events-none absolute inset-y-0"
                  style={{ left: TREE + X(i), width: X(i + 1) - X(i), background: "rgb(255 255 255 / 0.018)" }} />
              ))}

              {rows.map((r) => {
                const isSel = r.kind === "task" && r.task.key === sel;
                const bg = r.kind === "area" ? "bg-raised" : isSel ? "bg-sel" : "bg-panel group-hover:bg-hover";
                return (
                  <div key={r.id} className={cx("group flex", r.kind === "area" ? "bg-raised" : isSel ? "bg-sel" : "hover:bg-hover")}
                    style={{ height: r.h, borderBottom: `1px solid ${r.kind === "task" ? "#0a0a0c" : "#0e0e10"}` }}>
                    <div className={cx("sticky left-0 z-10 flex shrink-0 items-center gap-2 overflow-hidden border-r border-line pr-3", bg)}
                      style={{ width: TREE, paddingLeft: r.kind === "task" ? r.indent : r.kind === "proj" ? 26 : 20 }}>
                      {r.kind === "cap" && (
                        <>
                          <span className="text-[12.5px] text-fg2">Your time</span>
                          <span className="truncate text-[11.5px] text-mut2">hours planned per day</span>
                        </>
                      )}
                      {r.kind === "area" && (
                        <button type="button" aria-expanded={r.open} onClick={() => setCollapsed((c) => ({ ...c, [r.areaId]: r.open }))}
                          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left">
                          <Icon name={r.open ? "chevronDown" : "chevronRight"} size={11} strokeWidth={2.6} className="shrink-0 text-mut2" />
                          {r.color ? <Dot color={r.color} /> : <Icon name="inbox" size={12} className="shrink-0 text-mut2" />}
                          <span className="truncate text-[12.5px] font-medium text-fg2">{r.name}</span>
                        </button>
                      )}
                      {r.kind === "proj" && (
                        <button type="button" aria-expanded={r.total ? r.open : undefined} disabled={!r.total}
                          onClick={() => setExpanded((x) => ({ ...x, [r.project.id]: !r.open }))}
                          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
                          <Icon name={r.open ? "chevronDown" : "chevronRight"} size={11} strokeWidth={2.6} className={cx("shrink-0 text-dim", !r.total && "invisible")} />
                          <ProgressRing pct={r.total ? (r.done / r.total) * 100 : 0} color={r.color} />
                          <span className="min-w-0 flex-1 truncate text-fg">{r.project.name}</span>
                          <span className="shrink-0 text-[11.5px] text-mut2">{r.total ? `${r.done} of ${r.total}` : "No tasks"}</span>
                        </button>
                      )}
                      {r.kind === "task" && (
                        <button type="button" onClick={() => select(r.task)} className="flex h-full min-w-0 flex-1 items-center gap-2 text-left">
                          <span className="w-[46px] shrink-0 font-mono text-[11px] text-mut2">{r.task.key}</span>
                          <span className={cx("min-w-0 flex-1 truncate text-[12.5px]", isOpenTask(r.task) ? "text-fg2" : "text-mut2")}>{r.task.title}</span>
                        </button>
                      )}
                    </div>
                    <div className={cx("relative shrink-0 overflow-hidden", r.kind === "task" && "cursor-pointer")} style={{ width: sc.gridW }}
                      onClick={r.kind === "task" ? () => select(r.task) : undefined}>
                      {r.kind === "cap" && layers.blocks && <CapLane loads={loads} dayMinutes={dayMinutes} sc={sc} />}
                      {r.kind === "proj" && <ProjectLane row={r} sc={sc} />}
                      {r.kind === "task" && <TaskLane row={r} state={states[r.task.id]} sc={sc} layers={layers} />}
                    </div>
                  </div>
                );
              })}

              {deps.length > 0 && (
                <svg width={sc.gridW} height={height} className="pointer-events-none absolute top-0" style={{ left: TREE }} aria-hidden="true">
                  {deps.map((p) => (
                    <g key={p.id}>
                      <path d={p.d} fill="none" stroke="#3a3a3f" strokeWidth="1.2" strokeLinejoin="round" />
                      <path d={p.head} fill="none" stroke="#5e5e64" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </g>
                  ))}
                </svg>
              )}
              {sc.nowPos >= 0 && sc.nowPos <= days && (
                <span className="pointer-events-none absolute inset-y-0 w-px" style={{ left: TREE + X(sc.nowPos), background: "rgb(139 142 245 / 0.75)" }} />
              )}
            </div>
          </div>
        </div>
      </section>
      {selected && <TaskDetail key={`${selected.id}-${selected.updatedAt}`} task={selected} ctx={ctx} onClose={() => setSel(null)} />}
    </div>
  );
}
