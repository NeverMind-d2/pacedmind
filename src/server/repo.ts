import "server-only";
import crypto from "node:crypto";
import { addDays } from "date-fns";
import { removeImageFiles, type StoredImage } from "./attachments";
import { db, tx } from "./db";
import { nowStamp, parseLocal, toDateStr } from "@/lib/dates";
import {
  taskHref,
  type AgentId, type AgentTools, type Area, type Attachment, type CalEvent, type Device, type Doer, type EdgeMode, type EventOccurrence,
  type FlowEdge, type Priority, type Project, type Report, type ReportCriterion, type ReportOutcome, type Session, type SessionEvent,
  type SessionStatus, type Settings, type Status, type Subtask, type Surface, type Task,
} from "@/lib/types";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));
/** A JSON column, or the fallback when it's empty or unreadable. */
function json<T>(v: unknown, fallback: T): T {
  try {
    return v == null || v === "" ? fallback : (JSON.parse(String(v)) as T);
  } catch {
    return fallback;
  }
}
const marks = (xs: unknown[]) => xs.map(() => "?").join(",");

/* ---------- areas and projects ---------- */

export function listAreas(): Area[] {
  return (db().prepare("SELECT * FROM areas ORDER BY sort").all() as Row[]).map((r) => ({
    id: String(r.id), name: String(r.name), key: String(r.key), color: String(r.color), sort: Number(r.sort),
  }));
}

/** "Work" becomes WRK, "Health" HLT, "Dev" DEV; unique among existing area keys. */
function deriveKey(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  const consonants = letters.slice(1).replace(/[AEIOUY]/g, "");
  let base = letters.length <= 3 ? letters : letters[0] + consonants.slice(0, 2);
  if (base.length < 3) base = letters.slice(0, 3);
  if (base.length < 3) base = (base + "XXX").slice(0, 3);
  const taken = new Set(listAreas().map((a) => a.key));
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 2)}${i}`;
  return key;
}

const slug = (name: string, fallback: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;

export function createArea(input: { name: string; color: string }): Area {
  const base = slug(input.name, "area");
  const ids = new Set(listAreas().map((a) => a.id));
  let id = base;
  for (let i = 2; ids.has(id); i++) id = `${base}-${i}`;
  const sort = Number((db().prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM areas").get() as Row).n);
  db().prepare("INSERT INTO areas (id, name, key, color, sort) VALUES (?, ?, ?, ?, ?)").run(id, input.name.trim(), deriveKey(input.name), input.color, sort);
  return listAreas().find((a) => a.id === id)!;
}

export function updateArea(id: string, patch: { name?: string; color?: string }) {
  if (patch.name?.trim()) db().prepare("UPDATE areas SET name = ? WHERE id = ?").run(patch.name.trim(), id);
  if (patch.color) db().prepare("UPDATE areas SET color = ? WHERE id = ?").run(patch.color, id);
}

/** Deletes an area and its projects. Tasks are kept and move to the Inbox. */
export function deleteArea(id: string) {
  tx(() => {
    const conn = db();
    conn.prepare("UPDATE tasks SET area_id = NULL, project_id = NULL WHERE area_id = ? OR project_id IN (SELECT id FROM projects WHERE area_id = ?)").run(id, id);
    conn.prepare("UPDATE events SET area_id = NULL WHERE area_id = ?").run(id);
    conn.prepare("UPDATE projects SET after_project_id = NULL WHERE after_project_id IN (SELECT id FROM projects WHERE area_id = ?)").run(id);
    conn.prepare("DELETE FROM projects WHERE area_id = ?").run(id);
    conn.prepare("DELETE FROM areas WHERE id = ?").run(id);
  });
}

/** Deletes a project. Its tasks stay in the project's area without a project. */
export function deleteProject(id: string) {
  tx(() => {
    const conn = db();
    conn.prepare("UPDATE projects SET after_project_id = NULL WHERE after_project_id = ?").run(id);
    conn.prepare("UPDATE tasks SET project_id = NULL WHERE project_id = ?").run(id);
    conn.prepare("DELETE FROM projects WHERE id = ?").run(id);
  });
}

const toProject = (r: Row): Project => ({
  id: String(r.id), areaId: String(r.area_id), name: String(r.name), color: s(r.color), startDate: s(r.start_date), targetDate: s(r.target_date),
  folder: s(r.folder), deviceId: s(r.device_id), codexEnv: s(r.codex_env), agent: s(r.agent) as AgentId | null, afterProjectId: s(r.after_project_id),
  flowOn: Number(r.flow_on) === 1, sort: Number(r.sort),
});

export function listProjects(): Project[] {
  return (db().prepare("SELECT * FROM projects ORDER BY sort").all() as Row[]).map(toProject);
}

export function getProject(id: string): Project | null {
  const r = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return r ? toProject(r) : null;
}

export function createProject(input: {
  name: string; areaId: string; folder?: string | null; deviceId?: string | null; agent?: AgentId | null; targetDate?: string | null;
  color?: string | null;
}): Project {
  const base = slug(input.name, "project");
  let id = base;
  for (let i = 2; getProject(id); i++) id = `${base}-${i}`;
  const sort = Number((db().prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM projects").get() as Row).n);
  db().prepare(
    `INSERT INTO projects (id, area_id, name, start_date, target_date, folder, device_id, agent, sort, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.areaId, input.name.trim(), toDateStr(new Date()), input.targetDate ?? null, input.folder ?? null, input.deviceId ?? null,
    input.agent ?? null, sort, input.color ?? null,
  );
  return getProject(id)!;
}

