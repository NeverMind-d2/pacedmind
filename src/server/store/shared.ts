import "server-only";
import { addDays } from "date-fns";
import { parseLocal, toDateStr } from "@/lib/dates";
import type {
  CalEvent, Doer, EdgeMode, EventOccurrence, FlowEdge, Priority, ReportCriterion, ReportOutcome, SessionStatus, Settings, Status,
  Surface, AgentId,
} from "@/lib/types";

/*
 * What the two stores share: the shapes their functions take, and the rules that don't depend on where the
 * data lives (the account's, in Supabase, or this computer's own, in SQLite).
 */

export interface TaskFilter {
  /** An area's tasks, or with null the tasks without an area. */
  areaId?: string | null;
  /** A project's tasks, or with null the tasks without a project. */
  projectId?: string | null;
}

export interface TaskInput {
  title: string;
  areaId?: string | null;
  projectId?: string | null;
  description?: string;
  status?: Status;
  priority?: Priority;
  dueDate?: string | null;
  plannedDate?: string | null;
  estimateMin?: number;
  labels?: string[];
  doneWhen?: string[];
  agent?: Doer | null;
}

export type TaskPatch = Partial<TaskInput & {
  reminder: string | null; sortOrder: number; flowX: number | null; flowY: number | null;
  runIn: Surface | null; deviceId: string | null; folder: string | null;
}>;

export interface SessionFilter {
  taskId?: number;
  status?: SessionStatus[];
  continuesSessionId?: string;
  surface?: Surface;
  agent?: AgentId;
  deviceId?: string;
}

export interface ReportInput {
  sessionId: string;
  taskId: number;
  outcome: ReportOutcome;
  summary: string;
  details?: string;
  criteria?: ReportCriterion[];
  verify?: string[];
  questions?: string[];
  links?: { label: string; url: string }[];
  followUps?: string[];
  /** Defaults to now. */
  createdAt?: string;
}

/**
 * A Codex cloud environment's label or id. It becomes part of a command line (`codex cloud exec --env …`), so
 * it's held to letters, digits, spaces and . _ / : - (the database checks the same, and the launcher again).
 */
export const CODEX_ENV = /^[A-Za-z0-9][A-Za-z0-9 ._/:-]{0,99}$/;

export function codexEnvProblem(value: string): string | null {
  return CODEX_ENV.test(value) ? null : "Use the environment's label or id: letters, digits, spaces and . _ / : - (up to 100 characters).";
}

/** "Done when" items without blanks or repeats, as many and as long as the database keeps. */
export const cleanDoneWhen = (items: string[]) =>
  [...new Set(items.map((x) => x.replace(/\s+/g, " ").trim().slice(0, 400)).filter(Boolean))].slice(0, 50);

/** A link the app may show for a session: https only, as the database keeps it. */
export const SESSION_URL = /^https:\/\/[^\s<>"']{1,1000}$/;

/** "Work" becomes WRK, "Health" HLT, "Dev" DEV; unique among the keys already `taken`. */
export function deriveKey(name: string, taken: Set<string>): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  const consonants = letters.slice(1).replace(/[AEIOUY]/g, "");
  let base = letters.length <= 3 ? letters : letters[0] + consonants.slice(0, 2);
  if (base.length < 3) base = letters.slice(0, 3);
  if (base.length < 3) base = (base + "XXX").slice(0, 3);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 2)}${i}`;
  return key;
}

/* ---------- calendar ---------- */

const stampMin = (d: Date) => `${toDateStr(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Expands events (including weekly ones) into occurrences between from and to (inclusive dates). */
export function expandOccurrences(events: CalEvent[], from: string, to: string): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  const start = parseLocal(from);
  const end = parseLocal(to);
  for (const e of events) {
    const first = parseLocal(e.start);
    const durMs = parseLocal(e.end).getTime() - first.getTime();
    if (e.recurrence === "weekly") {
      for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        if (d.getDay() !== first.getDay() || toDateStr(d) < e.start.slice(0, 10)) continue;
        const st = new Date(d.getFullYear(), d.getMonth(), d.getDate(), first.getHours(), first.getMinutes());
        const en = new Date(st.getTime() + durMs);
        out.push({ eventId: e.id, title: e.title, areaId: e.areaId, start: stampMin(st), end: stampMin(en) });
      }
    } else {
      const day = e.start.slice(0, 10);
      if (day >= from.slice(0, 10) && day <= to.slice(0, 10)) {
        out.push({ eventId: e.id, title: e.title, areaId: e.areaId, start: e.start, end: e.end });
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/* ---------- reports ---------- */

/*
 * A report's lists come from wherever the report was stored; in the cloud, any browser or computer signed in
 * to the account can write them. Keep only the shapes the app shows, and only http and https links.
 */
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const VERDICTS = new Set<string>(["met", "partly", "not_met"]);

export function criteriaOf(v: unknown): ReportCriterion[] {
  if (!Array.isArray(v)) return [];
  return v.filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string").map((c) => ({
    text: String(c.text),
    verdict: VERDICTS.has(String(c.verdict)) ? (c.verdict as ReportCriterion["verdict"]) : null,
    note: typeof c.note === "string" ? c.note : "",
  }));
}

export function linksOf(v: unknown): { label: string; url: string }[] {
  if (!Array.isArray(v)) return [];
  return v.filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && typeof (l as Record<string, unknown>).url === "string"
    && /^https?:\/\//i.test(String((l as Record<string, unknown>).url)))
    .map((l) => ({ label: typeof l.label === "string" && l.label.trim() ? l.label : String(l.url), url: String(l.url) }));
}

/* ---------- flows ---------- */

/** A connection as a flow confirms it: which task, after which, and how (the time too, for "at a set time"). */
export const edgeSignature = (e: { fromTaskId: number; toTaskId: number; mode: EdgeMode; atTime: string | null }) =>
  `${e.fromTaskId}>${e.toTaskId}:${e.mode}${e.mode === "time" ? `@${e.atTime ?? ""}` : ""}`;

/** A project's flow as it is: the connections into and out of its tasks, and the project it starts after. */
export function snapshotOf(taskIds: number[], edges: FlowEdge[], after: string | null): { edges: string[]; after: string | null } {
  const ids = new Set(taskIds);
  return { edges: edges.filter((e) => ids.has(e.fromTaskId) || ids.has(e.toTaskId)).map(edgeSignature), after };
}

/* ---------- settings ---------- */

/** Planning settings, which follow the account (or stay on this computer). How sessions start is device.ts's. */
export const DEFAULT_SETTINGS: Settings = {
  workStart: "09:00", workEnd: "17:00", lunchStart: "12:30", lunchEnd: "13:30", workDays: [1, 2, 3, 4, 5],
};
export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];
