import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { folderProblem } from "./folders";
import { AGENT_ALLOWED_TOOLS } from "./mcp/agent-tools";
import * as repo from "./repo";
import { MODE, requireAal2 } from "./supabase";
import { agentCommandFor, dataDir, deviceFor, issueSessionToken, projectFolder } from "./device";
import { AGENT_LABEL, LIVE_STATUSES, agentOf, type AgentId, type Session, type Task } from "@/lib/types";

/*
 * Opens terminals with Claude Code or Codex. This is the one place PacedMind runs anything on your computer,
 * so it trusts nothing that comes from the cloud: the task's key, title and ids are checked or reduced to
 * plain characters before they reach a command line, and the command, terminal and folder come from this
 * computer's own settings (device.ts). Each session gets its own MCP token, which only works for that
 * session's tools and stops working when the session ends.
 *
 * Only the desktop app's own window, the flows it switched on and requests you allowed call startSession
 * (see the callers): the hosted web app and agents over MCP can only ask (requests.ts).
 */

export interface LaunchResult {
  ok: boolean;
  session?: Session;
  error?: string;
}

/** Where agents reach this server. Next sets PORT to the port it listens on (the app uses 4319, `npm run dev` 4320). */
export function baseUrl(): string {
  const port = Number(process.env.PORT);
  return `http://127.0.0.1:${Number.isInteger(port) && port > 0 && port < 65536 ? port : 4319}`;
}

export function mcpUrl(): string {
  return `${baseUrl()}/api/mcp`;
}

const TASK_KEY = /^[A-Z][A-Z0-9]{1,7}-[1-9][0-9]{0,8}$/;
const SESSION_ID = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Keeps text safe for .cmd files, Windows Terminal and shell scripts: letters, digits and . , : _ - · only. */
const safe = (s: string, max = 400) => s.replace(/[^\p{L}\p{N} .,:_\-·]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);

export function kickoffPrompt(task: Task, sessionId: string): string {
  return safe(
    `PacedMind task ${task.key}, session ${sessionId}. Call the organizer MCP tool start_task with task ${task.key} and session ${sessionId}, then follow the instructions it returns.`,
  );
}

function sessionDir(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("Invalid session id");
  const dir = path.join(dataDir(), "sessions", id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function writePrivate(file: string, text: string, mode = 0o600) {
  fs.writeFileSync(file, text, { mode });
}

function writeClaudeConfig(dir: string, sessionId: string, token: string) {
  const mcp = { mcpServers: { organizer: { type: "http", url: mcpUrl(), headers: { Authorization: `Bearer ${token}` } } } };
  const ended = `curl -s -X POST -H "Authorization: Bearer ${token}" ${baseUrl()}/api/sessions/${sessionId}/ended`;
  const settings = { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: ended }] }] } };
  const mcpFile = path.join(dir, "mcp.json");
  const settingsFile = path.join(dir, "settings.json");
  writePrivate(mcpFile, JSON.stringify(mcp, null, 2));
  writePrivate(settingsFile, JSON.stringify(settings, null, 2));
  return { mcpFile, settingsFile };
}

/** Builds the agent command line (without folder/title handling). */
function agentCommand(agent: AgentId, dir: string, session: Session, task: Task, token: string, resume: boolean): string {
  const command = agentCommandFor(agent);
  if (agent === "claude") {
    const { mcpFile, settingsFile } = writeClaudeConfig(dir, session.id, token);
    const allowed = AGENT_ALLOWED_TOOLS.map((t) => `mcp__organizer__${t}`).join(",");
    const base = `${command} --mcp-config "${mcpFile}" --settings "${settingsFile}" --allowedTools ${allowed}`;
    const cli = session.cliSessionId && UUID.test(session.cliSessionId) ? session.cliSessionId : null;
    if (resume && cli) return `${base} --resume ${cli}`;
    const name = safe(`${task.key} ${task.title}`, 80);
    return `${base}${cli ? ` --session-id ${cli}` : ""} -n "${name}" "${kickoffPrompt(task, session.id)}"`;
  }
  if (resume) return `${command} resume`;
  return `${command} "${kickoffPrompt(task, session.id)}"`;
}

/**
 * The environment for agent terminals, without what only this server uses. Otherwise an agent's
 * `npm install` would see NODE_ENV=production, its dev server would try PacedMind's PORT, Electron-based
 * tools would run as plain Node (ELECTRON_RUN_AS_NODE), and agents would see PacedMind's own keys
 * (ORGANIZER_DATA_KEY, ORGANIZER_UI_SECRET).
 */
