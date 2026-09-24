import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { dbPath } from "./db";
import * as repo from "./repo";
import { AGENT_LABEL, type AgentId, type Session, type Task } from "@/lib/types";

export interface LaunchResult {
  ok: boolean;
  session?: Session;
  error?: string;
}

/** Where agents reach this server. Next sets PORT to the port it listens on (the app uses 4319, `npm run dev` 4320). */
export function baseUrl(): string {
  return `http://127.0.0.1:${process.env.PORT || repo.getSettings().port}`;
}

export function mcpUrl(): string {
  return `${baseUrl()}/api/mcp`;
}

const dataDir = () => path.dirname(dbPath());
/** Keeps text safe for .cmd files, Windows Terminal and shell scripts. */
const safe = (s: string, max = 400) => s.replace(/[^\p{L}\p{N} .,:_-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);

export function kickoffPrompt(task: Task, sessionId: string): string {
  return safe(
    `Organizer task ${task.key}, session ${sessionId}. Call the organizer MCP tool start_task with task ${task.key} and session ${sessionId}, then follow the instructions it returns.`,
  );
}

function sessionDir(id: string): string {
  const dir = path.join(dataDir(), "sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeClaudeConfig(dir: string, sessionId: string, token: string) {
  const mcp = { mcpServers: { organizer: { type: "http", url: mcpUrl(), headers: { Authorization: `Bearer ${token}` } } } };
  const ended = `curl -s -X POST -H "Authorization: Bearer ${token}" ${baseUrl()}/api/sessions/${sessionId}/ended`;
  const settings = { hooks: { SessionEnd: [{ hooks: [{ type: "command", command: ended }] }] } };
  const mcpFile = path.join(dir, "mcp.json");
  const settingsFile = path.join(dir, "settings.json");
  fs.writeFileSync(mcpFile, JSON.stringify(mcp, null, 2));
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
  return { mcpFile, settingsFile };
}

/** Builds the agent command line (without folder/title handling). */
function agentCommand(agent: AgentId, dir: string, session: Session, task: Task, resume: boolean): string {
  const s = repo.getSettings();
  if (agent === "claude") {
    const { mcpFile, settingsFile } = writeClaudeConfig(dir, session.id, s.mcpToken);
    const base = `${s.claudeCommand} --mcp-config "${mcpFile}" --settings "${settingsFile}" --allowedTools mcp__organizer`;
    if (resume && session.cliSessionId) return `${base} --resume ${session.cliSessionId}`;
    const name = safe(`${task.key} ${task.title}`, 80);
    return `${base} --session-id ${session.cliSessionId} -n "${name}" "${kickoffPrompt(task, session.id)}"`;
  }
  if (resume) return `${s.codexCommand} resume`;
  return `${s.codexCommand} "${kickoffPrompt(task, session.id)}"`;
}

/**
 * The environment for agent terminals, without what only this server uses. Otherwise an agent's
 * `npm install` would see NODE_ENV=production, its dev server would try Organizer's PORT, and
 * Electron-based tools would run as plain Node (ELECTRON_RUN_AS_NODE, set by the desktop app).
 */
function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(PORT|HOSTNAME|NODE_ENV|ELECTRON_RUN_AS_NODE|NEXT_.*|__NEXT_.*|TURBOPACK.*|ORGANIZER_.*)$/i.test(key)) delete env[key];
  }
  return env;
}

function openTerminal(dir: string, folder: string, title: string, command: string): string | null {
  const token = repo.getSettings().mcpToken;
  const env = agentEnv();
  try {
    if (process.platform === "win32") {
      const script = path.join(dir, "start.cmd");
      fs.writeFileSync(
        script,
        ["@echo off", "chcp 65001 >nul", `title ${title}`, `cd /d "${folder}"`, `set ORGANIZER_TOKEN=${token}`, command, ""].join("\r\n"),
      );
      if (repo.getSettings().terminal === "wt") {
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
    fs.writeFileSync(script, ["#!/bin/sh", `cd "${folder}"`, `export ORGANIZER_TOKEN=${token}`, command, ""].join("\n"), { mode: 0o755 });
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

function resolveFolder(task: Task): { folder?: string; error?: string } {
  const project = task.projectId ? repo.getProject(task.projectId) : null;
  if (project?.folder) {
    if (!fs.existsSync(project.folder)) return { error: `Folder not found: ${project.folder}. Change it in Settings.` };
    return { folder: project.folder };
  }
  const folder = path.join(dataDir(), "workspaces", task.key.toLowerCase());
  fs.mkdirSync(folder, { recursive: true });
  return { folder };
}

/** Opens a new terminal with Claude Code or Codex working on the task. */
export function startSession(taskId: number, agentOverride?: AgentId): LaunchResult {
  const task = repo.getTask(taskId);
  if (!task) return { ok: false, error: "Task not found" };
  const active = repo.listSessions("task_id = ? AND status IN ('starting', 'running')", task.id);
  if (active.length) return { ok: false, error: `${task.key} already has a running session` };
  const project = task.projectId ? repo.getProject(task.projectId) : null;
  const agent: AgentId = agentOverride ?? task.agent ?? project?.agent ?? "claude";
  const { folder, error } = resolveFolder(task);
  if (!folder) return { ok: false, error };

  const session = repo.createSession({
    taskId: task.id, agent, folder, branch: `agent/${task.key.toLowerCase()}`,
    cliSessionId: agent === "claude" ? crypto.randomUUID() : null,
  });
  const dir = sessionDir(session.id);
  const title = `${task.key} · ${AGENT_LABEL[agent]}`;
  const failed = openTerminal(dir, folder, title, agentCommand(agent, dir, session, task, false));
  if (failed) {
    repo.updateSession(session.id, { status: "failed", endedAt: session.startedAt, note: failed });
    repo.addSessionEvent(session.id, "failed", failed);
    return { ok: false, error: failed };
  }
  repo.updateSession(session.id, { status: "running" });
  repo.addSessionEvent(session.id, "started", `Started ${AGENT_LABEL[agent]} in a new terminal`);
  if (task.agent !== agent) repo.updateTask(task.id, { agent });
  if (task.status === "todo" || task.status === "backlog") repo.updateTask(task.id, { status: "progress" });
  return { ok: true, session: repo.getSession(session.id)! };
}

/** Reopens a terminal for an existing session (Claude resumes the same conversation). */
export function resumeSession(sessionId: string): LaunchResult {
  const session = repo.getSession(sessionId);
  if (!session) return { ok: false, error: "Session not found" };
  const task = repo.getTask(session.taskId);
  if (!task || !session.folder) return { ok: false, error: "The task or its folder is gone" };
  const dir = sessionDir(session.id);
  const failed = openTerminal(dir, session.folder, `${task.key} · ${AGENT_LABEL[session.agent]}`, agentCommand(session.agent, dir, session, task, true));
  if (failed) return { ok: false, error: failed };
  repo.addSessionEvent(session.id, "resumed", "Reopened in a terminal");
  return { ok: true, session };
}
