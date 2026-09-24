"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { format } from "date-fns";
import { addDaysStr, dateOnly, fmtTime, hhmm, minutesOf, parseLocal, timeOf } from "@/lib/dates";
import type { PlannedBlock } from "@/lib/planner";
import { AGENT_LABEL, type AgentId, type Area, type EventOccurrence, type Settings, type Task, type TaskContext } from "@/lib/types";
import type { WeekPlan } from "@/server/calendar";
import { Icon } from "../icons";
import { TaskDetail } from "../task-detail";
import { Button, Dot, Switch, cx } from "../ui";
import { PeriodNav, ViewHeader, ViewSwitch, areaColor, isOpenTask, useNow, useSelection } from "./calendar-parts";

export interface SessionLane {
  id: string;
  key: string;
  agent: AgentId;
  start: string;
  /** null while the session is still running. */
  end: string | null;
}

export type WorkRules = Pick<Settings, "workStart" | "workEnd" | "lunchStart" | "lunchEnd" | "workDays">;

const H0 = 7;
const H1 = 21;
const PX = 52;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LANE: Record<AgentId, { right: number; color: string }> = { claude: { right: 11, color: "var(--color-mut)" }, codex: { right: 3, color: "var(--color-fg3)" } };

const y = (min: number) => Math.round(((min - H0 * 60) / 60) * PX);
const minutes = (b: { start: string; end: string }) => minutesOf(b.end.slice(11, 16)) - minutesOf(b.start.slice(11, 16));
const hours = (min: number) => Math.round((min / 60) * 10) / 10;

/** Minutes after midnight of `day` for a local timestamp, clamped to that day. */
function minOn(stamp: string, day: string) {
  const d = dateOnly(stamp);
  return d < day ? 0 : d > day ? 24 * 60 : minutesOf(stamp.slice(11, 16));
}

type Block = {
  id: string; s: number; e: number; kind: "fixed" | PlannedBlock["kind"]; title: string; areaId: string | null;
  key: string | null; start: string; end: string;
};

/** Puts overlapping blocks side by side: each cluster of overlaps gets as many columns as it needs. */
function columns(blocks: Block[]) {
  const out: (Block & { col: number; cols: number })[] = [];
  let cluster: typeof out = [];
  let ends: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const b of cluster) b.cols = ends.length;
    cluster = [];
    ends = [];
  };
  for (const b of [...blocks].sort((a, z) => a.s - z.s || z.e - a.e)) {
    if (b.s >= clusterEnd) flush();
    let col = ends.findIndex((e) => e <= b.s);
    if (col === -1) {
      col = ends.length;
      ends.push(b.e);
    } else {
      ends[col] = b.e;
    }
    const placed = { ...b, col, cols: 1 };
    cluster.push(placed);
    out.push(placed);
    clusterEnd = Math.max(clusterEnd, b.e);
  }
  flush();
  return out;
}

