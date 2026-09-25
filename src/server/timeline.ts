import "server-only";
import { format } from "date-fns";
import * as repo from "./repo";
import { planTimeBlocks } from "@/lib/planner";
import { addDaysStr, dateOnly, dayDiff, fmtShort, fmtTime, minutesOf, parseLocal, timeOf, toDateStr, toDateTimeStr } from "@/lib/dates";
import { AGENT_LABEL, type FlowEdge, type Project, type Session, type Settings, type Task } from "@/lib/types";

/* Read-only helpers for the Timeline and Roadmap views. */

export type StateTone = "done" | "waiting" | "running" | "active" | "next" | "queued" | "idle";

export interface TaskState {
  /** Sentence for lists, e.g. "Finished 12:22, waiting for you". */
  text: string;
  /** Short label for timeline bars, e.g. "Finished 12:22". */
  short: string;
  tone: StateTone;
}

/** Minutes of your own time on a day. */
export interface DayLoad {
  /** Auto-planned focus time (today and later). */
  planned: number;
  /** Estimates of your own tasks finished that day (before today). */
  done: number;
}

export interface ProjectStats {
  done: number;
  total: number;
  /** Some task is in progress, in review or done. */
  started: boolean;
}

/** The newest session per task id. */
export function latestSessions(sessions: Session[]): Record<number, Session> {
  const out: Record<number, Session> = {};
  for (const s of sessions) if (!out[s.taskId]) out[s.taskId] = s;
  return out;
}

export function projectStats(projects: Project[], tasks: Task[]): Record<string, ProjectStats> {
  return Object.fromEntries(
    projects.map((p) => {
      const own = tasks.filter((t) => t.projectId === p.id && t.status !== "canceled");
      return [p.id, {
        done: own.filter((t) => t.status === "done").length,
        total: own.length,
        started: own.some((t) => t.status === "progress" || t.status === "review" || t.status === "done"),
      }];
    }),
  );
}

/** Focus minutes in a working day, from the work hours in Settings. */
export function workdayMinutes(s: Settings): number {
  return Math.max(60, minutesOf(s.workEnd) - minutesOf(s.workStart) - (minutesOf(s.lunchEnd) - minutesOf(s.lunchStart)));
}

/** Your time per day between from and from + days: auto-planned blocks from today on, finished work before today. */
export async function dayLoads(tasks: Task[], sessions: Session[], from: string, days: number, now = new Date()): Promise<Record<string, DayLoad>> {
  const today = toDateStr(now);
  const out: Record<string, DayLoad> = {};
  const add = (day: string, kind: keyof DayLoad, minutes: number) => {
    out[day] = out[day] ?? { planned: 0, done: 0 };
    out[day][kind] += minutes;
  };
  const horizon = Math.min(400, dayDiff(today, addDaysStr(from, days)));
  if (horizon > 0) {
    const plan = planTimeBlocks({
      tasks, sessions, now, days: horizon, settings: await repo.getSettings(), events: await repo.occurrences(today, addDaysStr(today, horizon)),
    });
    for (const b of plan.blocks) add(dateOnly(b.start), "planned", minutesOf(timeOf(b.end)!) - minutesOf(timeOf(b.start)!));
  }
  for (const t of tasks) {
    if (t.status !== "done" || !t.completedAt || t.agent) continue;
    const day = dateOnly(t.completedAt);
    if (day >= from && day < today) add(day, "done", t.estimateMin);
  }
  return out;
}

/* ---------- task state, for the task order and the timeline bars ---------- */

const READY = new Set(["review", "done"]);

/** Same rule as the flow engine: whether a connection lets its target start. */
function satisfied(edge: FlowEdge, source: Task | undefined, now: string): boolean {
  if (!source) return true;
  if (edge.mode === "manual") return source.status === "done";
  if (edge.mode === "time") return READY.has(source.status) && !!edge.atTime && edge.atTime <= now;
  return READY.has(source.status);
}

const joinAnd = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** "DEV-23" becomes "23" next to another DEV task. */
const shortKey = (key: string, own: string) => (key.split("-")[0] === own.split("-")[0] ? key.split("-")[1] ?? key : key);