function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(PORT|HOSTNAME|NODE_ENV|ELECTRON_RUN_AS_NODE|NEXT_.*|__NEXT_.*|TURBOPACK.*|ORGANIZER_.*|SUPABASE_.*)$/i.test(key)) delete env[key];
  }
  return env;
}

function openTerminal(dir: string, folder: string, title: string, command: string, token: string, terminal: "wt" | "cmd"): string | null {
  const env = agentEnv();
  try {
    if (process.platform === "win32") {
      const script = path.join(dir, "start.cmd");
      writePrivate(
        script,
        ["@echo off", "chcp 65001 >nul", `title ${title}`, `cd /d "${folder}"`, `set ORGANIZER_TOKEN=${token}`, command, ""].join("\r\n"),
      );
      if (terminal === "wt") {
        const child = spawn("wt.exe", ["-w", "organizer", "new-tab", "--title", title, "-d", folder, "cmd", "/k", script], {
          detached: true, stdio: "ignore", env,
        });
        child.on("error", () => openCmdWindow(title, script, env));
        child.unref();
      } else {
        openCmdWindow(title, script, env);
      }
      return null;
    }
    const script = path.join(dir, "start.sh");
    writePrivate(script, ["#!/bin/sh", `cd "${folder}"`, `export ORGANIZER_TOKEN=${token}`, command, ""].join("\n"), 0o700);
    const child = process.platform === "darwin"
      ? spawn("open", ["-a", "Terminal", script], { detached: true, stdio: "ignore", env })
      : spawn("x-terminal-emulator", ["-e", script], { detached: true, stdio: "ignore", env });
    child.unref();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function openCmdWindow(title: string, script: string, env: NodeJS.ProcessEnv) {
  spawn("cmd.exe", ["/c", `start "${title}" cmd /k "${script}"`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true, env }).unref();
}

/** Where a task's sessions run here: its project's folder on this computer, else a scratch folder per task. */
export function plannedFolder(task: { key: string; projectId: string | null }): string | null {
  if (!TASK_KEY.test(task.key)) return null;
  return projectFolder(task.projectId) ?? path.join(dataDir(), "workspaces", task.key.toLowerCase());
}

function resolveFolder(task: Task): { folder?: string; error?: string } {
  const own = projectFolder(task.projectId);
  if (own) {
    const problem = folderProblem(own);
    if (problem) return { error: `Can't use the folder ${own}: ${problem} Change it in Settings.` };
    return { folder: own };
  }
  const folder = plannedFolder(task)!;
  fs.mkdirSync(folder, { recursive: true });
  return { folder };
}

/** Deletes the files of sessions that ended (their MCP config holds a token that no longer works anyway). */
export function forgetSessionFiles(sessionIds: string[]) {
  for (const id of sessionIds) {
    if (!SESSION_ID.test(id)) continue;
    try {
      fs.rmSync(path.join(dataDir(), "sessions", id), { recursive: true, force: true });
    } catch {
      // A terminal still reading its start script keeps it; it goes with the next cleanup.
    }
  }
}

/** Refuses what the cloud could have shaped to break out of a command line or a folder path. */
function checkTask(task: Task): string | null {
  if (!TASK_KEY.test(task.key)) return `The task key ${safe(task.key, 20)} isn't in the expected shape, so PacedMind won't start it.`;
  return null;
}

/* One launch at a time, so two paths (a flow and a click, say) can't both start the same task. */
const g = globalThis as unknown as { __pacedmindLaunchLock?: Promise<unknown> };
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__pacedmindLaunchLock ?? Promise.resolve()).then(fn, fn);
  g.__pacedmindLaunchLock = run.catch(() => undefined);
  return run;
}

/** Why the session was started, for its history. */
export type LaunchReason = "you" | "flow" | "approved" | "remote";

const REASON_TEXT: Record<LaunchReason, string> = {
  you: "you started it here",
  flow: "its flow started it",
  approved: "you allowed a request",
  remote: "a request with a fresh 2FA code",
};

/**
 * Opens a new terminal with Claude Code or Codex working on the task. Only for the desktop app: call it from
 * the app's own window, a flow switched on here, or a request that this computer's settings allow. With
 * `expect` (what you allowed), it refuses when the task, agent or folder changed since.
 */
