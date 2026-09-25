import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { addDays, addMinutes } from "date-fns";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { requireAal2, supabase } from "./supabase";
import { removeImageFiles } from "./attachments";
import { commandProblem, deviceConfig, setFlowArmed, setProjectFolder, setTaskFolder, updateDevice } from "./device";
import { CODEX_ENV, cleanDoneWhen, flowSnapshot } from "./repo";
import { toDateStr, toStamp } from "@/lib/dates";

/* An account's data as a whole: starting over, sample data, and bringing over the data PacedMind kept on this computer before the cloud. */

type Row = Record<string, unknown>;

function check<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** The areas every account starts with. The database trigger for new accounts (supabase/migrations) makes the same ones. */
export const DEFAULT_AREAS = [
  { name: "Work", key: "WRK", color: "#7D93B5" },
  { name: "Personal", key: "PER", color: "#7FA894" },
  { name: "Health", key: "HLT", color: "#B08A9B" },
  { name: "Learning", key: "LRN", color: "#9C93B8" },
  { name: "Dev", key: "DEV", color: "#7AA3AD" },
];

/** Deletes the account's areas, projects, tasks (with their sessions, reports and connections) and events. Settings stay. */
async function clearAccount(db: SupabaseClient) {
  const { id } = (await requireAal2()).user;
  // The images this computer keeps for the account's tasks go with them.
  const device = deviceConfig().deviceId;
  const files = device ? (check(await db.from("attachments").select("file").eq("device_id", device)) as Row[]).map((r) => String(r.file)) : [];
  // Deleting tasks takes their sub-tasks, sessions, reports, images and connections along; areas take their projects.
  for (const table of ["tasks", "events", "projects", "areas", "key_counters"]) {
    check(await db.from(table).delete().eq("user_id", id));
  }
  removeImageFiles(files);
  // So do this computer's folders and flow switches for them.
  updateDevice({ folders: {}, taskFolders: {}, armed: [], confirmed: {} });
}

/** Starts the account over with the default areas, and optionally the sample data. */
export async function resetAccount(mode: "sample" | "empty") {
  const db = await supabase();
  await clearAccount(db);
  const areas = check(await db.from("areas").insert(DEFAULT_AREAS.map((a, i) => ({ ...a, sort: i }))).select("id, key")) as Row[];
  if (mode === "sample") await seedSample(db, new Map(areas.map((a) => [String(a.key), String(a.id)])));
}

/* ---------- sample data ---------- */