export function WeekView({
  days, now: serverNow, subtitle, current, events, plan, lanes, tasks, rules, ctx, nav, initialKey,
}: {
  /** Monday to Sunday. */
  days: string[];
  now: string;
  subtitle: string;
  /** The week contains today. */
  current: boolean;
  events: EventOccurrence[];
  plan: WeekPlan | null;
  lanes: SessionLane[];
  tasks: Task[];
  rules: WorkRules;
  ctx: TaskContext;
  nav: { prev: string; next: string; month: string; week: string };
  initialKey: string | null;
}) {
  const now = useNow(serverNow);
  const today = now.slice(0, 10);
  const nowMin = minutesOf(now.slice(11, 16));
  const router = useRouter();
  const [sel, setSel] = useSelection(initialKey);
  const [on, setOn] = useState(true);
  const selected = tasks.find((t) => t.key === sel) ?? null;
  const toggle = (key: string) => setSel((s) => (s === key ? null : key));

  const blocksOn = (day: string) => {
    const list: Block[] = events.filter((e) => dateOnly(e.start) === day).map((e) => ({
      id: `e${e.eventId}-${e.start}`, s: minOn(e.start, day), e: minOn(e.end, day), kind: "fixed", title: e.title,
      areaId: e.areaId, key: null, start: e.start, end: e.end,
    }));
    if (plan && on) {
      for (const b of plan.blocks) {
        if (dateOnly(b.start) !== day) continue;
        list.push({
          id: `b${b.taskId}-${b.start}`, s: minOn(b.start, day), e: minOn(b.end, day), kind: b.kind,
          title: b.kind === "check" ? `Check ${b.key}` : `${b.key} ${b.title}`, areaId: b.areaId, key: b.key, start: b.start, end: b.end,
        });
      }
    }
    return columns(list.filter((b) => b.e > H0 * 60 && b.s < H1 * 60));
  };

  const lanesOn = (day: string) => lanes.flatMap((l) => {
    const end = l.end ?? now;
    if (dateOnly(l.start) > day || dateOnly(end) < day) return [];
    const from = Math.max(minOn(l.start, day), H0 * 60);
    const to = Math.min(minOn(end, day), H1 * 60);
    return to >= from ? [{ ...l, top: y(from), height: Math.max(8, y(to) - y(from)) }] : [];
  });

  return (
    <div className="flex min-w-0 flex-1">
      <section aria-label="Week" className="flex min-w-0 flex-1 flex-col">
        <ViewHeader icon="calendar" title="Calendar" subtitle={subtitle}>
          <PeriodNav unit="week" prev={nav.prev} next={nav.next} today="/calendar/week" />
          <span className="flex-1" />
          <ViewSwitch value="week" month={nav.month} week={nav.week} />
        </ViewHeader>

        <div className="flex h-10 shrink-0 items-center gap-3.5 border-b border-line px-5 text-[12px] text-mut">
          <Legend swatch="border-ctl">Fixed</Legend>
          <Legend swatch="border-ctl bg-line">Planned for you</Legend>
          <Legend swatch="border-accent/55 bg-line">Check a finished session</Legend>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-sm" style={{ background: LANE.claude.color }} />
            <span className="h-3 w-1 rounded-sm" style={{ background: LANE.codex.color }} />
            Agent sessions
          </span>
          <span className="flex-1" />
          {plan && (
            <span className="truncate">
              {hours(plan.plannedMinutes)} h planned of {hours(plan.capacityMinutes)} h focus time{current ? " left" : ""}
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="sticky top-0 z-30 flex h-11 border-b border-line bg-panel">
              <div className="w-[52px] shrink-0" />
              {days.map((day, i) => {
                const dues = tasks.filter((t) => isOpenTask(t) && t.dueDate && dateOnly(t.dueDate) === day);
                const isToday = day === today;
                const past = day < today;
                const late = dues.some((t) => (timeOf(t.dueDate) ? t.dueDate! < now : past));
                const single = dues.length === 1 ? timeOf(dues[0].dueDate) : null;
                return (
                  <div key={day} className="flex min-w-0 flex-1 basis-0 items-center gap-1.5 border-l border-line px-2">
                    <span className={cx("text-[12px]", isToday ? "text-strong" : past ? "text-mut2" : "text-fg3")}>{DAY_NAMES[i]}</span>
                    <span className={cx("inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-[5px] text-[12px] font-medium",
                      isToday ? "bg-accent text-bg" : past ? "text-mut2" : "text-fg2")}>
                      {Number(day.slice(8))}
                    </span>
                    <span className="flex-1" />
                    {dues.length > 0 && (
                      <span title={dues.map((t) => `${t.key} ${t.title}`).join("\n")}
                        className={cx("inline-flex shrink-0 items-center gap-[3px] text-[11px]", late ? "text-danger" : isToday ? "text-fg2" : "text-fg3")}>
                        <Icon name="flag" size={10} strokeWidth={2.4} />
                        {past ? `${dues.length} missed` : (single ?? dues.length)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="relative flex" style={{ height: (H1 - H0) * PX }}>
              <div className="relative w-[52px] shrink-0">
                {Array.from({ length: H1 - H0 - 1 }, (_, k) => (
                  <span key={k} className="absolute right-2 font-mono text-[10.5px] text-dim" style={{ top: (k + 1) * PX - 7 }}>
                    {hhmm((H0 + k + 1) * 60)}
                  </span>
                ))}
              </div>
              {days.map((day, i) => (
                <div key={day} className="relative min-w-0 flex-1 basis-0 border-l border-line"
                  style={{
                    backgroundImage: "linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
                    backgroundSize: `100% ${PX}px`,
                    backgroundColor: rules.workDays.includes(i + 1) ? undefined : "var(--color-nonwork)",
                  }}>
                  {blocksOn(day).map((b) => (
                    <BlockView key={b.id} block={b} color={areaColor(ctx.areas, b.areaId)} past={b.end <= now}
                      selected={!!b.key && b.key === sel} onOpen={() => b.key && toggle(b.key)} />
                  ))}
                  {lanesOn(day).map((l) => {
                    const label = `${AGENT_LABEL[l.agent]}: ${l.key} · ${fmtTime(l.start)}–${l.end ? fmtTime(l.end) : "now, running"}`;
                    return (
                      <button key={l.id} type="button" title={label} aria-label={label} onClick={() => toggle(l.key)}
                        className="absolute z-10 w-1.5 rounded-[3px] hover:brightness-125"
                        style={{ top: l.top, height: l.height, right: LANE[l.agent].right, background: LANE[l.agent].color }} />
                    );
                  })}
                  {day === today && nowMin >= H0 * 60 && nowMin <= H1 * 60 && (
                    <>
                      <span className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-accent" style={{ top: y(nowMin) - 1 }} />
                      <span className="pointer-events-none absolute -left-1 z-20 h-2 w-2 rounded-full bg-accent" style={{ top: y(nowMin) - 4 }} />
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {!selected && (
            <AutoPlanPanel plan={plan} on={on} onToggle={setOn} current={current} tasks={tasks} areas={ctx.areas} rules={rules}
              today={today} now={now} onOpen={toggle} onReplan={() => router.refresh()} />
          )}
        </div>
      </section>
      {selected && <TaskDetail key={`${selected.id}-${selected.updatedAt}`} task={selected} ctx={ctx} onClose={() => setSel(null)} />}
    </div>
  );
}

function Legend({ swatch, children }: { swatch: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("h-2.5 w-2.5 rounded-[3px] border", swatch)} />
      {children}
    </span>
  );
}

function BlockView({ block: b, color, past, selected, onOpen }: {
  block: Block & { col: number; cols: number };
  color: string;
  past: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const top = y(Math.max(b.s, H0 * 60)) + 1;
  const height = Math.max(16, y(Math.min(b.e, H1 * 60)) - top - 1);
  const style = {
    top,
    height,
    left: `calc(3px + (100% - 23px) * ${b.col / b.cols})`,
    width: `calc((100% - 23px) / ${b.cols} - ${b.cols > 1 ? 2 : 0}px)`,
  };
  const tone = b.kind === "fixed" ? cx("border-ctl", past ? "text-mut2" : "text-fg3")
    : past ? "border-sel bg-hover text-mut2 hover:bg-hover"
    : b.kind === "check" ? "border-accent/55 bg-line text-strong hover:bg-sel"
    : "border-ctl bg-line text-strong hover:bg-sel";
  const cls = cx("absolute block overflow-hidden rounded-[5px] border px-1.5 text-left text-[11px] leading-[1.35]",
    height >= 24 ? "py-[3px]" : "py-0", tone, selected && "ring-1 ring-accent/70");
  const label = `${b.title}, ${fmtTime(b.start)}–${fmtTime(b.end)}`;
  const body = (
    <>
      <span className="flex items-center gap-[5px] overflow-hidden whitespace-nowrap font-medium">
        {b.kind === "check"
          ? <Icon name="terminal" size={10} strokeWidth={2.4} className={cx("shrink-0", past ? "text-dim" : "text-accent")} />
          : <Dot color={color} size={6} />}
        <span className="truncate">{b.title}</span>
      </span>
      {height >= 36 && (
        <span className={cx("block font-mono text-[10px]", past ? "text-dim" : b.kind === "fixed" ? "text-mut2" : "text-mut")}>
          {fmtTime(b.start)}–{fmtTime(b.end)}
        </span>
      )}
    </>
  );
  return b.key
    ? <button type="button" title={label} onClick={onOpen} className={cls} style={style}>{body}</button>
    : <div title={label} className={cls} style={style}>{body}</div>;
}

function workDaysText(days: number[]) {
  const ds = [...days].sort((a, b) => a - b);
  if (!ds.length) return "on no days";
  const range = ds.length > 2 && ds.every((d, i) => i === 0 || d === ds[i - 1] + 1);
  return range ? `${DAY_NAMES[ds[0] - 1]} to ${DAY_NAMES[ds[ds.length - 1] - 1]}` : ds.map((d) => DAY_NAMES[d - 1]).join(", ");
}

/** Short notes on what the planner did: checks it added, overdue work it placed, tasks it split. */
function planNotes(plan: WeekPlan, tasks: Task[], today: string, now: string) {
  const when = (stamp: string) => {
    const d = dateOnly(stamp);
    const day = d === today ? "today" : d === addDaysStr(today, 1) ? "tomorrow" : `on ${format(parseLocal(d), "EEE")}`;
    return `${day} at ${fmtTime(stamp)}`;
  };
  const notes: { dot: string; text: string }[] = [];
  const count = new Map<string, number>();
  for (const b of plan.blocks) {
    if (b.kind === "check") {
      notes.push({ dot: "var(--color-accent)", text: `${b.key} finished, so ${minutes(b)} min to check it was added ${when(b.start)}` });
      continue;
    }
    const n = (count.get(b.key) ?? 0) + 1;
    count.set(b.key, n);
    const t = tasks.find((x) => x.id === b.taskId);
    if (n === 1 && t?.dueDate && (timeOf(t.dueDate) ? t.dueDate < now : dateOnly(t.dueDate) < today)) {
      notes.push({ dot: "var(--color-danger)", text: `${b.key} is overdue, planned ${when(b.start)}` });
    }
  }
  for (const [key, n] of count) if (n > 1) notes.push({ dot: "var(--color-dim)", text: `Split ${key} into ${n} blocks` });
  return notes.slice(0, 4);
}

function AutoPlanPanel({ plan, on, onToggle, current, tasks, areas, rules, today, now, onOpen, onReplan }: {
  plan: WeekPlan | null;
  on: boolean;
  onToggle: (v: boolean) => void;
  current: boolean;
  tasks: Task[];
  areas: Area[];
  rules: WorkRules;
  today: string;
  now: string;
  onOpen: (key: string) => void;
  onReplan: () => void;
}) {
  const placed = new Set(plan?.blocks.map((b) => b.taskId));
  const byArea = new Map<string | null, number>();
  for (const b of plan?.blocks ?? []) byArea.set(b.areaId, (byArea.get(b.areaId) ?? 0) + minutes(b));
  const parts = [...byArea].sort((a, b) => b[1] - a[1]);
  const scale = Math.max(plan?.capacityMinutes ?? 0, plan?.plannedMinutes ?? 0, 1);
  const status = !plan ? "This week is over, so there is nothing left to plan."
    : !on ? "Auto-plan is off. Only fixed events are shown."
    : plan.blocks.length
      ? `Planned at ${plan.at} · ${placed.size} task${placed.size === 1 ? "" : "s"} in ${plan.blocks.length} block${plan.blocks.length === 1 ? "" : "s"}`
      : `Planned at ${plan.at} · nothing to place this week`;
  const ruleList = [
    `Focus time ${workDaysText(rules.workDays)}, ${rules.workStart} to ${rules.workEnd}`,
    `Keep ${rules.lunchStart} to ${rules.lunchEnd} free`,
    "Deadlines first, then priority",
    "Finished agent sessions get a check block",
    "Tasks for Claude Code and Codex are left to them",
  ];

  return (
    <aside aria-label="Auto-plan" className="flex w-[300px] shrink-0 flex-col overflow-hidden border-l border-line">
      <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
        <h2 className="flex-1 text-[12.5px] font-medium text-fg2">Auto-plan</h2>
        <Switch on={on} onChange={onToggle} label="Show planned blocks" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 py-3.5">
        <div className="flex flex-col gap-2">
          <div className="text-[12px] text-mut2">{status}</div>
          {plan && on && planNotes(plan, tasks, today, now).map((n, i) => (
            <div key={i} className="flex gap-2.5 text-[12.5px] leading-[1.45] text-fg3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: n.dot }} />
              <span>{n.text}</span>
            </div>
          ))}
        </div>

        {plan && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline text-[12.5px]">
              <span className="flex-1 text-fg2">{current ? "Rest of this week" : "This week"}</span>
              <span className="text-mut2">{hours(plan.plannedMinutes)} of {hours(plan.capacityMinutes)} h</span>
            </div>
            <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-[3px] bg-line">
              {parts.map(([id, m]) => (
                <span key={id ?? "none"} style={{ width: `${(m / scale) * 100}%`, background: areaColor(areas, id) }} />
              ))}
            </div>
            {parts.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-mut2">
                {parts.map(([id, m]) => <span key={id ?? "none"}>{areas.find((a) => a.id === id)?.name ?? "No area"} {hours(m)} h</span>)}
              </div>
            )}
          </div>
        )}

        {plan && plan.unplaced.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-ink/5 bg-ink/5 p-3">
            <div className="text-[12.5px] font-medium text-fg2">Didn&apos;t fit this week</div>
            {plan.unplaced.map((u) => (
              <button key={u.taskId} type="button" onClick={() => onOpen(u.key)}
                className="text-left text-[12.5px] leading-[1.45] text-fg3 hover:text-strong">
                <span className="font-mono text-[11.5px] text-mut2">{u.key}</span> {u.title} needs {hours(u.minutes)} h
                {placed.has(u.taskId) ? " more" : ""} and there&apos;s no free slot left this week.
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline text-[12.5px]">
            <span className="flex-1 text-fg2">Rules</span>
            <Link href="/settings" className="text-[12px] text-mut2 hover:text-fg2">Change</Link>
          </div>
          {ruleList.map((r) => (
            <div key={r} className="flex gap-2 text-[12px] leading-[1.45] text-mut">
              <span className="text-faint">·</span>
              <span>{r}</span>
            </div>
          ))}
        </div>

        {plan && (
          <Button onClick={onReplan} className="justify-center">
            <Icon name="refresh" size={13} strokeWidth={2} />Replan the week
          </Button>
        )}
      </div>
    </aside>
  );
}
