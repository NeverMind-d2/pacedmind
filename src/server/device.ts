import "server-only";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readSecureJson, writeSecureJson } from "./secure-file";
import { folderProblem } from "./folders";
import { nowStamp } from "@/lib/dates";
import type { AgentId, RemoteStart, TerminalId } from "@/lib/types";

/*
 * What this computer decides for itself, never the cloud: how agents start (commands, terminal), where each
 * project's and task's sessions run, which projects' flows may start sessions on their own, what happens to
 * sessions requested from elsewhere, and the MCP tokens agents use. It lives in an encrypted file next to the
 * app's data (secure-file.ts), so nothing a browser, another computer or a compromised database writes can
 * change what runs here. Only the desktop app's own window (see proxy.ts) changes it.
 */

export interface DeviceConfig {
  /** The account these settings belong to. Another account signing in starts from the defaults. */
  userId: string | null;
  /** This computer in the account's list (the devices table), once registered. */
  deviceId: string | null;
  /** The auth session the devices row was last pointed at (claim_device). */
  claimedSession: string | null;
  name: string;
  terminal: TerminalId;
  claudeCommand: string;
  codexCommand: string;
  /** Project id → the folder its sessions run in. */
  folders: Record<string, string>;
  /**
   * Task → its own folder (a workspace), for tasks that don't run in their project's folder. Keyed by
   * taskFolderKey: the account's tasks and this computer's own (the free plan's) are numbered separately.
   */
  taskFolders: Record<string, string>;
  /** Projects whose flows may start sessions on this computer by themselves. */
  armed: string[];
  /**
   * Per project whose flow is on: its connections ("from>to:mode", see flowSignature) and the project it
   * starts after, as they were when you switched the flow on or last changed it in this window. A flow only
   * starts sessions by itself along these; anything added elsewhere (an agent, the web app, another
   * computer) asks you first.
   */
  confirmed: Record<string, { edges: string[]; after: string | null }>;
  remoteStart: RemoteStart;
  /** For Claude Code and Codex that you start yourself (Settings shows it). */
  ownerToken: string;
  /**
   * Tokens of the sessions PacedMind started, by SHA-256 hash: each works for its session's task until the
   * session ends, is finished or done, or a day has passed.
   */
  sessionTokens: Record<string, { sessionId: string; taskId: number; issuedAt: string; expires?: number }>;
  /** Once the import of the folders you work in with Claude Code and Codex was offered here (it opens by itself once). */
  importOffered: boolean;
}

export const dataDir = () =>
  process.env.ORGANIZER_DB ? path.dirname(process.env.ORGANIZER_DB) : path.join(/*turbopackIgnore: true*/ process.cwd(), "data");

const file = () => path.join(/*turbopackIgnore: true*/ dataDir(), "device.json");

const newOwnerToken = () => `pm_${crypto.randomBytes(32).toString("base64url")}`;
const hash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function defaults(userId: string | null, keep?: DeviceConfig): DeviceConfig {
  return {
    userId,
    deviceId: null,
    claimedSession: null,
    name: keep?.name ?? os.hostname().slice(0, 80) ?? "This computer",
    terminal: keep?.terminal ?? (process.platform === "darwin" ? "terminal" : "wt"),
    claudeCommand: keep?.claudeCommand ?? "claude",
    codexCommand: keep?.codexCommand ?? "codex",
    folders: {},
    taskFolders: {},
    armed: [],
    confirmed: {},
    remoteStart: "ask",
    ownerToken: newOwnerToken(),
    sessionTokens: {},
    importOffered: false,
  };
}

const g = globalThis as unknown as { __pacedmindDevice?: DeviceConfig };

export function deviceConfig(): DeviceConfig {
  if (!g.__pacedmindDevice) g.__pacedmindDevice = { ...defaults(null), ...(readSecureJson<Partial<DeviceConfig>>(file()) ?? {}) };
  return g.__pacedmindDevice;
}

function save(next: DeviceConfig) {
  writeSecureJson(file(), next);
  g.__pacedmindDevice = next;
}

export function updateDevice(patch: Partial<DeviceConfig>) {
  save({ ...deviceConfig(), ...patch });
}

/**
 * Makes sure the settings belong to `userId`. The first account to sign in on this computer takes over what
 * was set up here without one (the free plan's folders, flow switches, agent commands and MCP token), so
 * moving this computer's data to Cloud keeps them; the free plan's sessions lose their tokens, since their
 * sessions stay behind. When another account signs in later, everything starts over, so nothing carries
 * across accounts.
 */
