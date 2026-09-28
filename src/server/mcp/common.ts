import "server-only";
import * as chrono from "chrono-node";
import { format } from "date-fns";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import * as repo from "../repo";
import { noteAgentActivity } from "../signals";
import { SESSION_TOOLS } from "./agent-tools";
import { caller } from "./principal";
import { findAreaIcons, isAreaIcon, type AreaIcon } from "@/lib/area-icons";
import { CloudReadOnly } from "@/lib/billing";
import { PALETTE } from "@/lib/colors";
import { dateOnly, parseLocal, timeOf, toDateStr, toDateTimeStr } from "@/lib/dates";
import {
  AGENT_LABEL, PRIORITY_LABEL, STATUS_LABEL, isAnswers,
  type Area, type Attachment, type CalEvent, type Priority, type Project, type Report, type Session, type Status, type Task,
} from "@/lib/types";

/* ---------- registering tools ---------- */

/** A problem the caller can fix, reported back as the tool's error text. */
export class ToolError extends Error {}

export function fail(message: string): never {
  throw new ToolError(message);
}

type Kind = "read" | "write" | "delete" | "launch";

/**
 * Registers a tool whose handler returns text; thrown errors become MCP tool errors. A session PacedMind
 * started only gets the tools in SESSION_TOOLS: the others aren't listed for it and refuse its calls.
 */
export function tool<S extends z.ZodObject>(
  server: McpServer,
  name: string,
  spec: { title: string; description: string; input: S; kind: Kind },
  run: (args: z.infer<S>) => string | Promise<string>,
) {
  const ownerOnly = !SESSION_TOOLS.has(name);
  if (ownerOnly && caller().kind === "session") return;
  server.registerTool(
    name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
      annotations: {
        title: spec.title,
        readOnlyHint: spec.kind === "read",
        destructiveHint: spec.kind === "delete",
        openWorldHint: spec.kind === "launch",
      },
    },
    (async (args: z.infer<S>) => {
      try {
        const who = caller();
        if (ownerOnly && who.kind === "session") {
          fail(`Sessions that PacedMind started can't use ${name}. Ask the user to do it in PacedMind.`);
        }
        // A session's agent calling PacedMind is at work, whatever it waited for before; except while it waits for your
        // answer to what it asked (ask_user, which it calls again to keep waiting).
        if (who.kind === "session" && name !== "ask_user") await noteAgentActivity(who.sessionId).catch(() => {});
        return { content: [{ type: "text" as const, text: await run(args) }] };
      } catch (e) {
        const text = e instanceof ToolError || e instanceof CloudReadOnly ? e.message : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
        return { content: [{ type: "text" as const, text }], isError: true };
      }
    }) as never,
  );
}

/* ---------- shared input schemas ---------- */

export const taskRef = z.string().describe("Task key, such as WRK-12");
export const projectRef = z.string().describe("Project id or name");
export const areaRef = z.string().describe("Area name, key or id (e.g. Work or WRK)");
export const dateInput = z.string().describe('A date: YYYY-MM-DD, or words like "today", "tomorrow", "next friday", "in 2 weeks"');
export const dateTimeInput = z.string().describe('A date with an optional time: YYYY-MM-DD, YYYY-MM-DDTHH:mm, or words like "friday 10:00"');

export const PRIORITY_NAMES = ["none", "urgent", "high", "medium", "low"] as const;
export const prioritySchema = z.enum(PRIORITY_NAMES).describe("urgent, high, medium, low or none");
export const priorityOf = (p: (typeof PRIORITY_NAMES)[number]): Priority => PRIORITY_NAMES.indexOf(p) as Priority;

export const STATUS_NAMES = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
export const statusSchema = z.enum(STATUS_NAMES).describe("backlog, todo, in_progress, in_review, done or canceled");
const STATUS_OF: Record<(typeof STATUS_NAMES)[number], Status> = {
  backlog: "backlog", todo: "todo", in_progress: "progress", in_review: "review", done: "done", canceled: "canceled",
};
export const statusOf = (s: (typeof STATUS_NAMES)[number]): Status => STATUS_OF[s];

export const agentSchema = z.enum(["claude", "codex"]).describe("claude (Claude Code) or codex (Codex)");
/** Who does a task. "human" marks a task only the user can do: it stays out of flows and never starts an agent session. */
export const doerSchema = z.enum(["claude", "codex", "human"])
  .describe("Who does the task: claude (Claude Code), codex (Codex), or human (only the user can do it; it stays out of flows)");

/* ---------- finding things ---------- */

const listNames = (xs: string[]) => (xs.length ? xs.join(", ") : "none yet");