async function seedSample(db: SupabaseClient, areaId: Map<string, string>) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const D = (offset: number, time?: string) => toDateStr(addDays(today, offset)) + (time ? `T${time}` : "");
  const stamp = toStamp(now);
  const ago = (min: number) => toStamp(addMinutes(now, -min));

  // No folders: sample sessions run in scratch folders, and folders belong to each computer anyway.
  const projectRows: [string, string, number, number, string | null][] = [
    ["Organizer app", "DEV", -3, 22, "claude"],
    ["ChessV2", "DEV", 25, 50, "codex"],
    ["Portfolio site", "DEV", 4, 43, "codex"],
    ["Q4 planning", "WRK", -10, 7, null],
    ["Apartment move", "PER", -3, 21, null],
    ["Half marathon", "HLT", -40, 45, null],
    ["Spanish B1", "LRN", -30, 79, null],
  ];
  const projects = check(await db.from("projects").insert(projectRows.map(([name, area, s, t, agent], i) => ({
    name, area_id: areaId.get(area), start_date: D(s), target_date: D(t), agent, sort: i,
  }))).select("id, name")) as Row[];
  const project = new Map(projects.map((p) => [String(p.name), String(p.id)]));
  check(await db.from("projects").update({ after_project_id: project.get("Organizer app") }).eq("id", project.get("ChessV2")!));

  type Seed = {
    key: string; area: string; project?: string; title: string; desc?: string; status?: string; pr?: number;
    due?: string; planned?: string; est?: number; labels?: string[]; agent?: string; sort?: number;
    fx?: number; fy?: number; subs?: [string, boolean][];
  };
  const tasks: Seed[] = [
    { key: "WRK-27", area: "WRK", project: "Q4 planning", title: "Review Q3 budget draft", status: "progress", pr: 3, due: D(-1), planned: D(-2), est: 90, labels: ["finance"],
      desc: "Check the travel and tooling lines against Q3 actuals before sending comments back.", subs: [["Travel line", true], ["Tooling line", false]] },
    { key: "WRK-31", area: "WRK", project: "Q4 planning", title: "Prepare slides for Q4 planning", status: "progress", pr: 1, due: D(0, "17:00"), planned: D(0), est: 180, labels: ["presentation"],
      desc: "Summarize Q3 results and propose three priorities for Q4. Keep it to ten slides.",
      subs: [["Collect Q3 numbers", true], ["Draft the outline", true], ["Build the charts", false], ["Rehearse once", false]] },
    { key: "WRK-33", area: "WRK", title: "Reply to design feedback", pr: 0, planned: D(0), est: 30, labels: ["email"],
      desc: "Short reply is fine. Agree on the spacing changes, push back on the new colors." },
    { key: "WRK-34", area: "WRK", title: "Send invoice to Acme", pr: 2, due: D(1, "10:00"), planned: D(1), est: 30, labels: ["finance"] },
    { key: "WRK-36", area: "WRK", project: "Q4 planning", title: "Send the Q4 plan to the team", pr: 2, due: D(7), est: 120 },
    { key: "PER-39", area: "PER", title: "Call insurance about the car claim", pr: 3, due: D(4), planned: D(0), est: 30, labels: ["car"],
      desc: "Have the claim number and the photos ready before calling." },
    { key: "PER-41", area: "PER", title: "Pay electricity bill", pr: 2, due: D(-2), planned: D(-2), est: 15, labels: ["bills"],
      desc: "The account number is on the last invoice in the Bills folder." },
    { key: "PER-42", area: "PER", title: "Renew car insurance", pr: 2, due: D(6), est: 30, labels: ["car"] },
    { key: "PER-44", area: "PER", project: "Apartment move", title: "Book movers for moving day", pr: 2, due: D(0), est: 60, labels: ["move"],
      desc: "Get two quotes first. A van and two people for the morning is enough.", subs: [["Ask for two quotes", false], ["Confirm the date", false]] },
    { key: "PER-45", area: "PER", project: "Apartment move", title: "Buy packing boxes", pr: 4, planned: D(2), est: 60 },
    { key: "PER-47", area: "PER", project: "Apartment move", title: "Pack the kitchen", pr: 3, planned: D(9), est: 120 },
    { key: "PER-48", area: "PER", title: "Donate old clothes", status: "backlog", pr: 0 },
    { key: "PER-50", area: "PER", title: "Fix the bike light", status: "backlog", pr: 4, est: 30 },
    { key: "HLT-9", area: "HLT", title: "Refill prescription", status: "done", pr: 3, due: D(0), labels: ["errand"] },
    { key: "HLT-11", area: "HLT", project: "Half marathon", title: "Research running shoes", status: "backlog", pr: 4, est: 45 },
    { key: "LRN-12", area: "LRN", project: "Spanish B1", title: "Finish Spanish unit 6 exercises", pr: 4, due: D(0), est: 60,
      desc: "Exercises 4 to 9, then go through the vocabulary list once." },
    { key: "LRN-14", area: "LRN", project: "Spanish B1", title: "Grammar book, chapter 3", pr: 4, est: 120 },
    { key: "DEV-18", area: "DEV", project: "Organizer app", title: "Project scaffold: Next.js and SQLite", status: "done", pr: 2, agent: "claude", sort: 1, fx: 0, fy: 0 },
    { key: "DEV-19", area: "DEV", project: "Organizer app", title: "Task list and detail views", status: "done", pr: 2, agent: "claude", sort: 2, fx: 0, fy: 120 },
    { key: "DEV-21", area: "DEV", project: "Organizer app", title: "MCP server skeleton", status: "review", pr: 2, due: D(0), agent: "claude", sort: 3, fx: 0, fy: 240, labels: ["mcp"],
      desc: "Expose tasks, projects and time blocks over MCP so Claude Code and Codex can read and update them." },
    { key: "DEV-22", area: "DEV", project: "Organizer app", title: "Start sessions from the app", pr: 2, agent: "claude", sort: 4, fx: 0, fy: 380 },
    { key: "DEV-23", area: "DEV", project: "Organizer app", title: "Session tracking over MCP", pr: 3, agent: "claude", sort: 5, fx: 0, fy: 500 },
    { key: "DEV-24", area: "DEV", project: "Organizer app", title: "Auto-planner for time blocks", pr: 3, agent: "codex", sort: 6, fx: 360, fy: 380 },
    { key: "DEV-25", area: "DEV", project: "Organizer app", title: "Desktop build with Electron", pr: 3, agent: "claude", sort: 7, fx: 0, fy: 640 },
    { key: "DEV-26", area: "DEV", project: "Organizer app", title: "Settings screen", status: "backlog", pr: 4, agent: "claude", sort: 8 },
    { key: "DEV-40", area: "DEV", project: "Portfolio site", title: "Portfolio navigation redesign", status: "done", pr: 3, agent: "codex", sort: 1 },
    { key: "DEV-41", area: "DEV", project: "Portfolio site", title: "Case study page layout", pr: 3, agent: "codex", sort: 2 },
    { key: "DEV-42", area: "DEV", project: "Portfolio site", title: "Contact form with spam check", pr: 4, agent: "codex", sort: 3 },
  ];
  const inserted = check(await db.from("tasks").insert(tasks.map((t) => ({
    key: t.key, area_id: areaId.get(t.area), project_id: t.project ? project.get(t.project) : null, title: t.title, description: t.desc ?? "",
    status: t.status ?? "todo", priority: t.pr ?? 0, due_date: t.due ?? null, planned_date: t.planned ?? null, estimate_min: t.est ?? 60,
    labels: t.labels ?? [], agent: t.agent ?? null, sort_order: t.sort ?? 0, flow_x: t.fx ?? null, flow_y: t.fy ?? null,
    created_at: ago(60 * 24 * 3), updated_at: stamp, completed_at: t.status === "done" ? ago(90) : null,
  }))).select("id, key")) as Row[];
  const id = new Map(inserted.map((t) => [String(t.key), Number(t.id)]));

  const subtasks = tasks.flatMap((t) => (t.subs ?? []).map(([title, done], i) => ({ task_id: id.get(t.key), title, done, sort: i })));
  check(await db.from("subtasks").insert(subtasks));

  const edges: [string, string, string][] = [
    ["DEV-18", "DEV-19", "auto"], ["DEV-19", "DEV-21", "auto"], ["DEV-21", "DEV-22", "manual"], ["DEV-21", "DEV-24", "auto"],
    ["DEV-22", "DEV-23", "session"], ["DEV-23", "DEV-25", "auto"], ["DEV-24", "DEV-25", "auto"],
  ];
  check(await db.from("edges").insert(edges.map(([a, b, mode]) => ({ from_task_id: id.get(a), to_task_id: id.get(b), mode }))));

  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const W = (weekday: number, time: string) => toDateStr(addDays(monday, weekday)) + `T${time}`;
  const events: [string, string, string, string, string | null][] = [
    ["Gym", "HLT", W(0, "07:30"), W(0, "08:30"), "weekly"],
    ["Gym", "HLT", W(3, "07:30"), W(3, "08:30"), "weekly"],
    ["Spanish class", "LRN", W(2, "19:00"), W(2, "20:30"), "weekly"],
    ["Climbing with Tomek", "HLT", W(4, "18:00"), W(4, "20:00"), "weekly"],
    ["Long run", "HLT", W(5, "08:00"), W(5, "09:30"), "weekly"],
    ["Lunch with Marta", "PER", D(0, "12:30"), D(0, "13:30"), null],
    ["Q4 planning review", "WRK", D(0, "17:30"), D(0, "18:30"), null],
    ["Dentist", "HLT", D(8, "09:00"), D(8, "10:00"), null],
  ];
  check(await db.from("events").insert(events.map(([title, area, start, end, recurrence]) => ({
    title, area_id: areaId.get(area), start_at: start, end_at: end, recurrence,
  }))));

  const sid = () => crypto.randomBytes(8).toString("hex");
  const [s18, s19, s21] = [sid(), sid(), sid()];
  const folder = null;
  check(await db.from("sessions").insert([
    { id: s18, task_id: id.get("DEV-18"), agent: "claude", folder, branch: "agent/dev-18", status: "done", started_at: ago(60 * 72), finished_at: ago(60 * 71), ended_at: ago(60 * 70), note: "Scaffold ready." },
    { id: s19, task_id: id.get("DEV-19"), agent: "claude", folder, branch: "agent/dev-19", status: "done", started_at: ago(240), finished_at: ago(190), ended_at: ago(180), note: "List and detail views work." },
    { id: s21, task_id: id.get("DEV-21"), agent: "claude", folder, branch: "agent/dev-21", status: "finished", started_at: ago(50), finished_at: ago(12), ended_at: null, note: "MCP endpoint added at /api/mcp. Tests pass." },
  ]));
  check(await db.from("session_events").insert([
    { session_id: s21, at: ago(50), kind: "started", text: "Session started in a new terminal" },
    { session_id: s21, at: ago(49), kind: "picked_up", text: "Claude read the task over MCP" },
    { session_id: s21, at: ago(12), kind: "finished", text: "MCP endpoint added at /api/mcp. Tests pass." },
  ]));
}

