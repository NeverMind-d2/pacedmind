import "server-only";
import crypto from "node:crypto";
import { addDays } from "date-fns";
import { db, tx } from "./db";
import { nowStamp, parseLocal, toDateStr } from "@/lib/dates";
import type {
  AgentId, Area, CalEvent, EdgeMode, EventOccurrence, FlowEdge, Priority, Project, Session, SessionEvent,
  SessionStatus, Settings, Status, Subtask, Task,
} from "@/lib/types";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));

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
  folder: s(r.folder), agent: s(r.agent) as AgentId | null, afterProjectId: s(r.after_project_id), flowOn: Number(r.flow_on) === 1,
  sort: Number(r.sort),
});

export function listProjects(): Project[] {
  return (db().prepare("SELECT * FROM projects ORDER BY sort").all() as Row[]).map(toProject);
}

export function getProject(id: string): Project | null {
  const r = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return r ? toProject(r) : null;
}

export function createProject(input: {
  name: string; areaId: string; folder?: string | null; agent?: AgentId | null; targetDate?: string | null; color?: string | null;
}): Project {
  const base = slug(input.name, "project");
  let id = base;
  for (let i = 2; getProject(id); i++) id = `${base}-${i}`;
  const sort = Number((db().prepare("SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM projects").get() as Row).n);
  db().prepare(
    `INSERT INTO projects (id, area_id, name, start_date, target_date, folder, agent, sort, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.areaId, input.name.trim(), toDateStr(new Date()), input.targetDate ?? null, input.folder ?? null, input.agent ?? null, sort, input.color ?? null);
  return getProject(id)!;
}

export function updateProject(id: string, patch: Partial<Omit<Project, "id">>) {
  const cols: Record<string, string> = {
    areaId: "area_id", name: "name", color: "color", startDate: "start_date", targetDate: "target_date", folder: "folder", agent: "agent",
    afterProjectId: "after_project_id", flowOn: "flow_on", sort: "sort",
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
  reminder: s(r.reminder), agent: s(r.agent) as AgentId | null, sortOrder: Number(r.sort_order), flowX: n(r.flow_x), flowY: n(r.flow_y),
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
  agent?: AgentId | null;
}

export function createTask(input: TaskInput): Task {
  const project = input.projectId ? getProject(input.projectId) : null;
  const areaId = input.areaId ?? project?.areaId ?? null;
  const key = nextKey(areaId);
  const stamp = nowStamp();
  const sort = Number((db().prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM tasks WHERE project_id IS ?").get(input.projectId ?? null) as Row).n);
  const r = db().prepare(
    `INSERT INTO tasks (key, area_id, project_id, title, description, status, priority, due_date, planned_date, estimate_min,
       labels, agent, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    key, areaId, input.projectId ?? null, input.title.trim(), input.description ?? "", input.status ?? "todo", input.priority ?? 0,
    input.dueDate ?? null, input.plannedDate ?? null, input.estimateMin ?? 60, JSON.stringify(input.labels ?? []),
    input.agent ?? project?.agent ?? null, sort, stamp, stamp,
  );
  return getTask(Number(r.lastInsertRowid))!;
}

const TASK_COLS: Record<string, string> = {
  areaId: "area_id", projectId: "project_id", title: "title", description: "description", status: "status", priority: "priority",
  dueDate: "due_date", plannedDate: "planned_date", estimateMin: "estimate_min", labels: "labels", reminder: "reminder",
  agent: "agent", sortOrder: "sort_order", flowX: "flow_x", flowY: "flow_y",
};

export function updateTask(id: number, patch: Partial<TaskInput & { reminder: string | null; sortOrder: number; flowX: number | null; flowY: number | null }>) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in TASK_COLS) || v === undefined) continue;
    sets.push(`${TASK_COLS[k]} = ?`);
    vals.push(k === "labels" ? JSON.stringify(v) : (v as string | number | null));
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

export function deleteTask(id: number) {
  db().prepare("DELETE FROM tasks WHERE id = ?").run(id);
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
  id: String(r.id), taskId: Number(r.task_id), agent: String(r.agent) as AgentId, folder: s(r.folder), branch: s(r.branch),
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
  cliSessionId?: string | null; continuesSessionId?: string | null;
}): Session {
  const id = crypto.randomBytes(4).toString("hex");
  db().prepare(
    `INSERT INTO sessions (id, task_id, agent, folder, branch, status, started_at, cli_session_id, continues_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.taskId, input.agent, input.folder, input.branch ?? null, input.status ?? "starting", nowStamp(),
    input.cliSessionId ?? null, input.continuesSessionId ?? null);
  return getSession(id)!;
}

export function updateSession(id: string, patch: Partial<Pick<Session, "status" | "finishedAt" | "endedAt" | "note" | "branch" | "cliSessionId">>) {
  const cols: Record<string, string> = { status: "status", finishedAt: "finished_at", endedAt: "ended_at", note: "note", branch: "branch", cliSessionId: "cli_session_id" };
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

/* ---------- settings ---------- */

export const DEFAULT_SETTINGS: Omit<Settings, "mcpToken"> = {
  workStart: "09:00", workEnd: "17:00", lunchStart: "12:30", lunchEnd: "13:30", workDays: [1, 2, 3, 4, 5],
  terminal: "wt", claudeCommand: "claude", codexCommand: "codex", port: 4319,
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