export function updateProject(id: string, patch: Partial<Omit<Project, "id">>) {
  const cols: Record<string, string> = {
    areaId: "area_id", name: "name", color: "color", startDate: "start_date", targetDate: "target_date", folder: "folder",
    deviceId: "device_id", codexEnv: "codex_env", agent: "agent", afterProjectId: "after_project_id", flowOn: "flow_on", sort: "sort",
  };
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in cols) || v === undefined) continue;
    sets.push(`${cols[k]} = ?`);
    vals.push(typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null));
  }
  if (!sets.length) return;
  db().prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  // A project's tasks always live in the project's area.
  if (patch.areaId) db().prepare("UPDATE tasks SET area_id = ? WHERE project_id = ?").run(patch.areaId, id);
}

/* ---------- tasks ---------- */

function subtasksFor(ids: number[]): Map<number, Subtask[]> {
  const map = new Map<number, Subtask[]>();
  if (!ids.length) return map;
  const rows = db().prepare(`SELECT * FROM subtasks WHERE task_id IN (${ids.map(() => "?").join(",")}) ORDER BY sort, id`).all(...ids) as Row[];
  for (const r of rows) {
    const st: Subtask = { id: Number(r.id), taskId: Number(r.task_id), title: String(r.title), done: Number(r.done) === 1, sort: Number(r.sort) };
    map.set(st.taskId, [...(map.get(st.taskId) ?? []), st]);
  }
  return map;
}

const toTask = (r: Row, subs: Subtask[]): Task => ({
  id: Number(r.id), key: String(r.key), areaId: s(r.area_id), projectId: s(r.project_id), title: String(r.title),
  description: String(r.description ?? ""), status: String(r.status) as Status, priority: Number(r.priority) as Priority,
  dueDate: s(r.due_date), plannedDate: s(r.planned_date), estimateMin: Number(r.estimate_min), labels: JSON.parse(String(r.labels || "[]")),
  doneWhen: json<string[]>(r.done_when, []), reminder: s(r.reminder), agent: s(r.agent) as Doer | null, runIn: s(r.run_in) as Surface | null,
  deviceId: s(r.device_id), folder: s(r.folder), sortOrder: Number(r.sort_order), flowX: n(r.flow_x), flowY: n(r.flow_y),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), completedAt: s(r.completed_at), subtasks: subs,
});

export function listTasks(where = "1 = 1", ...params: (string | number | null)[]): Task[] {
  const rows = db().prepare(`SELECT * FROM tasks WHERE ${where} ORDER BY sort_order, id`).all(...params) as Row[];
  const subs = subtasksFor(rows.map((r) => Number(r.id)));
  return rows.map((r) => toTask(r, subs.get(Number(r.id)) ?? []));
}