export function startSession(
  taskId: number,
  options: { agent?: AgentId; reason: LaunchReason; expect?: { key: string; agent: AgentId; folder: string } },
): Promise<LaunchResult> {
  return exclusive(async () => {
    if (MODE !== "desktop") return { ok: false, error: "Sessions start in the PacedMind desktop app." };
    const state = await requireAal2();
    const device = deviceFor(state.user.id);
    const task = await repo.getTask(taskId);
    if (!task) return { ok: false, error: "Task not found" };
    const bad = checkTask(task);
    if (bad) return { ok: false, error: bad };
    if (task.agent === "human") return { ok: false, error: `${task.key} is marked as yours. Hand it to Claude Code or Codex before starting a session.` };
    if ((await repo.listSessions({ taskId: task.id, status: LIVE_STATUSES })).length) {
      return { ok: false, error: `${task.key} already has a running session` };
    }
    const project = task.projectId ? await repo.getProject(task.projectId) : null;
    const agent: AgentId = options.agent ?? agentOf(task, project?.agent) ?? "claude";
    if (agent !== "claude" && agent !== "codex") return { ok: false, error: "Unknown agent" };
    const { folder, error } = resolveFolder(task);
    if (!folder) return { ok: false, error };
    const e = options.expect;
    if (e && (e.key !== task.key || e.agent !== agent || e.folder !== folder)) {
      return { ok: false, error: `${task.key} changed after you allowed it (its task, agent or folder). Ask for the session again.` };
    }

    const session = await repo.createSession({
      taskId: task.id, agent, folder, deviceId: device.deviceId, branch: `agent/${task.key.toLowerCase()}`,
      cliSessionId: agent === "claude" ? crypto.randomUUID() : null,
    });
    const token = issueSessionToken(session.id, task.id);
    const dir = sessionDir(session.id);
    const title = safe(`${task.key} · ${AGENT_LABEL[agent]}`, 60);
    const failed = openTerminal(dir, folder, title, agentCommand(agent, dir, session, task, token, false), token, device.terminal);
    if (failed) {
      await repo.updateSession(session.id, { status: "failed", endedAt: session.startedAt, note: failed.slice(0, 2000) });
      await repo.addSessionEvent(session.id, "failed", failed.slice(0, 2000));
      return { ok: false, error: failed };
    }
    await repo.updateSession(session.id, { status: "running" });
    await repo.addSessionEvent(session.id, "started", `Started ${AGENT_LABEL[agent]} in a new terminal: ${REASON_TEXT[options.reason]}`);
    if (task.agent !== agent) await repo.updateTask(task.id, { agent });
    if (task.status === "todo" || task.status === "backlog") await repo.updateTask(task.id, { status: "progress" });
    return { ok: true, session: (await repo.getSession(session.id))! };
  });
}

/** Reopens a terminal for a session that ran on this computer (Claude resumes the same conversation). */
export function resumeSession(sessionId: string): Promise<LaunchResult> {
  return exclusive(async () => {
    if (MODE !== "desktop") return { ok: false, error: "Resume it from the PacedMind desktop app, which opens terminals on your computer." };
    if (!SESSION_ID.test(sessionId)) return { ok: false, error: "Session not found" };
    const state = await requireAal2();
    const device = deviceFor(state.user.id);
    const session = await repo.getSession(sessionId);
    if (!session) return { ok: false, error: "Session not found" };
    if (session.deviceId && session.deviceId !== device.deviceId) {
      return { ok: false, error: "That session ran on another computer. Resume it there." };
    }
    const task = await repo.getTask(session.taskId);
    if (!task) return { ok: false, error: "The task is gone" };
    const bad = checkTask(task);
    if (bad) return { ok: false, error: bad };
    // The folder comes from this computer, never from the session's record in the cloud.
    const { folder, error } = resolveFolder(task);
    if (!folder) return { ok: false, error };
    const token = issueSessionToken(session.id, task.id);
    await repo.updateSession(session.id, { endedAt: null });
    const dir = sessionDir(session.id);
    const title = safe(`${task.key} · ${AGENT_LABEL[session.agent]}`, 60);
    const failed = openTerminal(dir, folder, title, agentCommand(session.agent, dir, session, task, token, true), token, device.terminal);
    if (failed) return { ok: false, error: failed };
    await repo.addSessionEvent(session.id, "resumed", "Reopened in a terminal");
    return { ok: true, session };
  });
}
