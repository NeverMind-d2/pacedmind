import "server-only";
import crypto from "node:crypto";
import { addDays } from "date-fns";
import type { PostgrestError } from "@supabase/supabase-js";
import { MODE, NotSignedIn, authState, supabase } from "./supabase";
import { confirmedFlow, flowArmed, forgetProject, projectFolder, reconfirmFlow, setFlowArmed, setProjectFolder } from "./device";
import { nowStamp, parseLocal, toDateStr } from "@/lib/dates";
import type {
  AgentId, Area, CalEvent, Device, Doer, EdgeMode, EventOccurrence, FlowEdge, LaunchRequest, LaunchRequestStatus, Priority,
  Project, RemoteStart, Session, SessionEvent, SessionStatus, Settings, Status, Subtask, Task,
} from "@/lib/types";

/*
 * Every query runs as the signed-in account, and row level security limits it to that account's rows, so
 * nothing here filters by user. New rows get their user_id from the database.
 *
 * A project's folder and flow switch are this computer's (device.ts), merged in here so the rest of the app
 * sees one Project. The hosted web app has neither.
 */

type Row = Record<string, unknown>;

/**
 * The client for the account's data. In the desktop app, only once the account signed in with its second
 * factor: the database would refuse anyway (it answers no one else), but this says so plainly, e.g. to a
 * page that renders alongside a layout that is already sending you to sign in. (The web app's proxy stops
 * signed-out browsers before any page runs.)
 */
async function accountDb() {
  if (MODE === "desktop") {
    const state = await authState();
    if (!state || state.aal !== "aal2") throw new NotSignedIn();
  }
  return supabase();
}
type Result<T> = { data: T | null; error: PostgrestError | null };
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));