/* ---------- data from before the cloud ---------- */

/** The SQLite file PacedMind used on this computer before accounts: the desktop app's, or the dev server's. */
export function legacyDbPath(): string {
  return process.env.ORGANIZER_DB ?? path.join(process.cwd(), "data", "organizer.db");
}

/** What the local database holds, or null when there is none. */
export async function legacySummary(): Promise<{ file: string; areas: number; projects: number; tasks: number } | null> {
  const file = legacyDbPath();
  // The user's data file, not part of the app: keep build tracing out of it.
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return null;
  const { DatabaseSync } = await import("node:sqlite");
  const conn = new DatabaseSync(file, { readOnly: true });
  try {
    const count = (table: string) => Number((conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Row).n);
    return { file, areas: count("areas"), projects: count("projects"), tasks: count("tasks") };
  } catch {
    return null;
  } finally {
    conn.close();
  }
}

/**
 * Copies the local database into the signed-in account. Only into an account without projects or tasks:
 * its default areas are replaced by the local ones. Task keys, dates, sessions and their reports come along,
 * and the images agents attached stay in this computer's data folder; project and task folders, flow
 * switches and agent commands stay on this computer (device.ts). The old MCP token doesn't: agents connect
 * again with this computer's new one.
 */
export async function importLegacy(): Promise<{ areas: number; projects: number; tasks: number }> {
  const db = await supabase();
  const { id: userId } = (await requireAal2()).user;
  const busy = check(await db.from("tasks").select("id").limit(1)) as Row[];
  const projectsNow = check(await db.from("projects").select("id").limit(1)) as Row[];
  if (busy.length || projectsNow.length) throw new Error("Your account already has projects or tasks. Importing works on an empty account.");

  const file = legacyDbPath();
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) throw new Error("There is no local PacedMind data on this computer.");
  const { DatabaseSync } = await import("node:sqlite");
  const conn = new DatabaseSync(file, { readOnly: true });
  const all = (sql: string) => conn.prepare(sql).all() as Row[];
  // Tables later versions of the local app added (reports and their images) may not be there.
  const has = (table: string) => all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table}'`).length > 0;
  try {
    const areas = all("SELECT * FROM areas ORDER BY sort");
    const projects = all("SELECT * FROM projects ORDER BY sort");
    const tasks = all("SELECT * FROM tasks ORDER BY id");
    const subtasks = all("SELECT * FROM subtasks ORDER BY id");
    const events = all("SELECT * FROM events ORDER BY id");
    const sessions = all("SELECT * FROM sessions ORDER BY started_at");
    const sessionEvents = all("SELECT * FROM session_events ORDER BY id");
    const edges = all("SELECT * FROM edges ORDER BY id");
    const reports = has("reports") ? all("SELECT * FROM reports ORDER BY id") : [];
    const attachments = has("attachments") ? all("SELECT * FROM attachments ORDER BY created_at") : [];
    const settings = all("SELECT key, value FROM settings");

    await clearAccount(db);
    const s = (v: unknown) => (v == null ? null : String(v));
    const jsonList = (v: unknown): unknown[] => {
      try {
        const x = JSON.parse(String(v ?? "[]"));
        return Array.isArray(x) ? x : [];
      } catch {
        return [];
      }
    };
    const SURFACES = new Set(["terminal", "desktop", "cloud"]);
    // The local database only knew this computer: a project or task that ran on a chosen computer runs here.
    const here = deviceConfig().deviceId;

    const newAreas = check(await db.from("areas").insert(areas.map((a) => ({
      name: String(a.name), key: String(a.key), color: String(a.color), sort: Number(a.sort),
    }))).select("id, key")) as Row[];
    const areaKey = new Map(areas.map((a) => [String(a.id), String(a.key)]));
    const areaByKey = new Map(newAreas.map((a) => [String(a.key), String(a.id)]));
    const areaId = (old: unknown) => (old == null ? null : areaByKey.get(areaKey.get(String(old)) ?? "") ?? null);

    const projectId = new Map<string, string>();
    const flowsOn: string[] = [];
    for (const p of projects) {
      const env = typeof p.codex_env === "string" ? p.codex_env.trim() : "";
      const r = check(await db.from("projects").insert({
        area_id: areaId(p.area_id), name: String(p.name), color: s(p.color), start_date: s(p.start_date), target_date: s(p.target_date),
        agent: s(p.agent), sort: Number(p.sort), codex_env: CODEX_ENV.test(env) ? env : null, device_id: p.device_id ? here : null,
      }).select("id").single()) as Row;
      projectId.set(String(p.id), String(r.id));
      // The folder and the flow switch belonged to this computer all along; they stay here, not in the cloud.
      if (p.folder && !setProjectFolder(String(r.id), String(p.folder)) && Number(p.flow_on) === 1) flowsOn.push(String(r.id));
    }
    for (const p of projects.filter((x) => x.after_project_id != null)) {
      const after = projectId.get(String(p.after_project_id));
      if (after) check(await db.from("projects").update({ after_project_id: after }).eq("id", projectId.get(String(p.id))!));
    }

    const taskId = new Map<number, number>();
    for (let i = 0; i < tasks.length; i += 200) {
      const chunk = tasks.slice(i, i + 200);
      const rows = check(await db.from("tasks").insert(chunk.map((t) => ({
        key: String(t.key).toUpperCase(), area_id: areaId(t.area_id), project_id: t.project_id == null ? null : projectId.get(String(t.project_id)) ?? null,
        title: String(t.title), description: String(t.description ?? ""), status: String(t.status), priority: Number(t.priority),
        due_date: s(t.due_date), planned_date: s(t.planned_date), estimate_min: Number(t.estimate_min), labels: JSON.parse(String(t.labels || "[]")),
        reminder: s(t.reminder), agent: s(t.agent), sort_order: Number(t.sort_order), flow_x: t.flow_x == null ? null : Number(t.flow_x),
        flow_y: t.flow_y == null ? null : Number(t.flow_y), created_at: String(t.created_at), updated_at: String(t.updated_at), completed_at: s(t.completed_at),
        done_when: cleanDoneWhen(jsonList(t.done_when).filter((x): x is string => typeof x === "string")),
        run_in: SURFACES.has(String(t.run_in)) ? String(t.run_in) : null, device_id: t.device_id ? here : null,
      }))).select("id, key")) as Row[];
      const byKey = new Map(rows.map((r) => [String(r.key), Number(r.id)]));
      for (const t of chunk) taskId.set(Number(t.id), byKey.get(String(t.key).toUpperCase())!);
    }
    const task = (old: unknown) => taskId.get(Number(old));
    // A task's own folder was this computer's too.
    for (const t of tasks) {
      const id = task(t.id);
      if (id && typeof t.folder === "string" && t.folder.trim()) setTaskFolder(id, t.folder.trim());
    }

    const subs = subtasks.filter((x) => task(x.task_id)).map((x) => ({ task_id: task(x.task_id), title: String(x.title), done: Number(x.done) === 1, sort: Number(x.sort) }));
    for (let i = 0; i < subs.length; i += 500) check(await db.from("subtasks").insert(subs.slice(i, i + 500)));

    const evs = events.map((e) => ({ title: String(e.title), area_id: areaId(e.area_id), start_at: String(e.start_at), end_at: String(e.end_at), recurrence: s(e.recurrence) }));
    for (let i = 0; i < evs.length; i += 500) check(await db.from("events").insert(evs.slice(i, i + 500)));

    // Sessions get new ids in the shape the cloud accepts, and "same session" links follow them.
    const sessionId = new Map<string, string>();
    const kept = sessions.filter((x) => task(x.task_id));
    for (const x of kept) sessionId.set(String(x.id), crypto.randomBytes(8).toString("hex"));
    const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v) ? v : null);
    const known = new Set(["starting", "running", "finished", "done", "closed", "failed"]);
    for (const x of kept) {
      check(await db.from("sessions").insert({
        id: sessionId.get(String(x.id)), task_id: task(x.task_id), agent: String(x.agent), device_id: here,
        surface: SURFACES.has(String(x.surface)) ? String(x.surface) : "terminal",
        url: typeof x.url === "string" && /^https:\/\/[^\s<>"']{1,1000}$/.test(x.url) ? x.url : null,
        folder: s(x.folder), branch: s(x.branch), status: known.has(String(x.status)) ? String(x.status) : "closed",
        started_at: String(x.started_at), finished_at: s(x.finished_at), ended_at: s(x.ended_at), note: s(x.note)?.slice(0, 2000) ?? null,
        cli_session_id: uuid(x.cli_session_id),
        continues_session_id: x.continues_session_id ? sessionId.get(String(x.continues_session_id)) ?? null : null,
      }));
    }
    const sevs = sessionEvents.filter((e) => sessionId.has(String(e.session_id))).map((e) => ({
      session_id: sessionId.get(String(e.session_id)), at: String(e.at), kind: String(e.kind), text: String(e.text ?? ""),
    }));
    for (let i = 0; i < sevs.length; i += 500) check(await db.from("session_events").insert(sevs.slice(i, i + 500)));

    // Reports, and the images agents attached: the files are in this computer's data folder already.
    const reportId = new Map<number, number>();
    const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);
    for (const r of reports) {
      const sid = sessionId.get(String(r.session_id));
      const tid = task(r.task_id);
      if (!sid || !tid) continue;
      const row = check(await db.from("reports").insert({
        session_id: sid, task_id: tid, outcome: ["done", "partial", "blocked"].includes(String(r.outcome)) ? String(r.outcome) : "done",
        summary: text(r.summary, 2000).trim() || "Handed back", details: text(r.details, 100000),
        criteria: jsonList(r.criteria).slice(0, 50), verify: jsonList(r.verify).slice(0, 50), questions: jsonList(r.questions).slice(0, 50),
        links: jsonList(r.links).slice(0, 50), follow_ups: jsonList(r.follow_ups).slice(0, 50), created_at: String(r.created_at),
        changes: r.changes ? text(r.changes, 20000) : null, changes_at: r.changes ? s(r.changes_at) : null,
      }).select("id").single()) as Row;
      reportId.set(Number(r.id), Number(row.id));
    }
    const images = attachments.filter((a) => /^[0-9a-f]{16}$/.test(String(a.id)) && task(a.task_id) && /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/.test(String(a.file)))
      .map((a) => ({
        id: String(a.id), task_id: task(a.task_id), session_id: a.session_id == null ? null : sessionId.get(String(a.session_id)) ?? null,
        report_id: a.report_id == null ? null : reportId.get(Number(a.report_id)) ?? null, device_id: here,
        file: String(a.file), mime: String(a.mime), bytes: Number(a.bytes), width: a.width == null ? null : Number(a.width),
        height: a.height == null ? null : Number(a.height), caption: text(a.caption, 500), created_at: String(a.created_at),
      }));
    for (let i = 0; i < images.length; i += 200) check(await db.from("attachments").insert(images.slice(i, i + 200)));

    const links = edges.filter((e) => task(e.from_task_id) && task(e.to_task_id)).map((e) => ({
      from_task_id: task(e.from_task_id), to_task_id: task(e.to_task_id), mode: String(e.mode), at_time: s(e.at_time),
    }));
    if (links.length) check(await db.from("edges").insert(links));
    // A flow that was on stays on, with the connections it already ran with on this computer; one added
    // later from elsewhere asks first.
    for (const id of flowsOn) setFlowArmed(id, true, await flowSnapshot(id));

    // Planning settings go to the account; how sessions start stays on this computer. The old MCP token
    // doesn't come along: connect your agents again from Settings.
    const PLANNING = new Set(["workStart", "workEnd", "lunchStart", "lunchEnd", "workDays"]);
    const old: Record<string, unknown> = Object.fromEntries(settings.map((x) => [String(x.key), JSON.parse(String(x.value))]));
    const values = Object.entries(old).filter(([k]) => PLANNING.has(k)).map(([key, value]) => ({ user_id: userId, key, value }));
    if (values.length) check(await db.from("settings").upsert(values, { onConflict: "user_id,key" }));
    updateDevice({
      ...(old.terminal === "wt" || old.terminal === "cmd" || old.terminal === "terminal" || old.terminal === "iterm" ? { terminal: old.terminal } : {}),
      ...(typeof old.claudeCommand === "string" && !commandProblem(old.claudeCommand) ? { claudeCommand: old.claudeCommand } : {}),
      ...(typeof old.codexCommand === "string" && !commandProblem(old.codexCommand) ? { codexCommand: old.codexCommand } : {}),
      ...(old.importOffered === true ? { importOffered: true } : {}),
    });

    return { areas: areas.length, projects: projects.length, tasks: tasks.length };
  } finally {
    conn.close();
  }
}