export function deviceFor(userId: string): DeviceConfig {
  const current = deviceConfig();
  if (current.userId === userId) return current;
  const next = current.userId === null
    ? { ...current, userId, deviceId: null, claimedSession: null, sessionTokens: {} }
    : defaults(userId, current);
  save(next);
  return next;
}

/* ---------- commands and terminal ---------- */

/** Characters cmd.exe and sh treat specially; an agent command never needs them. */
const UNSAFE_COMMAND = /[&|<>^%!`$;()\r\n\u0000-\u001f]/;

export function commandProblem(command: string): string | null {
  const c = command.trim();
  if (!c) return "Enter the command that starts the agent, like claude.";
  if (c.length > 300) return "That command is too long.";
  if (UNSAFE_COMMAND.test(c)) return "Use a plain command with its options; & | < > ^ % ! ` $ ; and brackets aren't allowed.";
  return null;
}

export function agentCommandFor(agent: AgentId): string {
  const d = deviceConfig();
  const command = agent === "claude" ? d.claudeCommand : d.codexCommand;
  // The file could have been edited by hand; never run what the settings screen would have refused.
  return commandProblem(command) ? agent : command.trim();
}

/* ---------- folders and flows ---------- */

export const projectFolder = (projectId: string | null | undefined): string | null =>
  (projectId && deviceConfig().folders[projectId]) || null;

/** Sets or clears where a project's sessions run on this computer. Returns why it can't, or null. */
export function setProjectFolder(projectId: string, folder: string | null): string | null {
  const d = deviceConfig();
  const folders = { ...d.folders };
  if (folder) {
    const problem = folderProblem(folder);
    if (problem) return problem;
    folders[projectId] = folder;
  } else {
    delete folders[projectId];
  }
  // A project's flow runs unattended in its folder; after the folder changes you switch it on again.
  const moved = folders[projectId] !== d.folders[projectId];
  const armed = moved ? d.armed.filter((id) => id !== projectId) : d.armed;
  const confirmed = { ...(d.confirmed ?? {}) };
  if (moved) delete confirmed[projectId];
  save({ ...d, folders, armed, confirmed });
  return null;
}

/** Which tasks a task id belongs to: the signed-in account's (Cloud), or this computer's own. */
export type TaskScope = "cloud" | "local";

/** Both number their tasks from 1, so this computer's own tasks get a prefix. */
const taskFolderKey = (scope: TaskScope, taskId: number) => (scope === "local" ? `local:${taskId}` : String(taskId));

/** A task's own folder on this computer, when it doesn't run in its project's. */
export const taskFolder = (scope: TaskScope, taskId: number): string | null => deviceConfig().taskFolders?.[taskFolderKey(scope, taskId)] ?? null;

/** Sets or clears a task's own folder on this computer. Returns why it can't, or null. */
export function setTaskFolder(scope: TaskScope, taskId: number, folder: string | null): string | null {
  const d = deviceConfig();
  const taskFolders = { ...(d.taskFolders ?? {}) };
  const key = taskFolderKey(scope, taskId);
  if (folder) {
    const problem = folderProblem(folder);
    if (problem) return problem;
    taskFolders[key] = folder;
  } else {
    delete taskFolders[key];
  }
  save({ ...d, taskFolders });
  return null;
}

/** Forgets a deleted task's folder. */
export function forgetTask(scope: TaskScope, taskId: number) {
  const d = deviceConfig();
  const key = taskFolderKey(scope, taskId);
  if (!d.taskFolders?.[key]) return;
  const taskFolders = { ...d.taskFolders };
  delete taskFolders[key];
  save({ ...d, taskFolders });
}

/**
 * Forgets the folders and flow switches of these projects, and every task folder of `scope`: after the
 * account's data or this computer's own was started over, or this computer's was moved to Cloud.
 */
export function forgetAll(scope: TaskScope, projectIds: string[]) {
  const d = deviceConfig();
  const gone = new Set(projectIds);
  const local = (key: string) => key.startsWith("local:");
  const folders = Object.fromEntries(Object.entries(d.folders).filter(([id]) => !gone.has(id)));
  const taskFolders = Object.fromEntries(Object.entries(d.taskFolders ?? {}).filter(([key]) => local(key) !== (scope === "local")));
  const confirmed = Object.fromEntries(Object.entries(d.confirmed ?? {}).filter(([id]) => !gone.has(id)));
  save({ ...d, folders, taskFolders, armed: d.armed.filter((id) => !gone.has(id)), confirmed });
}

export const flowArmed = (projectId: string | null | undefined) => !!projectId && deviceConfig().armed.includes(projectId);

/**
 * Switches a project's flow on (with its connections as they are now, `snapshot`) or off. Only the desktop
 * window calls this: MCP and the web app can't switch flows.
 */