/** "12:22" today, "Tue 12:22" within a week, otherwise "22 Sep". */
function when(stamp: string, today: string): string {
  const diff = Math.abs(dayDiff(stamp, today));
  if (diff === 0) return timeOf(stamp) ?? "today";
  if (diff < 7) return format(parseLocal(stamp), timeOf(stamp) ? "EEE HH:mm" : "EEE");
  return fmtShort(stamp);
}

function doneLabel(t: Task, today: string): string {
  if (!t.completedAt) return "Done";
  const diff = dayDiff(t.completedAt, today);
  if (diff === 0) return "Done today";
  if (diff === 1) return "Done yesterday";
  return diff < 7 ? `Done ${format(parseLocal(t.completedAt), "EEE")}` : `Done ${fmtShort(t.completedAt)}`;
}

function stateOf(t: Task, s: Session | undefined, incoming: FlowEdge[], byId: Map<number, Task>, today: string, now: string): TaskState {
  if (t.status === "done") return { text: doneLabel(t, today), short: "Done", tone: "done" };
  if (t.status === "canceled") return { text: "Canceled", short: "Canceled", tone: "done" };
  if (s && (s.status === "running" || s.status === "starting")) {
    return { text: `Running in ${AGENT_LABEL[s.agent]}`, short: `${AGENT_LABEL[s.agent]}, running`, tone: "running" };
  }
  if (s?.status === "finished") {
    const at = when(s.finishedAt ?? s.startedAt, today);
    return { text: `Finished ${at}, waiting for you`, short: `Finished ${at}`, tone: "waiting" };
  }
  const dueToday = t.dueDate && dateOnly(t.dueDate) === today && timeOf(t.dueDate) ? `Due ${fmtTime(t.dueDate)}` : null;
  if (t.status === "review") return { text: "In review", short: dueToday ?? "In review", tone: "active" };
  if (t.status === "progress") return { text: "In progress", short: dueToday ?? "In progress", tone: "active" };

  const key = (id: number) => byId.get(id)?.key ?? "a removed task";
  const same = incoming.find((e) => e.mode === "session");
  if (same) return { text: `Same session as ${key(same.fromTaskId)}`, short: "Same session", tone: "queued" };
  const blocking = incoming.filter((e) => !satisfied(e, byId.get(e.fromTaskId), now));
  if (blocking.length === 1 && blocking[0].mode === "manual") {
    return { text: `When you mark ${key(blocking[0].fromTaskId)} done`, short: "Manual start", tone: "next" };
  }
  if (blocking.length && blocking.every((e) => e.mode === "time" && e.atTime && READY.has(byId.get(e.fromTaskId)?.status ?? ""))) {
    const at = when(blocking.map((e) => e.atTime!).sort().at(-1)!, today);
    return { text: `Starts ${at}`, short: `At ${at}`, tone: "queued" };
  }
  if (blocking.length) {
    const keys = blocking.map((e) => key(e.fromTaskId));
    return { text: `Waits for ${joinAnd(keys)}`, short: `Waits for ${joinAnd(keys.map((k) => shortKey(k, t.key)))}`, tone: "queued" };
  }
  if (incoming.length) return { text: "Ready to start", short: "Ready", tone: "next" };
  if (t.status === "backlog") return { text: "Backlog", short: "Backlog", tone: "idle" };
  if (dueToday) return { text: dueToday, short: dueToday, tone: "idle" };
  if (t.plannedDate) {
    const day = t.plannedDate === today ? "for today" : when(t.plannedDate, today);
    return { text: `Planned ${day}`, short: "Planned", tone: "idle" };
  }
  return { text: "Todo", short: "Todo", tone: "idle" };
}

/**
 * What each task is doing or waiting for, from its status, its newest session and the
 * connections that lead into it: "Running in Codex", "When you mark DEV-21 done", …
 */
export function taskStates(tasks: Task[], sessions: Record<number, Session>, edges: FlowEdge[], now = new Date()): Record<number, TaskState> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const today = toDateStr(now);
  const stamp = toDateTimeStr(now);
  return Object.fromEntries(
    tasks.map((t) => [t.id, stateOf(t, sessions[t.id], edges.filter((e) => e.toTaskId === t.id), byId, today, stamp)]),
  );
}