export function getTask(idOrKey: number | string): Task | null {
  const byKey = typeof idOrKey === "string" && !/^\d+$/.test(idOrKey);
  const r = db()
    .prepare(byKey ? "SELECT * FROM tasks WHERE key = ? COLLATE NOCASE" : "SELECT * FROM tasks WHERE id = ?")
    .get(byKey ? idOrKey : Number(idOrKey)) as Row | undefined;
  if (!r) return null;
  return toTask(r, subtasksFor([Number(r.id)]).get(Number(r.id)) ?? []);
}

export function nextKey(areaId: string | null): string {
  const prefix = areaId ? String((db().prepare("SELECT key FROM areas WHERE id = ?").get(areaId) as Row | undefined)?.key ?? "TSK") : "INB";
  const rows = db().prepare("SELECT key FROM tasks WHERE key LIKE ?").all(`${prefix}-%`) as Row[];
  const max = rows.reduce((m, r) => Math.max(m, Number(String(r.key).split("-")[1]) || 0), 0);
  return `${prefix}-${max + 1}`;
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

/** "Done when" items without blanks or repeats. */
export const cleanDoneWhen = (items: string[]) =>
  [...new Set(items.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean))];

export function createTask(input: TaskInput): Task {
  const project = input.projectId ? getProject(input.projectId) : null;
  const areaId = input.areaId ?? project?.areaId ?? null;
  const key = nextKey(areaId);
  const stamp = nowStamp();
  const sort = Number((db().prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tasks WHERE project_id IS ?").get(input.projectId ?? null) as Row).n);
  const r = db().prepare(
    `INSERT INTO tasks (key, area_id, project_id, title, description, status, priority, due_date, planned_date, estimate_min,
       labels, done_when, agent, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    key, areaId, input.projectId ?? null, input.title.trim(), input.description ?? "", input.status ?? "todo", input.priority ?? 0,
    input.dueDate ?? null, input.plannedDate ?? null, input.estimateMin ?? 60, JSON.stringify(input.labels ?? []),
    JSON.stringify(cleanDoneWhen(input.doneWhen ?? [])), input.agent ?? project?.agent ?? null, sort, stamp, stamp,
  );
  return getTask(Number(r.lastInsertRowid))!;
}

const TASK_COLS: Record<string, string> = {
  areaId: "area_id", projectId: "project_id", title: "title", description: "description", status: "status", priority: "priority",
  dueDate: "due_date", plannedDate: "planned_date", estimateMin: "estimate_min", labels: "labels", doneWhen: "done_when",
  reminder: "reminder", agent: "agent", runIn: "run_in", deviceId: "device_id", folder: "folder", sortOrder: "sort_order",
  flowX: "flow_x", flowY: "flow_y",
};

export type TaskPatch = Partial<TaskInput & {
  reminder: string | null; sortOrder: number; flowX: number | null; flowY: number | null;
  runIn: Surface | null; deviceId: string | null; folder: string | null;
}>;

export function updateTask(id: number, patch: TaskPatch) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in TASK_COLS) || v === undefined) continue;
    sets.push(`${TASK_COLS[k]} = ?`);
    vals.push(k === "labels" ? JSON.stringify(v) : k === "doneWhen" ? JSON.stringify(cleanDoneWhen(v as string[])) : (v as string | number | null));
  }
  if (patch.status) {
    sets.push("completed_at = ?");
    vals.push(patch.status === "done" ? nowStamp() : null);
  }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  vals.push(nowStamp());
  db().prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

/** Deletes a task with its sub-tasks, sessions, reports and images. */
export function deleteTask(id: number) {
  const files = (db().prepare("SELECT file FROM attachments WHERE task_id = ?").all(id) as Row[]).map((r) => String(r.file));
  db().prepare("DELETE FROM tasks WHERE id = ?").run(id);
  removeImageFiles(files);
}

export function addSubtask(taskId: number, title: string) {
  const sort = Number((db().prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM subtasks WHERE task_id = ?").get(taskId) as Row).n);
  db().prepare("INSERT INTO subtasks (task_id, title, sort) VALUES (?, ?, ?)").run(taskId, title.trim(), sort);
}

export function setSubtaskDone(id: number, done: boolean) {
  db().prepare("UPDATE subtasks SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
}

export function deleteSubtask(id: number) {
  db().prepare("DELETE FROM subtasks WHERE id = ?").run(id);
}

/* ---------- calendar events ---------- */

const toEvent = (r: Row): CalEvent => ({
  id: Number(r.id), title: String(r.title), areaId: s(r.area_id), start: String(r.start_at), end: String(r.end_at),
  recurrence: s(r.recurrence) as CalEvent["recurrence"],
});

export function listEvents(): CalEvent[] {
  return (db().prepare("SELECT * FROM events ORDER BY start_at").all() as Row[]).map(toEvent);
}

export function createEvent(input: { title: string; areaId?: string | null; start: string; end: string; recurrence?: "weekly" | null }) {
  const r = db().prepare("INSERT INTO events (title, area_id, start_at, end_at, recurrence) VALUES (?, ?, ?, ?, ?)")
    .run(input.title.trim(), input.areaId ?? null, input.start, input.end, input.recurrence ?? null);
  return Number(r.lastInsertRowid);
}

export function getEvent(id: number): CalEvent | null {
  const r = db().prepare("SELECT * FROM events WHERE id = ?").get(id) as Row | undefined;
  return r ? toEvent(r) : null;
}

export function updateEvent(id: number, patch: Partial<Omit<CalEvent, "id">>) {
  const cols: Record<string, string> = { title: "title", areaId: "area_id", start: "start_at", end: "end_at", recurrence: "recurrence" };
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in cols) || v === undefined) continue;
    sets.push(`${cols[k]} = ?`);
    vals.push(typeof v === "string" && k === "title" ? v.trim() : (v as string | null));
  }
  if (sets.length) db().prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function deleteEvent(id: number) {
  db().prepare("DELETE FROM events WHERE id = ?").run(id);
}

/** Expands events (including weekly ones) into occurrences between from and to (inclusive dates). */
export function occurrences(from: string, to: string): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  const start = parseLocal(from);
  const end = parseLocal(to);
  for (const e of listEvents()) {
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

const stampMin = (d: Date) => `${toDateStr(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/* ---------- sessions ---------- */

const toSession = (r: Row): Session => ({
  id: String(r.id), taskId: Number(r.task_id), agent: String(r.agent) as AgentId, surface: (s(r.surface) ?? "terminal") as Surface,
  deviceId: s(r.device_id), folder: s(r.folder), branch: s(r.branch), url: s(r.url),
  status: String(r.status) as SessionStatus, startedAt: String(r.started_at), finishedAt: s(r.finished_at), endedAt: s(r.ended_at),
  note: s(r.note), cliSessionId: s(r.cli_session_id), continuesSessionId: s(r.continues_session_id),
});

export function listSessions(where = "1 = 1", ...params: (string | number | null)[]): Session[] {
  return (db().prepare(`SELECT * FROM sessions WHERE ${where} ORDER BY started_at DESC`).all(...params) as Row[]).map(toSession);
}

export function getSession(id: string): Session | null {
  const r = db().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Row | undefined;
  return r ? toSession(r) : null;
}

/** The newest session for a task, if any. */
export function latestSession(taskId: number): Session | null {
  const r = db().prepare("SELECT * FROM sessions WHERE task_id = ? ORDER BY started_at DESC LIMIT 1").get(taskId) as Row | undefined;
  return r ? toSession(r) : null;
}

export function createSession(input: {
  taskId: number; agent: AgentId; folder: string | null; branch?: string | null; status?: SessionStatus;
  surface?: Surface; deviceId?: string | null; cliSessionId?: string | null; continuesSessionId?: string | null;
}): Session {
  const id = crypto.randomBytes(4).toString("hex");
  db().prepare(
    `INSERT INTO sessions (id, task_id, agent, surface, device_id, folder, branch, status, started_at, cli_session_id, continues_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.taskId, input.agent, input.surface ?? "terminal", input.deviceId ?? null, input.folder, input.branch ?? null,
    input.status ?? "starting", nowStamp(), input.cliSessionId ?? null, input.continuesSessionId ?? null);
  return getSession(id)!;
}

export function updateSession(
  id: string, patch: Partial<Pick<Session, "status" | "finishedAt" | "endedAt" | "note" | "branch" | "cliSessionId" | "url">>,
) {
  const cols: Record<string, string> = {
    status: "status", finishedAt: "finished_at", endedAt: "ended_at", note: "note", branch: "branch", cliSessionId: "cli_session_id", url: "url",
  };
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in cols) || v === undefined) continue;
    sets.push(`${cols[k]} = ?`);
    vals.push(v as string | null);
  }
  if (sets.length) db().prepare(`UPDATE sessions SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}

export function addSessionEvent(sessionId: string, kind: string, text = "") {
  db().prepare("INSERT INTO session_events (session_id, at, kind, text) VALUES (?, ?, ?, ?)").run(sessionId, nowStamp(), kind, text);
}

export function sessionEvents(sessionId: string): SessionEvent[] {
  return (db().prepare("SELECT * FROM session_events WHERE session_id = ? ORDER BY at, id").all(sessionId) as Row[]).map((r) => ({
    id: Number(r.id), sessionId: String(r.session_id), at: String(r.at), kind: String(r.kind), text: String(r.text),
  }));
}

/* ---------- reports (what agents hand back) and their images ---------- */

const toAttachment = (r: Row): Attachment => ({
  id: String(r.id), taskId: Number(r.task_id), sessionId: s(r.session_id), reportId: n(r.report_id), mime: String(r.mime),
  bytes: Number(r.bytes), width: n(r.width), height: n(r.height), caption: String(r.caption ?? ""), createdAt: String(r.created_at),
});

export function listAttachments(where = "1 = 1", ...params: (string | number | null)[]): Attachment[] {
  return (db().prepare(`SELECT * FROM attachments WHERE ${where} ORDER BY created_at, rowid`).all(...params) as Row[]).map(toAttachment);
}

/** Where an attachment's copy is stored and its type, for serving it. */
export function attachmentFile(id: string): { file: string; mime: string } | null {
  const r = db().prepare("SELECT file, mime FROM attachments WHERE id = ?").get(id) as Row | undefined;
  return r ? { file: String(r.file), mime: String(r.mime) } : null;
}

export function addAttachment(img: StoredImage, to: { taskId: number; sessionId: string | null; reportId?: number | null; caption?: string }): Attachment {
  db().prepare(
    `INSERT INTO attachments (id, task_id, session_id, report_id, file, mime, bytes, width, height, caption, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(img.id, to.taskId, to.sessionId, to.reportId ?? null, img.file, img.mime, img.bytes, img.width, img.height,
    (to.caption ?? "").trim(), nowStamp());
  return listAttachments("id = ?", img.id)[0];
}

/** Images a session attached while it worked, not yet part of a report, per session id. */
export function pendingImages(sessionIds: string[]): Map<string, Attachment[]> {
  const map = new Map<string, Attachment[]>();
  if (!sessionIds.length) return map;
  for (const a of listAttachments(`report_id IS NULL AND session_id IN (${marks(sessionIds)})`, ...sessionIds)) {
    map.set(a.sessionId!, [...(map.get(a.sessionId!) ?? []), a]);
  }
  return map;
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

/** Records a hand-back. Images the session attached while it worked become part of it. */
export function createReport(input: ReportInput): number {
  const r = db().prepare(
    `INSERT INTO reports (session_id, task_id, outcome, summary, details, criteria, verify, questions, links, follow_ups, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.sessionId, input.taskId, input.outcome, input.summary.trim(), (input.details ?? "").trim(), JSON.stringify(input.criteria ?? []),
    JSON.stringify(input.verify ?? []), JSON.stringify(input.questions ?? []), JSON.stringify(input.links ?? []),
    JSON.stringify(input.followUps ?? []), input.createdAt ?? nowStamp(),
  );
  const id = Number(r.lastInsertRowid);
  db().prepare("UPDATE attachments SET report_id = ? WHERE session_id = ? AND report_id IS NULL").run(id, input.sessionId);
  return id;
}

/** Report rows with their images, agent and follow-up tasks filled in, in the order given. */
function toReports(rows: Row[]): Report[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const images = listAttachments(`report_id IN (${marks(ids)})`, ...ids);
  const keys = [...new Set(rows.flatMap((r) => json<string[]>(r.follow_ups, [])))];
  const tasks = new Map(
    keys.length
      ? (db().prepare(`SELECT key, title, project_id, area_id FROM tasks WHERE key IN (${marks(keys)})`).all(...keys) as Row[])
        .map((t) => [String(t.key), { title: String(t.title), href: taskHref({ key: String(t.key), projectId: s(t.project_id), areaId: s(t.area_id) }) }])
      : [],
  );
  return rows.map((r) => ({
    id: Number(r.id), sessionId: String(r.session_id), taskId: Number(r.task_id), agent: String(r.agent) as AgentId,
    outcome: String(r.outcome) as ReportOutcome, summary: String(r.summary), details: String(r.details ?? ""),
    criteria: json<ReportCriterion[]>(r.criteria, []), verify: json<string[]>(r.verify, []), questions: json<string[]>(r.questions, []),
    links: json<{ label: string; url: string }[]>(r.links, []),
    followUps: json<string[]>(r.follow_ups, []).map((key) => ({ key, title: tasks.get(key)?.title ?? null, href: tasks.get(key)?.href ?? null })),
    createdAt: String(r.created_at),
    images: images.filter((a) => a.reportId === Number(r.id)),
    changes: s(r.changes),
    changesAt: s(r.changes_at),
  }));
}

/** What the user asked to change after reading a report; null takes the request back. */
export function setReportChanges(reportId: number, changes: string | null, at: string | null) {
  db().prepare("UPDATE reports SET changes = ?, changes_at = ? WHERE id = ?").run(changes, at, reportId);
}

/** Takes back a report that turned out not to be needed. The images it took wait for the next one again. */
export function deleteReport(reportId: number) {
  db().prepare("UPDATE attachments SET report_id = NULL WHERE report_id = ?").run(reportId);
  db().prepare("DELETE FROM reports WHERE id = ?").run(reportId);
}

const REPORTS = "SELECT reports.*, sessions.agent AS agent FROM reports JOIN sessions ON sessions.id = reports.session_id";

/** Each task's latest reports (at most `perTask`), newest first. */
export function reportsForTasks(taskIds: number[], perTask = 5): Map<number, Report[]> {
  const map = new Map<number, Report[]>();
  if (!taskIds.length) return map;
  const rows = db().prepare(
    `SELECT * FROM (SELECT r.*, ROW_NUMBER() OVER (PARTITION BY r.task_id ORDER BY r.id DESC) AS nth FROM (${REPORTS}) r
     WHERE r.task_id IN (${marks(taskIds)})) WHERE nth <= ? ORDER BY id DESC`,
  ).all(...taskIds, perTask) as Row[];
  for (const rep of toReports(rows)) map.set(rep.taskId, [...(map.get(rep.taskId) ?? []), rep]);
  return map;
}

/** Each session's reports, newest first. */
export function reportsForSessions(sessionIds: string[]): Map<string, Report[]> {
  const map = new Map<string, Report[]>();
  if (!sessionIds.length) return map;
  const rows = db().prepare(`${REPORTS} WHERE reports.session_id IN (${marks(sessionIds)}) ORDER BY reports.id DESC`).all(...sessionIds) as Row[];
  for (const rep of toReports(rows)) map.set(rep.sessionId, [...(map.get(rep.sessionId) ?? []), rep]);
  return map;
}

export function latestReport(taskId: number): Report | null {
  return toReports(db().prepare(`${REPORTS} WHERE reports.task_id = ? ORDER BY reports.id DESC LIMIT 1`).all(taskId) as Row[])[0] ?? null;
}

export function latestSessionReport(sessionId: string): Report | null {
  return reportsForSessions([sessionId]).get(sessionId)?.[0] ?? null;
}

/**
 * Tasks whose latest hand-back was partial or blocked, with that outcome. Flows don't go on after them until the user
 * marks them done. The report has to come from the task's latest session: a later session that was marked finished,
 * or finished in the cloud, brings no report of its own, and moves the task on.
 */
export function heldOutcomes(): Map<number, Exclude<ReportOutcome, "done">> {
  const rows = db().prepare(
    `SELECT r.task_id, r.outcome FROM reports r
     WHERE r.id IN (SELECT MAX(id) FROM reports GROUP BY task_id) AND r.outcome != 'done'
       AND r.session_id = (SELECT s.id FROM sessions s WHERE s.task_id = r.task_id ORDER BY s.started_at DESC LIMIT 1)`,
  ).all() as Row[];
  return new Map(rows.map((r) => [Number(r.task_id), String(r.outcome) as Exclude<ReportOutcome, "done">]));
}

export function heldTaskIds(): Set<number> {
  return new Set(heldOutcomes().keys());
}

/* ---------- flow edges ---------- */

const toEdge = (r: Row): FlowEdge => ({
  id: Number(r.id), fromTaskId: Number(r.from_task_id), toTaskId: Number(r.to_task_id), mode: String(r.mode) as EdgeMode, atTime: s(r.at_time),
});

export function listEdges(): FlowEdge[] {
  return (db().prepare("SELECT * FROM edges ORDER BY id").all() as Row[]).map(toEdge);
}

export function createEdge(fromTaskId: number, toTaskId: number, mode: EdgeMode = "auto"): FlowEdge | null {
  if (fromTaskId === toTaskId) return null;
  db().prepare("INSERT OR IGNORE INTO edges (from_task_id, to_task_id, mode) VALUES (?, ?, ?)").run(fromTaskId, toTaskId, mode);
  const r = db().prepare("SELECT * FROM edges WHERE from_task_id = ? AND to_task_id = ?").get(fromTaskId, toTaskId) as Row | undefined;
  return r ? toEdge(r) : null;
}

export function updateEdge(id: number, patch: { mode?: EdgeMode; atTime?: string | null }) {
  if (patch.mode) db().prepare("UPDATE edges SET mode = ? WHERE id = ?").run(patch.mode, id);
  if (patch.atTime !== undefined) db().prepare("UPDATE edges SET at_time = ? WHERE id = ?").run(patch.atTime, id);
}

export function deleteEdge(id: number) {
  db().prepare("DELETE FROM edges WHERE id = ?").run(id);
}

/** Sets the start mode of every connection that leads into a task. */
export function setIncomingMode(toTaskId: number, mode: EdgeMode, atTime: string | null = null) {
  db().prepare("UPDATE edges SET mode = ?, at_time = ? WHERE to_task_id = ?").run(mode, mode === "time" ? atTime : null, toTaskId);
}

/* ---------- devices ---------- */

const NO_TOOLS: AgentTools = { cli: null, app: null, mcp: "missing" };

const toDevice = (r: Row): Device => {
  const agents = JSON.parse(String(r.agents || "{}")) as Partial<Device["agents"]>;
  return {
    id: String(r.id), name: String(r.name), platform: String(r.platform),
    agents: { claude: agents.claude ?? NO_TOOLS, codex: agents.codex ?? NO_TOOLS },
    seenAt: String(r.seen_at), checkedAt: s(r.checked_at),
  };
};

/** Computers where PacedMind is installed, the most recently seen first. */
export function listDevices(): Device[] {
  return (db().prepare("SELECT * FROM devices ORDER BY seen_at DESC").all() as Row[]).map(toDevice);
}

export function getDevice(id: string): Device | null {
  const r = db().prepare("SELECT * FROM devices WHERE id = ?").get(id) as Row | undefined;
  return r ? toDevice(r) : null;
}

/** Records a device checking in; `agents` and `checkedAt` only when it looked for the agents again. */
export function saveDevice(d: { id: string; name: string; platform: string; agents?: Device["agents"]; checkedAt?: string }) {
  const at = nowStamp();
  db().prepare(
    `INSERT INTO devices (id, name, platform, agents, seen_at, checked_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, platform = excluded.platform, seen_at = excluded.seen_at,
       agents = CASE WHEN ? THEN excluded.agents ELSE devices.agents END,
       checked_at = COALESCE(excluded.checked_at, devices.checked_at)`,
  ).run(d.id, d.name, d.platform, JSON.stringify(d.agents ?? {}), at, d.checkedAt ?? null, d.agents ? 1 : 0);
}

/* ---------- settings ---------- */

export const DEFAULT_SETTINGS: Omit<Settings, "mcpToken"> = {
  workStart: "09:00", workEnd: "17:00", lunchStart: "12:30", lunchEnd: "13:30", workDays: [1, 2, 3, 4, 5],
  terminal: "wt", claudeCommand: "claude", codexCommand: "codex", port: 4319, importOffered: false,
};

export function getSettings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as Row[];
  const stored = Object.fromEntries(rows.map((r) => [String(r.key), JSON.parse(String(r.value))]));
  return { ...DEFAULT_SETTINGS, mcpToken: "", ...stored } as Settings;
}

export function setSettings(patch: Partial<Settings>) {
  tx(() => {
    const stmt = db().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) stmt.run(k, JSON.stringify(v));
  });
}
