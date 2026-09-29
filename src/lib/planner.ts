import { addDays } from "date-fns";
import { dateOnly, hhmm, minutesOf, parseLocal, toDateStr } from "./dates";
import type { EventOccurrence, Session, Settings, Task } from "./types";

export interface PlannedBlock {
  taskId: number;
  key: string;
  title: string;
  areaId: string | null;
  /** "YYYY-MM-DDTHH:mm" */
  start: string;
  end: string;
  kind: "task" | "check";
}

export interface PlanResult {
  blocks: PlannedBlock[];
  unplaced: { taskId: number; key: string; title: string; minutes: number; reason: string }[];
  plannedMinutes: number;
  capacityMinutes: number;
}

const MIN_BLOCK = 30;
const MAX_BLOCK = 120;
const BUFFER = 10;
const CHECK_MIN = 45;

type Interval = { day: string; from: number; to: number };

/** The minutes a task given a time on its planned day takes there: its estimate, at least a quarter of an hour. */
export const blockMinutes = (t: Pick<Task, "estimateMin">) => Math.max(15, t.estimateMin || 0);

/** An open task you gave a time on its planned day: it stays where you put it, and the planner works around it. */
export const isPinned = (t: Task): t is Task & { plannedDate: string; plannedTime: string } =>
  !!t.plannedDate && !!t.plannedTime && t.status !== "done" && t.status !== "canceled";

/**
 * Greedy auto time-blocking: fills free focus time (work hours minus lunch, fixed events and tasks
 * you put at a time yourself) with open tasks, most urgent first. Agent tasks are skipped, but a
 * finished agent session adds a short "check" block for you.
 */
export function planTimeBlocks(input: {
  tasks: Task[];
  events: EventOccurrence[];
  sessions: Session[];
  settings: Settings;
  now: Date;
  days: number;
}): PlanResult {
  const { tasks, events, sessions, settings, now } = input;
  const today = toDateStr(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const pinned = tasks.filter(isPinned);
  const free: Interval[] = [];
  let capacity = 0;
  for (let i = 0; i < input.days; i++) {
    const d = addDays(parseLocal(today), i);
    const day = toDateStr(d);
    if (!settings.workDays.includes(d.getDay() === 0 ? 7 : d.getDay())) continue;
    let spans: [number, number][] = [[minutesOf(settings.workStart), minutesOf(settings.workEnd)]];
    const busy: [number, number][] = [[minutesOf(settings.lunchStart), minutesOf(settings.lunchEnd)]];
    for (const e of events) {
      if (dateOnly(e.start) !== day) continue;
      busy.push([minutesOf(e.start.slice(11, 16)) - BUFFER, minutesOf(e.end.slice(11, 16)) + BUFFER]);
    }
    for (const t of pinned) {
      if (t.plannedDate !== day) continue;
      const at = minutesOf(t.plannedTime);
      busy.push([at - BUFFER, at + blockMinutes(t) + BUFFER]);
    }
    if (day === today) busy.push([0, Math.ceil(nowMin / 15) * 15]);
    for (const [bs, be] of busy) {
      spans = spans.flatMap(([s, e]) => {
        if (be <= s || bs >= e) return [[s, e]] as [number, number][];
        const out: [number, number][] = [];
        if (bs > s) out.push([s, bs]);
        if (be < e) out.push([be, e]);
        return out;
      });
    }
    for (const [s, e] of spans) {
      if (e - s >= MIN_BLOCK) {
        free.push({ day, from: s, to: e });
        capacity += e - s;
      }
    }
  }

  const blocks: PlannedBlock[] = [];
  const unplaced: PlanResult["unplaced"] = [];

  const place = (task: Task, minutes: number, kind: PlannedBlock["kind"], earliestDay: string | null) => {
    let left = minutes;
    for (const iv of free) {
      if (left <= 0) break;
      if (earliestDay && iv.day < earliestDay) continue;
      const len = Math.min(left, MAX_BLOCK, iv.to - iv.from);
      if (len < Math.min(MIN_BLOCK, left)) continue;
      blocks.push({
        taskId: task.id, key: task.key, title: task.title, areaId: task.areaId, kind,
        start: `${iv.day}T${hhmm(iv.from)}`, end: `${iv.day}T${hhmm(iv.from + len)}`,
      });
      iv.from += len + BUFFER;
      left -= len;
    }
    return left;
  };

  // 1. Checks for agent sessions that finished and wait for you.
  const finished = sessions.filter((s) => s.status === "finished");
  for (const s of finished) {
    const task = tasks.find((t) => t.id === s.taskId);
    if (task) place(task, CHECK_MIN, "check", null);
  }

  // 2. Your own open tasks, most urgent first.
  const rank = (t: Task) => {
    const due = t.dueDate ? dateOnly(t.dueDate) : "9999-12-31";
    const overdue = t.dueDate && dateOnly(t.dueDate) < today ? 0 : 1;
    const pr = t.priority === 0 ? 5 : t.priority;
    return `${overdue}|${due}|${t.plannedDate ?? "9999-12-31"}|${pr}|${String(t.id).padStart(6, "0")}`;
  };
  const mine = tasks
    .filter((t) => (t.status === "todo" || t.status === "progress") && (!t.agent || t.agent === "human") && !isPinned(t))
    .filter((t) => t.dueDate || t.plannedDate || t.priority === 1 || t.priority === 2)
    .sort((a, b) => rank(a).localeCompare(rank(b)));

  for (const t of mine) {
    const open = t.subtasks.length ? t.subtasks.filter((s) => !s.done).length / t.subtasks.length : 1;
    const minutes = Math.max(15, Math.round((t.estimateMin * (t.status === "progress" ? Math.max(open, 0.25) : 1)) / 15) * 15);
    const earliest = t.plannedDate && t.plannedDate > today ? t.plannedDate : null;
    const left = place(t, minutes, "task", earliest);
    if (left > 0) {
      unplaced.push({ taskId: t.id, key: t.key, title: t.title, minutes: left, reason: "No free focus time left in this range" });
    }
  }

  blocks.sort((a, b) => a.start.localeCompare(b.start));
  const plannedMinutes = blocks.reduce((m, b) => m + minutesOf(b.end.slice(11, 16)) - minutesOf(b.start.slice(11, 16)), 0);
  return { blocks, unplaced, plannedMinutes, capacityMinutes: capacity };
}