export async function findArea(query: string): Promise<Area> {
  const q = query.trim().toLowerCase();
  const areas = await repo.listAreas();
  const exact = areas.find((a) => a.id === q || a.key.toLowerCase() === q || a.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = areas.filter((a) => a.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length) fail(`"${query}" matches several areas: ${partial.map((a) => a.name).join(", ")}. Be more specific.`);
  return fail(`No area matches "${query}". Areas: ${listNames(areas.map((a) => `${a.name} (${a.id})`))}.`);
}

/** An area, or null for the Inbox ("inbox", "none"). */
export async function findAreaOrInbox(query: string | null): Promise<Area | null> {
  if (query === null || /^(inbox|none|no area)$/i.test(query.trim())) return null;
  return findArea(query);
}

export async function findProject(query: string): Promise<Project> {
  const q = query.trim().toLowerCase();
  const projects = await repo.listProjects();
  const exact = projects.find((p) => p.id === q || p.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = projects.filter((p) => p.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0];
  if (partial.length) fail(`"${query}" matches several projects: ${partial.map((p) => `${p.name} (${p.id})`).join(", ")}. Use the id.`);
  return fail(`No project matches "${query}". Projects: ${listNames(projects.map((p) => `${p.name} (${p.id})`))}.`);
}

export async function findTask(query: string): Promise<Task> {
  return (await repo.getTask(query.trim())) ?? fail(`No task ${query}. Task keys look like WRK-12; list_tasks finds them.`);
}

export async function findEvent(id: number): Promise<CalEvent> {
  return (await repo.getEvent(id)) ?? fail(`No event ${id}. list_events shows event ids.`);
}

export async function findSession(id: string): Promise<Session> {
  return (await repo.getSession(id.trim())) ?? fail(`No session ${id}. list_sessions shows session ids.`);
}

/* ---------- dates ---------- */

const pad = (n: number | string) => String(n).padStart(2, "0");

/**
 * Reads a date or date-time the way people write it. time: "optional" keeps a time when one is given,
 * "required" insists on one, "drop" always returns just the date.
 */
export function when(input: string, time: "optional" | "required" | "drop" = "optional"): string {
  const text = input.trim();
  let value: string | null = null;
  let hasTime = false;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?$/.exec(text);
  if (iso) {
    const day = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (toDateStr(parseLocal(day)) !== day) fail(`${day} is not a real date.`);
    if (iso[4] !== undefined) {
      if (Number(iso[4]) > 23 || Number(iso[5]) > 59) fail(`${iso[4]}:${iso[5]} is not a real time.`);
      value = `${day}T${pad(iso[4])}:${iso[5]}`;
      hasTime = true;
    } else {
      value = day;
    }
  } else {
    const r = chrono.parse(text, new Date(), { forwardDate: true })[0];
    if (r) {
      hasTime = r.start.isCertain("hour");
      value = hasTime ? toDateTimeStr(r.start.date()) : toDateStr(r.start.date());
    }
  }
  if (!value) return fail(`Couldn't read the date "${input}". Use YYYY-MM-DD, YYYY-MM-DDTHH:mm or words like "tomorrow 9:00".`);
  if (time === "required" && !hasTime) fail(`"${input}" needs a time, such as "2026-09-26T14:00" or "friday 14:00".`);
  return time === "drop" ? value.slice(0, 10) : value;
}

/** "2026-09-26 (Fri)" or "2026-09-26 14:00 (Fri)". */
export function fmtWhen(value: string): string {
  const t = timeOf(value);
  return `${dateOnly(value)}${t ? ` ${t}` : ""} (${format(parseLocal(dateOnly(value)), "EEE")})`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

export function todayLine(now = new Date()): string {
  return `Now: ${format(now, "EEEE")} ${toDateStr(now)} ${format(now, "HH:mm")}, week ${format(now, "I")}`;
}

/* ---------- colors ---------- */

export function colorFrom(input: string): string {
  const s = input.trim();
  const named = PALETTE.find((c) => c.name.toLowerCase() === s.toLowerCase());
  if (named) return named.value;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return `#${h.toUpperCase()}`;
  }
  return fail(`Unknown color "${input}". Use one of ${PALETTE.map((c) => c.name).join(", ")}, or a hex color like #68AAB9.`);
}

export const colorName = (hex: string) => PALETTE.find((c) => c.value.toUpperCase() === hex.toUpperCase())?.name ?? hex;
export const PALETTE_NAMES = PALETTE.map((c) => c.name).join(", ");

/* ---------- area icons ---------- */

/** A few of the icons, for descriptions: there are hundreds (src/lib/area-icons.ts). */
export const AREA_ICON_EXAMPLES = "briefcase, house, graduation-cap, code, heart-pulse, plane, wallet or music";

/** A known icon name, else an error with the icons whose names or meanings match. */
export function iconFrom(input: string): AreaIcon {
  const s = input.trim().toLowerCase();
  if (isAreaIcon(s)) return s;
  const close = findAreaIcons(s.replace(/-/g, " ")).slice(0, 15);
  return fail(`Unknown icon "${input}". ${close.length ? `Matching icons: ${close.join(", ")}.` : `Use a Lucide icon name from the area menu, such as ${AREA_ICON_EXAMPLES}.`}`);
}

/* ---------- describing things ---------- */

/** Name lookups for one tool call. */
export async function names() {
  const [areaList, projectList] = await Promise.all([repo.listAreas(), repo.listProjects()]);
  const areas = new Map(areaList.map((a) => [a.id, a]));
  const projects = new Map(projectList.map((p) => [p.id, p]));
  return {
    areas,
    projects,
    area: (id: string | null) => (id ? areas.get(id)?.name ?? id : "Inbox"),
    project: (id: string | null) => (id ? projects.get(id)?.name ?? id : null),
    /** Where a task lives: its project, else its area, else the Inbox. */
    place: (t: Task) => (t.projectId ? projects.get(t.projectId)?.name ?? t.projectId : t.areaId ? areas.get(t.areaId)?.name ?? t.areaId : "Inbox"),
  };
}

export type Names = Awaited<ReturnType<typeof names>>;

export const isOpen = (t: Task) => t.status !== "done" && t.status !== "canceled";

/** One line per task: key, status, priority, title, where it lives, dates and labels. */
export function taskLine(t: Task, n: Names): string {
  const parts = [t.key, STATUS_LABEL[t.status]];
  if (t.priority) parts.push(PRIORITY_LABEL[t.priority]);
  parts.push(t.title, n.place(t));
  if (t.dueDate) parts.push(`due ${fmtWhen(t.dueDate)}`);
  if (t.plannedDate) parts.push(`planned ${fmtWhen(t.plannedDate)}`);
  if (t.labels.length) parts.push(t.labels.map((l) => `#${l}`).join(" "));
  return parts.join(" · ");
}

export async function describeTask(t: Task, given?: Names): Promise<string> {
  const [n, edges, tasks, session, report] = await Promise.all([
    given ?? names(), repo.listEdges(), repo.listTasks(), repo.latestSession(t.id), repo.latestReport(t.id),
  ]);
  const keys = new Map(tasks.map((x) => [x.id, x.key]));
  const keyOf = (id: number) => keys.get(id) ?? `#${id}`;
  const after = edges.filter((e) => e.toTaskId === t.id).map((e) => `${keyOf(e.fromTaskId)} (${e.mode === "session" ? "same session" : e.mode})`);
  const next = edges.filter((e) => e.fromTaskId === t.id).map((e) => `${keyOf(e.toTaskId)} (${e.mode === "session" ? "same session" : e.mode})`);
  const project = t.projectId ? n.projects.get(t.projectId) : undefined;
  return [
    `${t.key} · ${t.title}`,
    `Status: ${STATUS_LABEL[t.status]} · Priority: ${PRIORITY_LABEL[t.priority]}`,
    `Where: ${project ? `project ${project.name} (${project.id}) in ${n.area(project.areaId)}` : t.areaId ? `area ${n.area(t.areaId)}` : "Inbox"}`,
    t.dueDate || t.plannedDate ? `Due: ${t.dueDate ? fmtWhen(t.dueDate) : "none"} · Planned for: ${t.plannedDate ? fmtWhen(t.plannedDate) : "none"}` : null,
    `Estimate: ${fmtMinutes(t.estimateMin)}${t.agent === "human" ? " · Done by: the user (human), not in flows" : t.agent ? ` · Agent: ${AGENT_LABEL[t.agent]}` : ""}`,
    t.labels.length ? `Labels: ${t.labels.join(", ")}` : null,
    t.folder ? `Folder: ${t.folder} (its own)` : project?.folder ? `Folder: ${project.folder}` : null,
    t.runIn ? `Sessions run in: ${t.runIn === "desktop" ? "the agent's desktop app" : t.runIn === "cloud" ? "the agent's cloud" : "a terminal"}` : null,
    t.description ? `\nDescription:\n${t.description}` : "\nDescription: none",
    t.doneWhen.length ? `\nDone when:\n${t.doneWhen.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : null,
    t.subtasks.length ? `\nSub-tasks:\n${t.subtasks.map((s, i) => `${i + 1}. [${s.done ? "x" : " "}] ${s.title}`).join("\n")}` : null,
    after.length ? `\nStarts after: ${after.join(", ")}` : null,
    next.length ? `${after.length ? "" : "\n"}Leads to: ${next.join(", ")}` : null,
    session && session.id !== report?.sessionId ? `\nLatest session: ${session.id} · ${session.status}${session.note ? ` · ${session.note}` : ""}` : null,
    report ? `\n${reportText(report, session?.id === report.sessionId ? "Latest report" : "Last report, from an earlier session")}` : null,
    `\nCreated ${t.createdAt.replace("T", " ")} · updated ${t.updatedAt.replace("T", " ")}${t.completedAt ? ` · done ${t.completedAt.replace("T", " ")}` : ""}`,
  ].filter((x) => x !== null).join("\n");
}

const VERDICT_TEXT = { met: "met", partly: "partly met", not_met: "not met" } as const;

/** "Settings in dark mode, 1280×800 PNG, 240 KB". */
export function imageLine(a: Attachment): string {
  const kb = a.bytes >= 1048576 ? `${(a.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.bytes / 1024))} KB`;
  const size = a.width && a.height ? `${a.width}×${a.height} ` : "";
  return `${a.caption ? `"${a.caption}", ` : "an image, "}${size}${a.mime.replace("image/", "").toUpperCase()}, ${kb}`;
}

/** "2 of 3 Done when items met · 2 images · 1 question". */
export function reportCounts(r: Report): string {
  const answered = r.criteria.filter((c) => c.verdict);
  return [
    r.criteria.length ? `${r.criteria.filter((c) => c.verdict === "met").length} of ${plural(r.criteria.length, "Done when item")} met` : null,
    answered.length < r.criteria.length ? `${r.criteria.length - answered.length} not answered` : null,
    r.images.length ? plural(r.images.length, "image") : null,
    r.questions.length ? plural(r.questions.length, "question") : null,
  ].filter(Boolean).join(" · ");
}

/** A report the way agents and assistants read it. */
export function reportText(r: Report, heading = "Report"): string {
  const outcome = r.outcome === "done" ? "done" : r.outcome === "partial" ? "partly done" : "blocked, needs the user";
  return [
    `${heading} · session ${r.sessionId} · ${AGENT_LABEL[r.agent]} · ${r.createdAt.replace("T", " ")} · ${outcome}`,
    `Summary: ${r.summary}`,
    r.criteria.length
      ? `Done when:\n${r.criteria.map((c, i) => `${i + 1}. [${c.verdict ? VERDICT_TEXT[c.verdict] : "not answered"}] ${c.text}${c.note ? ` · ${c.note}` : ""}`).join("\n")}`
      : null,
    r.images.length ? `Images:\n${r.images.map((a) => `- ${imageLine(a)}`).join("\n")}` : null,
    r.verify.length ? `How to check:\n${r.verify.map((v, i) => `${i + 1}. ${v}`).join("\n")}` : null,
    r.questions.length ? `Questions for the user:\n${r.questions.map((q) => `- ${q}`).join("\n")}` : null,
    r.links.length ? `Links: ${r.links.map((l) => (l.label === l.url ? l.url : `${l.label} (${l.url})`)).join(", ")}` : null,
    r.followUps.length ? `Follow-ups: ${r.followUps.map((f) => (f.title ? `${f.key} ${f.title}` : f.key)).join(", ")}` : null,
    r.details ? `Details:\n${r.details}` : null,
    r.changes ? `The user ${isAnswers(r.changes) ? "answered your questions" : "asked for changes"} (${(r.changesAt ?? "").replace("T", " ")}):\n${r.changes}` : null,
  ].filter((x) => x !== null).join("\n");
}

export function projectLine(p: Project, n: Names, u: { tasks: number; open: number; pct: number } | undefined): string {
  const parts = [`${p.name} (id ${p.id})`, n.area(p.areaId)];
  if (u) parts.push(u.tasks ? `${u.open} open of ${u.tasks} · ${u.pct}% done` : "no tasks");
  if (p.targetDate) parts.push(`target ${fmtWhen(p.targetDate)}`);
  if (p.color) parts.push(`color ${colorName(p.color)}`);
  if (p.agent) parts.push(`agent ${AGENT_LABEL[p.agent]}`);
  if (p.folder) parts.push(`folder ${p.folder}`);
  if (p.flowOn) parts.push("flow on");
  if (p.afterProjectId) parts.push(`starts after ${n.project(p.afterProjectId) ?? p.afterProjectId}`);
  return parts.join(" · ");
}

export function eventLine(e: { eventId: number; title: string; areaId: string | null; start: string; end: string }, n: Names, weekly: boolean): string {
  return `${timeOf(e.start)}–${timeOf(e.end)} ${e.title}${e.areaId ? ` · ${n.area(e.areaId)}` : ""}${weekly ? " · weekly" : ""} [event ${e.eventId}]`;
}