export function setFlowArmed(projectId: string, on: boolean, snapshot?: { edges: string[]; after: string | null }) {
  const d = deviceConfig();
  const armed = d.armed.filter((id) => id !== projectId);
  const confirmed = { ...(d.confirmed ?? {}) };
  delete confirmed[projectId];
  if (on) {
    armed.push(projectId);
    confirmed[projectId] = snapshot ?? { edges: [], after: null };
  }
  save({ ...d, armed, confirmed });
}

/** The flow's connections as you confirmed them on this computer, or null when its flow is off. */
export function confirmedFlow(projectId: string | null | undefined): { edges: string[]; after: string | null } | null {
  if (!projectId || !flowArmed(projectId)) return null;
  return deviceConfig().confirmed?.[projectId] ?? { edges: [], after: null };
}

/** Records a flow's connections again after you changed them in this window (only while it's on). */
export function reconfirmFlow(projectId: string, snapshot: { edges: string[]; after: string | null }) {
  const d = deviceConfig();
  if (!d.armed.includes(projectId)) return;
  save({ ...d, confirmed: { ...(d.confirmed ?? {}), [projectId]: snapshot } });
}

/** Forgets a deleted project's folder and flow switch. */
export function forgetProject(projectId: string) {
  const d = deviceConfig();
  if (!(projectId in d.folders) && !d.armed.includes(projectId)) return;
  const folders = { ...d.folders };
  delete folders[projectId];
  const confirmed = { ...(d.confirmed ?? {}) };
  delete confirmed[projectId];
  save({ ...d, folders, armed: d.armed.filter((id) => id !== projectId), confirmed });
}

/* ---------- MCP tokens ---------- */

/** Who an MCP request acts for: you (your own agents) or one session PacedMind started. */
export type Principal = { kind: "owner" } | { kind: "session"; sessionId: string; taskId: number };

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(hash(a), "hex");
  const y = Buffer.from(hash(b), "hex");
  return crypto.timingSafeEqual(x, y);
}

export function principalFor(token: string): Principal | null {
  if (!token || token.length > 200) return null;
  const d = deviceConfig();
  if (d.ownerToken && sameToken(token, d.ownerToken)) return { kind: "owner" };
  const s = d.sessionTokens[hash(token)];
  if (!s) return null;
  if (!s.expires || s.expires <= Date.now()) {
    revokeSessionTokens([s.sessionId]);
    return null;
  }
  return { kind: "session", sessionId: s.sessionId, taskId: s.taskId };
}

const SESSION_TOKEN_TTL = 24 * 60 * 60_000;

export function rotateOwnerToken(): string {
  const token = newOwnerToken();
  updateDevice({ ownerToken: token });
  return token;
}

/** A token for one session's agent: it works for that session's tools until the session ends. */
export function issueSessionToken(sessionId: string, taskId: number): string {
  const token = `pms_${crypto.randomBytes(32).toString("base64url")}`;
  const d = deviceConfig();
  // Keep the file small: a session only ever needs its latest token.
  const sessionTokens = Object.fromEntries(Object.entries(d.sessionTokens).filter(([, v]) => v.sessionId !== sessionId));
  sessionTokens[hash(token)] = { sessionId, taskId, issuedAt: nowStamp(), expires: Date.now() + SESSION_TOKEN_TTL };
  save({ ...d, sessionTokens });
  return token;
}

/** Called when a session's terminal closes or you close the session: its agent loses access. */
export function revokeSessionTokens(sessionIds: string[]) {
  const d = deviceConfig();
  const ids = new Set(sessionIds);
  const sessionTokens = Object.fromEntries(Object.entries(d.sessionTokens).filter(([, v]) => !ids.has(v.sessionId)));
  if (Object.keys(sessionTokens).length !== Object.keys(d.sessionTokens).length) save({ ...d, sessionTokens });
}

/** Every session token at once: signing out, or this computer being signed out elsewhere. */
export function revokeAllSessionTokens() {
  const d = deviceConfig();
  if (Object.keys(d.sessionTokens).length) save({ ...d, sessionTokens: {} });
}

/** A session that continues in the same terminal (a "same session" connection) works on the next task. */
export function moveSessionToken(fromSessionId: string, toSessionId: string, taskId: number) {
  const d = deviceConfig();
  const sessionTokens = Object.fromEntries(Object.entries(d.sessionTokens).map(([h, v]) =>
    [h, v.sessionId === fromSessionId ? { ...v, sessionId: toSessionId, taskId } : v]));
  save({ ...d, sessionTokens });
}

export function thisPlatform(): "windows" | "macos" | "linux" {
  return process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";
}
