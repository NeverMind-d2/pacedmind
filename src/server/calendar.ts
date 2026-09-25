import "server-only";
import { format } from "date-fns";
import * as repo from "./repo";
import { dateOnly, dayDiff, minutesOf, parseLocal, toDateStr } from "@/lib/dates";
import { planTimeBlocks, type PlanResult, type PlannedBlock } from "@/lib/planner";
import type { Project, Session, Settings, Task } from "@/lib/types";

export type Health = "ok" | "risk" | "behind";

export interface ProjectTarget {
  id: string;
  name: string;
  areaId: string;
  /** Own color; null means the area's. */
  color: string | null;
  targetDate: string;
  done: number;
  total: number;
  daysLeft: number;
  health: Health;
}

/** Progress and health of every project with a target date, soonest first. Finished projects whose date passed are left out. */
export function projectTargets(projects: Project[], tasks: Task[], today: string): ProjectTarget[] {
  return projects
    .filter((p): p is Project & { targetDate: string } => !!p.targetDate)
    .map((p) => {
      const own = tasks.filter((t) => t.projectId === p.id && t.status !== "canceled");
      const done = own.filter((t) => t.status === "done").length;
      return {
        id: p.id, name: p.name, areaId: p.areaId, color: p.color, targetDate: p.targetDate, done, total: own.length,
        daysLeft: dayDiff(today, p.targetDate), health: health(p.startDate, p.targetDate, done, own.length, today),
      };
    })
    .filter((p) => p.daysLeft >= 0 || p.total === 0 || p.done < p.total)
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate));
}

/** Compares the share of tasks done with the share of time gone between the start and target dates. */
function health(start: string | null, target: string, done: number, total: number, today: string): Health {
  if (total > 0 && done === total) return "ok";
  if (today > target) return "behind";
  if (!start || start >= target) return "ok";
  const elapsed = Math.min(1, Math.max(0, dayDiff(start, today) / dayDiff(start, target)));
  const gap = elapsed - (total ? done / total : 0);
  return gap > 0.3 ? "behind" : gap > 0.15 ? "risk" : "ok";
}

export interface WeekPlan {
  blocks: PlannedBlock[];
  unplaced: PlanResult["unplaced"];
  plannedMinutes: number;
  capacityMinutes: number;
  /** "HH:mm" when the plan was made. */
  at: string;
}

const blockMinutes = (b: PlannedBlock) => minutesOf(b.end.slice(11, 16)) - minutesOf(b.start.slice(11, 16));

/**
 * Auto-plans from now to the end of the given week. Earlier days fill up first, so a later week only
 * gets what is left over. Returns null for weeks that are already over.
 */
export async function planWeek({ start, end, now, tasks, sessions, settings }: {
  start: string;
  end: string;
  now: Date;
  tasks: Task[];
  sessions: Session[];
  settings: Settings;
}): Promise<WeekPlan | null> {
  const today = toDateStr(now);
  if (end < today) return null;
  const result = planTimeBlocks({ tasks, sessions, settings, now, events: await repo.occurrences(today, end), days: dayDiff(today, end) + 1 });
  const blocks = result.blocks.filter((b) => dateOnly(b.start) >= start);
  const capacityMinutes = start > today
    ? planTimeBlocks({ tasks: [], sessions: [], settings, now: parseLocal(start), events: await repo.occurrences(start, end), days: 7 }).capacityMinutes
    : result.capacityMinutes;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const meantForThisWeek = (t: Task) => (t.plannedDate ? t.plannedDate <= end : !t.dueDate || dateOnly(t.dueDate) <= end);
  return {
    blocks,
    unplaced: result.unplaced.filter((u) => {
      const t = byId.get(u.taskId);
      return !!t && meantForThisWeek(t);
    }),
    plannedMinutes: blocks.reduce((m, b) => m + blockMinutes(b), 0),
    capacityMinutes,
    at: format(now, "HH:mm"),
  };
}
