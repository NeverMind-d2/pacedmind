import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { addDays, addMinutes } from "date-fns";
import { toDateStr, toStamp } from "@/lib/dates";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, color TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, area_id TEXT NOT NULL REFERENCES areas(id), name TEXT NOT NULL,
  start_date TEXT, target_date TEXT, folder TEXT, agent TEXT, after_project_id TEXT,
  flow_on INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0, color TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE,
  area_id TEXT REFERENCES areas(id), project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'todo',
  priority INTEGER NOT NULL DEFAULT 0, due_date TEXT, planned_date TEXT, estimate_min INTEGER NOT NULL DEFAULT 60,
  labels TEXT NOT NULL DEFAULT '[]', reminder TEXT, agent TEXT, sort_order INTEGER NOT NULL DEFAULT 0,
  flow_x REAL, flow_y REAL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, area_id TEXT REFERENCES areas(id),
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, recurrence TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, agent TEXT NOT NULL,
  folder TEXT, branch TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, ended_at TEXT,
  note TEXT, cli_session_id TEXT, continues_session_id TEXT
);
CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  to_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'auto', at_time TEXT, UNIQUE(from_task_id, to_task_id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const g = globalThis as unknown as { __organizerDb?: DatabaseSync };

export function dbPath(): string {
  return process.env.ORGANIZER_DB ?? path.join(process.cwd(), "data", "organizer.db");
}

/** Per module instance, so a code reload in dev also runs new migrations on the cached connection. */
let migrated = false;

export function db(): DatabaseSync {
  if (!g.__organizerDb) {
    const file = dbPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const conn = new DatabaseSync(file);
    conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
    conn.exec(SCHEMA);
    const seeded = conn.prepare("SELECT value FROM meta WHERE key = 'seeded'").get();
    if (!seeded) {
      seed(conn, "sample");
      conn.prepare("INSERT INTO meta (key, value) VALUES ('seeded', ?)").run(toStamp(new Date()));
    }
    g.__organizerDb = conn;
  }
  if (!migrated) {
    migrate(g.__organizerDb);
    migrated = true;
  }
  return g.__organizerDb;
}

/** Adds columns introduced after a database was first created. */
function migrate(conn: DatabaseSync) {
  const cols = (conn.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("color")) conn.exec("ALTER TABLE projects ADD COLUMN color TEXT");
}

export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec("BEGIN");
  try {
    const out = fn();
    conn.exec("COMMIT");
    return out;
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

export function resetDatabase(mode: "sample" | "empty") {
  const conn = db();
  conn.exec("BEGIN");
  try {
    for (const t of ["session_events", "sessions", "edges", "subtasks", "tasks", "events", "projects", "areas"]) {
      conn.exec(`DELETE FROM ${t}`);
    }
    conn.exec("DELETE FROM sqlite_sequence");
    seed(conn, mode);
    conn.exec("COMMIT");
  } catch (e) {
    conn.exec("ROLLBACK");
    throw e;
  }
}

export const DEFAULT_AREAS = [
  { id: "work", name: "Work", key: "WRK", color: "#7D93B5" },
  { id: "personal", name: "Personal", key: "PER", color: "#7FA894" },
  { id: "health", name: "Health", key: "HLT", color: "#B08A9B" },
  { id: "learning", name: "Learning", key: "LRN", color: "#9C93B8" },
  { id: "dev", name: "Dev", key: "DEV", color: "#7AA3AD" },
];

function seed(conn: DatabaseSync, mode: "sample" | "empty") {
  const insArea = conn.prepare("INSERT INTO areas (id, name, key, color, sort) VALUES (?, ?, ?, ?, ?)");
  DEFAULT_AREAS.forEach((a, i) => insArea.run(a.id, a.name, a.key, a.color, i));

  const hasToken = conn.prepare("SELECT 1 FROM settings WHERE key = 'mcpToken'").get();
  if (!hasToken) {
    conn.prepare("INSERT INTO settings (key, value) VALUES ('mcpToken', ?)").run(
      JSON.stringify(`org_${crypto.randomBytes(18).toString("base64url")}`),
    );
  }
  if (mode === "empty") return;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const D = (offset: number, time?: string) => toDateStr(addDays(today, offset)) + (time ? `T${time}` : "");
  const stamp = toStamp(now);
  const ago = (min: number) => toStamp(addMinutes(now, -min));

  const insProject = conn.prepare(
    `INSERT INTO projects (id, area_id, name, start_date, target_date, folder, agent, after_project_id, flow_on, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const projects: [string, string, string, number, number, string | null, string | null, string | null][] = [
    ["organizer", "dev", "Organizer app", -3, 22, process.cwd(), "claude", null],
    ["chessv2", "dev", "ChessV2", 25, 50, "C:\\Users\\mikob\\Documents\\Projekty\\ChessV2\\chessv2", "codex", "organizer"],
    ["portfolio", "dev", "Portfolio site", 4, 43, null, "codex", null],
    ["q4", "work", "Q4 planning", -10, 7, null, null, null],
    ["move", "personal", "Apartment move", -3, 21, null, null, null],
    ["marathon", "health", "Half marathon", -40, 45, null, null, null],
    ["spanish", "learning", "Spanish B1", -30, 79, null, null, null],
  ];
  projects.forEach(([id, area, name, s, t, folder, agent, after], i) =>
    insProject.run(id, area, name, D(s), D(t), folder, agent, after, i),
  );

  const insTask = conn.prepare(
    `INSERT INTO tasks (key, area_id, project_id, title, description, status, priority, due_date, planned_date,
       estimate_min, labels, agent, sort_order, flow_x, flow_y, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insSub = conn.prepare("INSERT INTO subtasks (task_id, title, done, sort) VALUES (?, ?, ?, ?)");
  const ids: Record<string, number> = {};
  type Seed = {
    key: string; area: string; project?: string; title: string; desc?: string; status?: string; pr?: number;
    due?: string; planned?: string; est?: number; labels?: string[]; agent?: string; sort?: number;
    fx?: number; fy?: number; subs?: [string, boolean][];
  };
  const tasks: Seed[] = [
    { key: "WRK-27", area: "work", project: "q4", title: "Review Q3 budget draft", status: "progress", pr: 3, due: D(-1), planned: D(-2), est: 90, labels: ["finance"],
      desc: "Check the travel and tooling lines against Q3 actuals before sending comments back.", subs: [["Travel line", true], ["Tooling line", false]] },
    { key: "WRK-31", area: "work", project: "q4", title: "Prepare slides for Q4 planning", status: "progress", pr: 1, due: D(0, "17:00"), planned: D(0), est: 180, labels: ["presentation"],
      desc: "Summarize Q3 results and propose three priorities for Q4. Keep it to ten slides.",
      subs: [["Collect Q3 numbers", true], ["Draft the outline", true], ["Build the charts", false], ["Rehearse once", false]] },
    { key: "WRK-33", area: "work", title: "Reply to design feedback", pr: 0, planned: D(0), est: 30, labels: ["email"],
      desc: "Short reply is fine. Agree on the spacing changes, push back on the new colors." },
    { key: "WRK-34", area: "work", title: "Send invoice to Acme", pr: 2, due: D(1, "10:00"), planned: D(1), est: 30, labels: ["finance"] },
    { key: "WRK-36", area: "work", project: "q4", title: "Send the Q4 plan to the team", pr: 2, due: D(7), est: 120 },
    { key: "PER-39", area: "personal", title: "Call insurance about the car claim", pr: 3, due: D(4), planned: D(0), est: 30, labels: ["car"],
      desc: "Have the claim number and the photos ready before calling." },
    { key: "PER-41", area: "personal", title: "Pay electricity bill", pr: 2, due: D(-2), planned: D(-2), est: 15, labels: ["bills"],
      desc: "The account number is on the last invoice in the Bills folder." },
    { key: "PER-42", area: "personal", title: "Renew car insurance", pr: 2, due: D(6), est: 30, labels: ["car"] },
    { key: "PER-44", area: "personal", project: "move", title: "Book movers for moving day", pr: 2, due: D(0), est: 60, labels: ["move"],
      desc: "Get two quotes first. A van and two people for the morning is enough.", subs: [["Ask for two quotes", false], ["Confirm the date", false]] },
    { key: "PER-45", area: "personal", project: "move", title: "Buy packing boxes", pr: 4, planned: D(2), est: 60 },
    { key: "PER-47", area: "personal", project: "move", title: "Pack the kitchen", pr: 3, planned: D(9), est: 120 },
    { key: "PER-48", area: "personal", title: "Donate old clothes", status: "backlog", pr: 0 },
    { key: "PER-50", area: "personal", title: "Fix the bike light", status: "backlog", pr: 4, est: 30 },
    { key: "HLT-9", area: "health", title: "Refill prescription", status: "done", pr: 3, due: D(0), labels: ["errand"] },
    { key: "HLT-11", area: "health", project: "marathon", title: "Research running shoes", status: "backlog", pr: 4, est: 45 },
    { key: "LRN-12", area: "learning", project: "spanish", title: "Finish Spanish unit 6 exercises", pr: 4, due: D(0), est: 60,
      desc: "Exercises 4 to 9, then go through the vocabulary list once." },
    { key: "LRN-14", area: "learning", project: "spanish", title: "Grammar book, chapter 3", pr: 4, est: 120 },
    { key: "DEV-18", area: "dev", project: "organizer", title: "Project scaffold: Next.js and SQLite", status: "done", pr: 2, agent: "claude", sort: 1, fx: 0, fy: 0 },
    { key: "DEV-19", area: "dev", project: "organizer", title: "Task list and detail views", status: "done", pr: 2, agent: "claude", sort: 2, fx: 0, fy: 120 },
    { key: "DEV-21", area: "dev", project: "organizer", title: "MCP server skeleton", status: "review", pr: 2, due: D(0), agent: "claude", sort: 3, fx: 0, fy: 240, labels: ["mcp"],
      desc: "Expose tasks, projects and time blocks over MCP so Claude Code and Codex can read and update them." },
    { key: "DEV-22", area: "dev", project: "organizer", title: "Start sessions from the app", pr: 2, agent: "claude", sort: 4, fx: 0, fy: 380 },
    { key: "DEV-23", area: "dev", project: "organizer", title: "Session tracking over MCP", pr: 3, agent: "claude", sort: 5, fx: 0, fy: 500 },
    { key: "DEV-24", area: "dev", project: "organizer", title: "Auto-planner for time blocks", pr: 3, agent: "codex", sort: 6, fx: 360, fy: 380 },
    { key: "DEV-25", area: "dev", project: "organizer", title: "Desktop build with Electron", pr: 3, agent: "claude", sort: 7, fx: 0, fy: 640 },
    { key: "DEV-26", area: "dev", project: "organizer", title: "Settings screen", status: "backlog", pr: 4, agent: "claude", sort: 8 },
    { key: "DEV-40", area: "dev", project: "portfolio", title: "Portfolio navigation redesign", status: "done", pr: 3, agent: "codex", sort: 1 },
    { key: "DEV-41", area: "dev", project: "portfolio", title: "Case study page layout", pr: 3, agent: "codex", sort: 2 },
    { key: "DEV-42", area: "dev", project: "portfolio", title: "Contact form with spam check", pr: 4, agent: "codex", sort: 3 },
  ];
  for (const t of tasks) {
    const done = t.status === "done";
    const r = insTask.run(
      t.key, t.area, t.project ?? null, t.title, t.desc ?? "", t.status ?? "todo", t.pr ?? 0, t.due ?? null, t.planned ?? null,
      t.est ?? 60, JSON.stringify(t.labels ?? []), t.agent ?? null, t.sort ?? 0, t.fx ?? null, t.fy ?? null,
      ago(60 * 24 * 3), stamp, done ? ago(90) : null,
    );
    ids[t.key] = Number(r.lastInsertRowid);
    (t.subs ?? []).forEach(([title, d], i) => insSub.run(ids[t.key], title, d ? 1 : 0, i));
  }

  const insEdge = conn.prepare("INSERT INTO edges (from_task_id, to_task_id, mode) VALUES (?, ?, ?)");
  const edges: [string, string, string][] = [
    ["DEV-18", "DEV-19", "auto"], ["DEV-19", "DEV-21", "auto"], ["DEV-21", "DEV-22", "manual"], ["DEV-21", "DEV-24", "auto"],
    ["DEV-22", "DEV-23", "session"], ["DEV-23", "DEV-25", "auto"], ["DEV-24", "DEV-25", "auto"],
  ];
  edges.forEach(([a, b, m]) => insEdge.run(ids[a], ids[b], m));

  const insEvent = conn.prepare("INSERT INTO events (title, area_id, start_at, end_at, recurrence) VALUES (?, ?, ?, ?, ?)");
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const W = (weekday: number, time: string) => toDateStr(addDays(monday, weekday)) + `T${time}`;
  const events: [string, string, string, string, string | null][] = [
    ["Gym", "health", W(0, "07:30"), W(0, "08:30"), "weekly"],
    ["Gym", "health", W(3, "07:30"), W(3, "08:30"), "weekly"],
    ["Spanish class", "learning", W(2, "19:00"), W(2, "20:30"), "weekly"],
    ["Climbing with Tomek", "health", W(4, "18:00"), W(4, "20:00"), "weekly"],
    ["Long run", "health", W(5, "08:00"), W(5, "09:30"), "weekly"],
    ["Lunch with Marta", "personal", D(0, "12:30"), D(0, "13:30"), null],
    ["Q4 planning review", "work", D(0, "17:30"), D(0, "18:30"), null],
    ["Dentist", "health", D(8, "09:00"), D(8, "10:00"), null],
  ];
  events.forEach((e) => insEvent.run(...e));

  const insSession = conn.prepare(
    `INSERT INTO sessions (id, task_id, agent, folder, branch, status, started_at, finished_at, ended_at, note, cli_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insEv = conn.prepare("INSERT INTO session_events (session_id, at, kind, text) VALUES (?, ?, ?, ?)");
  const folder = process.cwd();
  insSession.run("seed18", ids["DEV-18"], "claude", folder, "agent/dev-18", "done", ago(60 * 72), ago(60 * 71), ago(60 * 70), "Scaffold ready.", null);
  insSession.run("seed19", ids["DEV-19"], "claude", folder, "agent/dev-19", "done", ago(240), ago(190), ago(180), "List and detail views work.", null);
  insSession.run("seed21", ids["DEV-21"], "claude", folder, "agent/dev-21", "finished", ago(50), ago(12), null, "MCP endpoint added at /api/mcp. Tests pass.", null);
  insEv.run("seed21", ago(50), "started", "Session started in a new terminal");
  insEv.run("seed21", ago(49), "picked_up", "Claude read the task over MCP");
  insEv.run("seed21", ago(12), "finished", "MCP endpoint added at /api/mcp. Tests pass.");
}