function many(res: Result<Row[]>): Row[] {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

function one(res: Result<Row>): Row | null {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function check(res: { error: PostgrestError | null }) {
  if (res.error) throw new Error(res.error.message);
}

/** Every row of a query, 1000 at a time (the most Supabase returns per request). */
async function all(page: (from: number, to: number) => PromiseLike<Result<Row[]>>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = many(await page(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** The defined fields of a patch, under their column names. */
function columns(patch: object, cols: Record<string, string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch)) if (k in cols && v !== undefined) out[cols[k]] = v;
  return out;
}

/** Area and project ids are UUIDs; anything else (an old link, a typo) can't match one. */
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/* ---------- areas and projects ---------- */

const toArea = (r: Row): Area => ({ id: String(r.id), name: String(r.name), key: String(r.key), color: String(r.color), sort: Number(r.sort) });

export async function listAreas(): Promise<Area[]> {
  const db = await accountDb();
  return many(await db.from("areas").select("*").order("sort")).map(toArea);
}

/** "Work" becomes WRK, "Health" HLT, "Dev" DEV; unique among the account's area keys. */
function deriveKey(name: string, taken: Set<string>): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  const consonants = letters.slice(1).replace(/[AEIOUY]/g, "");
  let base = letters.length <= 3 ? letters : letters[0] + consonants.slice(0, 2);
  if (base.length < 3) base = letters.slice(0, 3);
  if (base.length < 3) base = (base + "XXX").slice(0, 3);
  let key = base;
  for (let i = 2; taken.has(key); i++) key = `${base.slice(0, 2)}${i}`;
  return key;
}

export async function createArea(input: { name: string; color: string }): Promise<Area> {
  const db = await accountDb();
  const areas = await listAreas();
  const r = one(await db.from("areas").insert({
    name: input.name.trim(),
    key: deriveKey(input.name, new Set(areas.map((a) => a.key))),
    color: input.color,
    sort: areas.reduce((m, a) => Math.max(m, a.sort), 0) + 1,
  }).select().single());
  return toArea(r!);
}

export async function updateArea(id: string, patch: { name?: string; color?: string }) {
  const values: Row = {};
  if (patch.name?.trim()) values.name = patch.name.trim();
  if (patch.color) values.color = patch.color;
  if (!Object.keys(values).length || !isUuid(id)) return;
  const db = await accountDb();
  check(await db.from("areas").update(values).eq("id", id));
}

/** Deletes an area and its projects. Tasks are kept and move to the Inbox (the database's references do it). */
export async function deleteArea(id: string) {
  if (!isUuid(id)) return;
  const db = await accountDb();
  check(await db.from("areas").delete().eq("id", id));
}

/** Deletes a project. Its tasks stay in the project's area without a project. */
export async function deleteProject(id: string) {
  if (!isUuid(id)) return;
  const db = await accountDb();
  check(await db.from("projects").delete().eq("id", id));
  if (MODE === "desktop") forgetProject(id);
}

const toProject = (r: Row): Project => ({
  id: String(r.id), areaId: String(r.area_id), name: String(r.name), color: s(r.color), startDate: s(r.start_date), targetDate: s(r.target_date),
  folder: MODE === "desktop" ? projectFolder(String(r.id)) : null, agent: s(r.agent) as AgentId | null, afterProjectId: s(r.after_project_id),
  flowOn: MODE === "desktop" && flowArmed(String(r.id)), sort: Number(r.sort),
});

export async function listProjects(): Promise<Project[]> {
  const db = await accountDb();
  return many(await db.from("projects").select("*").order("sort")).map(toProject);
}

export async function getProject(id: string): Promise<Project | null> {
  if (!isUuid(id)) return null;
  const db = await accountDb();
  const r = one(await db.from("projects").select("*").eq("id", id).maybeSingle());
  return r ? toProject(r) : null;
}

/**
 * Creates a project. A folder only counts on this computer (the desktop app); callers check it with
 * folderProblem first, because the project exists by the time the folder is set.
 */
export async function createProject(input: {
  name: string; areaId: string; folder?: string | null; agent?: AgentId | null; targetDate?: string | null; color?: string | null;
}): Promise<Project> {
  const db = await accountDb();
  const last = many(await db.from("projects").select("sort").order("sort", { ascending: false }).limit(1));
  const r = one(await db.from("projects").insert({
    area_id: input.areaId, name: input.name.trim(), start_date: toDateStr(new Date()), target_date: input.targetDate ?? null,
    agent: input.agent ?? null, sort: Number(last[0]?.sort ?? 0) + 1, color: input.color ?? null,
  }).select().single());
  if (input.folder && MODE === "desktop") setProjectFolder(String(r!.id), input.folder);
  return toProject(r!);
}

const PROJECT_COLS: Record<string, string> = {
  areaId: "area_id", name: "name", color: "color", startDate: "start_date", targetDate: "target_date", agent: "agent",
  afterProjectId: "after_project_id", sort: "sort",
};

/**
 * Moving a project to another area moves its tasks too (a trigger in the database does it). `folder` and
 * `flowOn` are this computer's settings: only the desktop app's own window may change them (the actions and
 * MCP tools refuse them otherwise), and a new folder switches the flow off until you switch it on again.
 */
export async function updateProject(id: string, patch: Partial<Omit<Project, "id">>) {
  if (!isUuid(id)) return;
  if (patch.folder !== undefined || patch.flowOn !== undefined) {
    if (MODE !== "desktop") throw new Error("Folders and flows are set in the PacedMind desktop app.");
    if (patch.folder !== undefined) {
      const problem = setProjectFolder(id, patch.folder);
      if (problem) throw new Error(`Can't use the folder ${patch.folder}: ${problem}`);
    }
    // Switching a flow on confirms its connections as they are now (see device.ts, `confirmed`).
    if (patch.flowOn !== undefined) setFlowArmed(id, patch.flowOn, patch.flowOn ? await flowSnapshot(id) : undefined);
  }
  const values = columns(patch, PROJECT_COLS);
  if (!Object.keys(values).length) return;
  const db = await accountDb();
  check(await db.from("projects").update(values).eq("id", id));
}

/* ---------- tasks ---------- */

const toSubtask = (r: Row): Subtask => ({ id: Number(r.id), taskId: Number(r.task_id), title: String(r.title), done: r.done === true, sort: Number(r.sort) });

const toTask = (r: Row): Task => ({
  id: Number(r.id), key: String(r.key), areaId: s(r.area_id), projectId: s(r.project_id), title: String(r.title),
  description: String(r.description ?? ""), status: String(r.status) as Status, priority: Number(r.priority) as Priority,
  dueDate: s(r.due_date), plannedDate: s(r.planned_date), estimateMin: Number(r.estimate_min), labels: (r.labels as string[] | null) ?? [],
  reminder: s(r.reminder), agent: s(r.agent) as Doer | null, sortOrder: Number(r.sort_order), flowX: n(r.flow_x), flowY: n(r.flow_y),
  createdAt: String(r.created_at), updatedAt: String(r.updated_at), completedAt: s(r.completed_at),
  subtasks: ((r.subtasks as Row[] | undefined) ?? []).map(toSubtask).sort((a, b) => a.sort - b.sort || a.id - b.id),
});

const TASK_SELECT = "*, subtasks(*)";

export interface TaskFilter {
  /** An area's tasks, or with null the tasks without an area. */
  areaId?: string | null;
  /** A project's tasks, or with null the tasks without a project. */
  projectId?: string | null;
}

export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  if ((filter.areaId && !isUuid(filter.areaId)) || (filter.projectId && !isUuid(filter.projectId))) return [];
  const db = await accountDb();
  const rows = await all((from, to) => {
    let q = db.from("tasks").select(TASK_SELECT);
    if (filter.areaId !== undefined) q = filter.areaId === null ? q.is("area_id", null) : q.eq("area_id", filter.areaId);
    if (filter.projectId !== undefined) q = filter.projectId === null ? q.is("project_id", null) : q.eq("project_id", filter.projectId);
    return q.order("sort_order").order("id").range(from, to);
  });
  return rows.map(toTask);
}

/** A task by id, or by key ("DEV-12", any case). */
export async function getTask(idOrKey: number | string): Promise<Task | null> {
  const db = await accountDb();
  const byKey = typeof idOrKey === "string" && !/^\d+$/.test(idOrKey);
  const q = db.from("tasks").select(TASK_SELECT);
  const r = one(await (byKey ? q.eq("key", String(idOrKey).toUpperCase()) : q.eq("id", Number(idOrKey))).maybeSingle());
  return r ? toTask(r) : null;
}

/** Every task's status, by id: what the desktop app compares to notice tasks finished elsewhere. */
export async function taskStatuses(): Promise<Map<number, Status>> {
  const db = await accountDb();
  const rows = await all((from, to) => db.from("tasks").select("id, status").order("id").range(from, to));
  return new Map(rows.map((r) => [Number(r.id), String(r.status) as Status]));
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
  agent?: Doer | null;
}

/** Creates a task at the end of its project (or of the loose tasks). The database gives it its key. */
export async function createTask(input: TaskInput): Promise<Task> {
  const db = await accountDb();
  const project = input.projectId ? await getProject(input.projectId) : null;
  const areaId = input.areaId ?? project?.areaId ?? null;
  const stamp = nowStamp();
  const lastQuery = db.from("tasks").select("sort_order");
  const last = many(await (input.projectId ? lastQuery.eq("project_id", input.projectId) : lastQuery.is("project_id", null))
    .order("sort_order", { ascending: false }).limit(1));
  const r = one(await db.from("tasks").insert({
    key: "", area_id: areaId, project_id: input.projectId ?? null, title: input.title.trim(), description: input.description ?? "",
    status: input.status ?? "todo", priority: input.priority ?? 0, due_date: input.dueDate ?? null, planned_date: input.plannedDate ?? null,
    estimate_min: input.estimateMin ?? 60, labels: input.labels ?? [], agent: input.agent ?? project?.agent ?? null,
    sort_order: Number(last[0]?.sort_order ?? 0) + 1, created_at: stamp, updated_at: stamp,
  }).select(TASK_SELECT).single());
  return toTask(r!);
}

const TASK_COLS: Record<string, string> = {
  areaId: "area_id", projectId: "project_id", title: "title", description: "description", status: "status", priority: "priority",
  dueDate: "due_date", plannedDate: "planned_date", estimateMin: "estimate_min", labels: "labels", reminder: "reminder",
  agent: "agent", sortOrder: "sort_order", flowX: "flow_x", flowY: "flow_y",
};

export async function updateTask(id: number, patch: Partial<TaskInput & { reminder: string | null; sortOrder: number; flowX: number | null; flowY: number | null }>) {
  const values = columns(patch, TASK_COLS);
  if (patch.status) values.completed_at = patch.status === "done" ? nowStamp() : null;
  if (!Object.keys(values).length) return;
  values.updated_at = nowStamp();
  const db = await accountDb();
  check(await db.from("tasks").update(values).eq("id", id));
}

export async function deleteTask(id: number) {
  const db = await accountDb();
  check(await db.from("tasks").delete().eq("id", id));
}

export async function addSubtask(taskId: number, title: string) {
  const db = await accountDb();
  const last = many(await db.from("subtasks").select("sort").eq("task_id", taskId).order("sort", { ascending: false }).limit(1));
  check(await db.from("subtasks").insert({ task_id: taskId, title: title.trim(), sort: Number(last[0]?.sort ?? 0) + 1 }));
}

export async function setSubtaskDone(id: number, done: boolean) {
  const db = await accountDb();
  check(await db.from("subtasks").update({ done }).eq("id", id));
}

export async function deleteSubtask(id: number) {
  const db = await accountDb();
  check(await db.from("subtasks").delete().eq("id", id));
}

/* ---------- calendar events ---------- */

const toEvent = (r: Row): CalEvent => ({
  id: Number(r.id), title: String(r.title), areaId: s(r.area_id), start: String(r.start_at), end: String(r.end_at),
  recurrence: s(r.recurrence) as CalEvent["recurrence"],
});

export async function listEvents(): Promise<CalEvent[]> {
  const db = await accountDb();
  return (await all((from, to) => db.from("events").select("*").order("start_at").order("id").range(from, to))).map(toEvent);
}

export async function createEvent(input: { title: string; areaId?: string | null; start: string; end: string; recurrence?: "weekly" | null }): Promise<number> {
  const db = await accountDb();
  const r = one(await db.from("events").insert({
    title: input.title.trim(), area_id: input.areaId ?? null, start_at: input.start, end_at: input.end, recurrence: input.recurrence ?? null,
  }).select("id").single());
  return Number(r!.id);
}

export async function getEvent(id: number): Promise<CalEvent | null> {
  const db = await accountDb();
  const r = one(await db.from("events").select("*").eq("id", id).maybeSingle());
  return r ? toEvent(r) : null;
}

export async function updateEvent(id: number, patch: Partial<Omit<CalEvent, "id">>) {
  const values = columns(patch, { title: "title", areaId: "area_id", start: "start_at", end: "end_at", recurrence: "recurrence" });
  if (typeof values.title === "string") values.title = values.title.trim();
  if (!Object.keys(values).length) return;
  const db = await accountDb();
  check(await db.from("events").update(values).eq("id", id));
}

export async function deleteEvent(id: number) {
  const db = await accountDb();
  check(await db.from("events").delete().eq("id", id));
}

/** Expands events (including weekly ones) into occurrences between from and to (inclusive dates). */
export async function occurrences(from: string, to: string): Promise<EventOccurrence[]> {
  const out: EventOccurrence[] = [];
  const start = parseLocal(from);
  const end = parseLocal(to);
  for (const e of await listEvents()) {
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
  id: String(r.id), taskId: Number(r.task_id), agent: String(r.agent) as AgentId, deviceId: s(r.device_id), folder: s(r.folder), branch: s(r.branch),
  status: String(r.status) as SessionStatus, startedAt: String(r.started_at), finishedAt: s(r.finished_at), endedAt: s(r.ended_at),
  note: s(r.note), cliSessionId: s(r.cli_session_id), continuesSessionId: s(r.continues_session_id),
});

export interface SessionFilter {
  taskId?: number;
  status?: SessionStatus[];
  continuesSessionId?: string;
}

/** Sessions, newest first. */
export async function listSessions(filter: SessionFilter = {}): Promise<Session[]> {
  const db = await accountDb();
  const rows = await all((from, to) => {
    let q = db.from("sessions").select("*");
    if (filter.taskId !== undefined) q = q.eq("task_id", filter.taskId);
    if (filter.status) q = q.in("status", filter.status);
    if (filter.continuesSessionId) q = q.eq("continues_session_id", filter.continuesSessionId);
    return q.order("started_at", { ascending: false }).order("id").range(from, to);
  });
  return rows.map(toSession);
}

export async function getSession(id: string): Promise<Session | null> {
  const db = await accountDb();
  const r = one(await db.from("sessions").select("*").eq("id", id).maybeSingle());
  return r ? toSession(r) : null;
}

/** The newest session for a task, if any. */
export async function latestSession(taskId: number): Promise<Session | null> {
  const db = await accountDb();
  const r = one(await db.from("sessions").select("*").eq("task_id", taskId).order("started_at", { ascending: false }).limit(1).maybeSingle());
  return r ? toSession(r) : null;
}

export async function createSession(input: {
  taskId: number; agent: AgentId; folder: string | null; deviceId?: string | null; branch?: string | null; status?: SessionStatus;
  cliSessionId?: string | null; continuesSessionId?: string | null;
}): Promise<Session> {
  const db = await accountDb();
  const r = one(await db.from("sessions").insert({
    id: crypto.randomBytes(8).toString("hex"), task_id: input.taskId, agent: input.agent, device_id: input.deviceId ?? null,
    folder: input.folder, branch: input.branch ?? null, status: input.status ?? "starting", started_at: nowStamp(),
    cli_session_id: input.cliSessionId ?? null, continues_session_id: input.continuesSessionId ?? null,
  }).select().single());
  return toSession(r!);
}

export async function updateSession(id: string, patch: Partial<Pick<Session, "status" | "folder" | "finishedAt" | "endedAt" | "note" | "branch" | "cliSessionId">>) {
  const values = columns(patch, {
    status: "status", folder: "folder", finishedAt: "finished_at", endedAt: "ended_at", note: "note", branch: "branch", cliSessionId: "cli_session_id",
  });
  if (!Object.keys(values).length) return;
  const db = await accountDb();
  check(await db.from("sessions").update(values).eq("id", id));
}

export async function addSessionEvent(sessionId: string, kind: string, text = "") {
  const db = await accountDb();
  check(await db.from("session_events").insert({ session_id: sessionId, at: nowStamp(), kind, text }));
}

export async function sessionEvents(sessionId: string): Promise<SessionEvent[]> {
  const db = await accountDb();
  return many(await db.from("session_events").select("*").eq("session_id", sessionId).order("at").order("id")).map(toSessionEvent);
}

const toSessionEvent = (r: Row): SessionEvent => ({ id: Number(r.id), sessionId: String(r.session_id), at: String(r.at), kind: String(r.kind), text: String(r.text) });

/** The events of many sessions at once, by session id (every id gets a list). */
export async function sessionEventsFor(sessionIds: string[]): Promise<Record<string, SessionEvent[]>> {
  const out: Record<string, SessionEvent[]> = Object.fromEntries(sessionIds.map((id) => [id, []]));
  const db = await accountDb();
  // A few dozen ids per request keeps the URL short.
  for (let i = 0; i < sessionIds.length; i += 50) {
    const ids = sessionIds.slice(i, i + 50);
    for (const r of await all((from, to) => db.from("session_events").select("*").in("session_id", ids).order("at").order("id").range(from, to))) {
      out[String(r.session_id)]?.push(toSessionEvent(r));
    }
  }
  return out;
}

/** When each session was last marked done, by session id. */
export async function doneTimes(): Promise<Map<string, string>> {
  const db = await accountDb();
  const out = new Map<string, string>();
  for (const r of await all((from, to) => db.from("session_events").select("session_id, at").eq("kind", "done").order("id").range(from, to))) {
    const id = String(r.session_id);
    const at = String(r.at);
    if (!out.has(id) || at > out.get(id)!) out.set(id, at);
  }
  return out;
}

/* ---------- flow edges ---------- */

/** A connection as a flow confirms it: which task, after which, and how (the time too, for "at a set time"). */
export const edgeSignature = (e: { fromTaskId: number; toTaskId: number; mode: EdgeMode; atTime: string | null }) =>
  `${e.fromTaskId}>${e.toTaskId}:${e.mode}${e.mode === "time" ? `@${e.atTime ?? ""}` : ""}`;

/** A project's flow as it is now: its connections, and the project it starts after. */
export async function flowSnapshot(projectId: string): Promise<{ edges: string[]; after: string | null }> {
  const [tasks, edges, project] = await Promise.all([listTasks({ projectId }), listEdges(), getProject(projectId)]);
  const ids = new Set(tasks.map((t) => t.id));
  return {
    edges: edges.filter((e) => ids.has(e.fromTaskId) || ids.has(e.toTaskId)).map(edgeSignature),
    after: project?.afterProjectId ?? null,
  };
}

/**
 * After you changed a flow in this computer's window (only for a flow that's on): the connections into and
 * out of `tasks` count as confirmed as they are now, connections that are gone are forgotten, and with
 * `after` so does the project it starts after. Other connections keep their state: one an agent added
 * meanwhile stays unconfirmed. MCP tools and the web app never call this.
 */
export async function confirmFlowChange(projectId: string | null | undefined, change: { tasks?: number[]; after?: boolean }) {
  if (MODE !== "desktop" || !projectId || !flowArmed(projectId)) return;
  const was = confirmedFlow(projectId) ?? { edges: [], after: null };
  const now = await flowSnapshot(projectId);
  const touched = new Set(change.tasks ?? []);
  const ends = (sig: string) => sig.split(":")[0].split(">").map(Number);
  const edges = new Set(was.edges.filter((sig) => now.edges.includes(sig)));
  for (const sig of now.edges) if (ends(sig).some((id) => touched.has(id))) edges.add(sig);
  reconfirmFlow(projectId, { edges: [...edges], after: change.after ? now.after : was.after });
}

const toEdge = (r: Row): FlowEdge => ({
  id: Number(r.id), fromTaskId: Number(r.from_task_id), toTaskId: Number(r.to_task_id), mode: String(r.mode) as EdgeMode, atTime: s(r.at_time),
});

export async function listEdges(): Promise<FlowEdge[]> {
  const db = await accountDb();
  return (await all((from, to) => db.from("edges").select("*").order("id").range(from, to))).map(toEdge);
}

export async function createEdge(fromTaskId: number, toTaskId: number, mode: EdgeMode = "auto"): Promise<FlowEdge | null> {
  if (fromTaskId === toTaskId) return null;
  const db = await accountDb();
  check(await db.from("edges").upsert({ from_task_id: fromTaskId, to_task_id: toTaskId, mode }, { onConflict: "from_task_id,to_task_id", ignoreDuplicates: true }));
  const r = one(await db.from("edges").select("*").eq("from_task_id", fromTaskId).eq("to_task_id", toTaskId).maybeSingle());
  return r ? toEdge(r) : null;
}

export async function updateEdge(id: number, patch: { mode?: EdgeMode; atTime?: string | null }) {
  const values = columns(patch, { mode: "mode", atTime: "at_time" });
  if (!Object.keys(values).length) return;
  const db = await accountDb();
  check(await db.from("edges").update(values).eq("id", id));
}

export async function deleteEdge(id: number) {
  const db = await accountDb();
  check(await db.from("edges").delete().eq("id", id));
}

/** Deletes every connection into or out of a task. */
export async function deleteEdgesOf(taskId: number) {
  const db = await accountDb();
  check(await db.from("edges").delete().or(`from_task_id.eq.${taskId},to_task_id.eq.${taskId}`));
}

/** Sets the start mode of every connection that leads into a task. */
export async function setIncomingMode(toTaskId: number, mode: EdgeMode, atTime: string | null = null) {
  const db = await accountDb();
  check(await db.from("edges").update({ mode, at_time: mode === "time" ? atTime : null }).eq("to_task_id", toTaskId));
}

/* ---------- settings ---------- */

/** Planning settings that follow the account. How sessions start is this computer's (device.ts). */
export const DEFAULT_SETTINGS: Settings = {
  workStart: "09:00", workEnd: "17:00", lunchStart: "12:30", lunchEnd: "13:30", workDays: [1, 2, 3, 4, 5],
};
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export async function getSettings(): Promise<Settings> {
  const db = await accountDb();
  const stored = Object.fromEntries(many(await db.from("settings").select("key, value"))
    .filter((r) => SETTING_KEYS.includes(r.key as keyof Settings)).map((r) => [String(r.key), r.value]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function setSettings(patch: Partial<Settings>) {
  const rows = SETTING_KEYS.filter((k) => patch[k] !== undefined).map((key) => ({ key, value: patch[key] }));
  if (!rows.length) return;
  const db = await accountDb();
  check(await db.from("settings").upsert(rows, { onConflict: "user_id,key" }));
}

/* ---------- computers and requests to start sessions ---------- */

const DEVICE_COLS = "id, name, platform, remote_start, created_at, last_seen_at, revoked_at";

const toDevice = (r: Row): Device => ({
  id: String(r.id), name: String(r.name), platform: String(r.platform) as Device["platform"], remoteStart: String(r.remote_start) as RemoteStart,
  createdAt: String(r.created_at), lastSeenAt: s(r.last_seen_at), revokedAt: s(r.revoked_at),
});

/** The account's computers, signed-in ones first. */
export async function listDevices(): Promise<Device[]> {
  const db = await accountDb();
  return many(await db.from("devices").select(DEVICE_COLS).order("revoked_at", { ascending: false, nullsFirst: true }).order("created_at"))
    .map(toDevice);
}

export async function getDevice(id: string): Promise<Device | null> {
  if (!isUuid(id)) return null;
  const db = await accountDb();
  const r = one(await db.from("devices").select(DEVICE_COLS).eq("id", id).maybeSingle());
  return r ? toDevice(r) : null;
}

/** Adds this computer to the account's list, pointing at the current auth session (so revoking ends it). */
export async function registerDevice(name: string, platform: Device["platform"]): Promise<string> {
  const db = await accountDb();
  const { data, error } = await db.rpc("register_device", { device_name: name.slice(0, 80) || "Computer", device_platform: platform });
  if (error) throw new Error(error.message);
  return String(data);
}

/** Points this computer's entry at the current auth session, after signing in again. */
export async function claimDevice(id: string) {
  const db = await accountDb();
  const { error } = await db.rpc("claim_device", { device: id });
  if (error) throw new Error(error.message);
}

/** Signs a computer out: its session ends at once and its waiting requests are canceled. */
export async function revokeDevice(id: string) {
  if (!isUuid(id)) throw new Error("Unknown computer");
  const db = await accountDb();
  const { error } = await db.rpc("revoke_device", { device: id });
  if (error) throw new Error(error.message);
}

export async function updateDeviceRow(id: string, patch: { name?: string; remoteStart?: RemoteStart; lastSeen?: boolean }) {
  const values: Row = {};
  if (patch.name?.trim()) values.name = patch.name.trim().slice(0, 80);
  if (patch.remoteStart) values.remote_start = patch.remoteStart;
  if (patch.lastSeen) values.last_seen_at = new Date().toISOString();
  if (!Object.keys(values).length || !isUuid(id)) return;
  const db = await accountDb();
  check(await db.from("devices").update(values).eq("id", id));
}

const toRequest = (r: Row): LaunchRequest => ({
  id: String(r.id), deviceId: String(r.device_id), taskId: Number(r.task_id), agent: String(r.agent) as AgentId,
  requestedVia: String(r.requested_via), requestedAt: String(r.requested_at), expiresAt: String(r.expires_at),
  status: String(r.status) as LaunchRequestStatus, decidedAt: s(r.decided_at), sessionId: s(r.session_id), note: s(r.note),
});

export async function listLaunchRequests(filter: { deviceId?: string; status?: LaunchRequestStatus[]; taskId?: number } = {}): Promise<LaunchRequest[]> {
  const db = await accountDb();
  let q = db.from("launch_requests").select("*");
  if (filter.deviceId) q = q.eq("device_id", filter.deviceId);
  if (filter.status) q = q.in("status", filter.status);
  if (filter.taskId !== undefined) q = q.eq("task_id", filter.taskId);
  return many(await q.order("requested_at", { ascending: false }).limit(200)).map(toRequest);
}

/**
 * Asks a computer to start a session. The database only accepts it from a session whose second factor was
 * verified in the last five minutes, and sets its status and expiry itself.
 */
export async function createLaunchRequest(input: { deviceId: string; taskId: number; agent: AgentId; via: string }): Promise<LaunchRequest> {
  const db = await accountDb();
  const r = one(await db.from("launch_requests").insert({
    device_id: input.deviceId, task_id: input.taskId, agent: input.agent, requested_via: input.via,
  }).select().single());
  return toRequest(r!);
}

/** Records what the desktop app did with a request. Only a pending one changes. */
export async function settleLaunchRequest(
  id: string, status: Exclude<LaunchRequestStatus, "pending">, extra: { sessionId?: string | null; note?: string | null } = {},
) {
  const db = await accountDb();
  check(await db.from("launch_requests").update({
    status, decided_at: new Date().toISOString(), session_id: extra.sessionId ?? null, note: extra.note?.slice(0, 500) ?? null,
  }).eq("id", id).eq("status", "pending"));
}

/* ---------- live refresh ---------- */

/** A number that grows with every write to the account's rows. */
export async function stateVersion(): Promise<number> {
  const db = await accountDb();
  const r = one(await db.from("user_state").select("version").maybeSingle());
  return Number(r?.version ?? 0);
}
