import "server-only";
import crypto from "node:crypto";
import * as repo from "./repo";
import { forgetSessionFiles, plannedFolder, plannedSurface, startSession, type LaunchResult } from "./launcher";
import { deviceConfig, deviceFor, revokeAllSessionTokens, thisPlatform, updateDevice } from "./device";
import { approvals, clearApprovals, handledRequests, type Approval } from "./approval-store";
import { requestChanges } from "./ops";
import { MODE, authState, supabase } from "./supabase";
import { AGENT_LABEL, SURFACE_LABEL, agentOf, type AgentId, type Session, type Surface, type Task } from "@/lib/types";

/*
 * Sessions asked for from outside this computer's PacedMind window: from the web app or another computer
 * (a launch request in the cloud, which the database only accepts with a two-factor code from the last five
 * minutes, from an authenticator older than the asking session), from an agent over MCP, or from a flow along
 * a connection you haven't confirmed here. What happens to requests from elsewhere is this computer's
 * setting (device.ts):
 * - off: refused;
 * - ask (the default): the request waits here until you allow or refuse it in the app;
 * - auto: started right away.
 * Agents over MCP and unconfirmed flow connections always wait for you. Each approval keeps the task, agent
 * and folder you were shown, and launching refuses if any of them changed in between.
 */

const TTL_MS = 10 * 60_000;

export type { Approval };

export function pendingApprovals(): Approval[] {
  const now = Date.now();
  for (const [id, a] of approvals()) if (a.expiresAt <= now) approvals().delete(id);
  return [...approvals().values()].sort((a, b) => a.requestedAt - b.requestedAt);
}

/** What the app shows for a waiting request: which task, which agent, where it would run, who asked. */
export interface ApprovalItem {
  id: string;
  key: string;
  title: string;
  agent: string;
  folder: string;
  from: string;
  requestedAt: number;
  expiresAt: number;
}

const FROM_TEXT: Record<Approval["from"], string> = {
  elsewhere: "the web app or another computer",
  agent: "an agent over MCP",
  flow: "its flow, along a connection you haven't confirmed on this computer",
};

export function approvalItems(tasks: Task[]): ApprovalItem[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return pendingApprovals().map((a) => ({
    id: a.id, key: a.key, title: byId.get(a.taskId)?.title ?? "", agent: `${AGENT_LABEL[a.agent]} · ${SURFACE_LABEL[a.surface]}`, folder: a.folder,
    from: a.changes ? `${FROM_TEXT[a.from]}, sending the session back with changes: “${excerpt(a.changes.text)}”` : FROM_TEXT[a.from],
    requestedAt: a.requestedAt, expiresAt: a.expiresAt,
  }));
}

const excerpt = (text: string) => (text.length > 200 ? `${text.slice(0, 200).trimEnd()}…` : text);

/** Puts a request in front of you, with what it would run right now. Null when the task can't run here at all. */
async function ask(
  task: Task, agent: AgentId | null, from: Approval["from"], requestId: string | null, times?: { at: number; until: number }, surface?: Surface,
): Promise<Approval | null> {
  const project = task.projectId ? await repo.getProject(task.projectId) : null;
  const who = agent ?? agentOf(task, project?.agent);
  const folder = plannedFolder(task);
  if (!who || !folder) return null;
  const same = pendingApprovals().find((a) => a.taskId === task.id && a.from === from && a.requestId === requestId && !a.changes);
  if (same) return same;
  const now = Date.now();
  const a: Approval = {
    id: requestId ?? crypto.randomUUID(), requestId, from, taskId: task.id, key: task.key, agent: who, folder, surface: surface ?? plannedSurface(task, who),
    requestedAt: times?.at ?? now, expiresAt: times?.until ?? now + TTL_MS,
  };
  approvals().set(a.id, a);
  return a;
}

/** An agent asked over MCP to start a session (where it runs, if it said): it waits for you in the app. */
export const askFromAgent = (task: Task, agent: AgentId | null, surface?: Surface) => ask(task, agent, "agent", null, undefined, surface);

/** A flow wants to start a task along a connection you haven't confirmed on this computer. */
export const askFromFlow = (task: Task) => ask(task, null, "flow", null);

/**
 * An agent asked over MCP to send a session back to work with changes (request_changes): reopening it runs an agent
 * here, so it waits for you like a session it asks for. The changes are written when you allow it.
 */
export async function askForChanges(session: Session, task: Task, text: string): Promise<Approval | null> {
  const folder = plannedFolder(task);
  if (!folder) return null;
  for (const [id, x] of approvals()) if (x.changes?.sessionId === session.id) approvals().delete(id);
  const now = Date.now();
  const a: Approval = {
    id: crypto.randomUUID(), requestId: null, from: "agent", taskId: task.id, key: task.key, agent: session.agent, folder, surface: "terminal",
    changes: { sessionId: session.id, text }, requestedAt: now, expiresAt: now + TTL_MS,
  };
  approvals().set(a.id, a);
  return a;
}

export async function approve(id: string): Promise<LaunchResult> {
  const a = approvals().get(id);
  approvals().delete(id);
  if (!a || a.expiresAt <= Date.now()) return { ok: false, error: "That request expired. Ask for the session again." };
  if (a.changes) {
    const task = await repo.getTask(a.taskId);
    if (!task || task.key !== a.key || plannedFolder(task) !== a.folder) {
      return { ok: false, error: `${a.key} changed after you saw the request (its task or folder). Ask for the changes again.` };
    }
    return requestChanges(a.changes.sessionId, a.changes.text);
  }
  const r = await startSession(a.taskId, {
    agent: a.agent, surface: a.surface, reason: "approved", expect: { key: a.key, agent: a.agent, folder: a.folder, surface: a.surface },
  });
  if (a.requestId) await repo.settleLaunchRequest(a.requestId, r.ok ? "launched" : "failed", { sessionId: r.session?.id, note: r.error });
  return r;
}

export async function deny(id: string) {
  const a = approvals().get(id);
  approvals().delete(id);
  if (a?.requestId) await repo.settleLaunchRequest(a.requestId, "denied", { note: "Refused on the computer" });
}

const g = globalThis as unknown as { __pacedmindSeen?: number };

/**
 * The desktop app's side of the account, every few seconds: registers this computer, notices when it was
 * signed out from elsewhere, and handles the launch requests sent to it, each exactly once.
 */
export async function syncDevice(): Promise<void> {
  if (MODE !== "desktop") return;
  const state = await authState();
  if (!state || state.aal !== "aal2") return;
  let d = deviceFor(state.user.id);

  if (!d.deviceId) {
    updateDevice({ deviceId: await repo.registerDevice(d.name, thisPlatform()), claimedSession: state.sessionId });
    d = deviceConfig();
  } else if (state.sessionId && d.claimedSession !== state.sessionId) {
    try {
      await repo.claimDevice(d.deviceId);
      updateDevice({ claimedSession: state.sessionId });
    } catch {
      // Signed out from another device while this one was away: register again as a new computer.
      updateDevice({ deviceId: await repo.registerDevice(d.name, thisPlatform()), claimedSession: state.sessionId });
    }
    d = deviceConfig();
  }

  // Once a minute: are we still signed in (revoking a device ends its session, and the database then shows
  // it nothing), and tell the account we're here.
  const now = Date.now();
  if (!g.__pacedmindSeen || now - g.__pacedmindSeen > 60_000) {
    const me = await repo.getDevice(d.deviceId!);
    if (!me || me.revokedAt) return signOutHere();
    await repo.updateDeviceRow(d.deviceId!, { lastSeen: true, ...(me.remoteStart !== d.remoteStart ? { remoteStart: d.remoteStart } : {}) });
    g.__pacedmindSeen = now;
  }

  const pending = await repo.listLaunchRequests({ deviceId: d.deviceId!, status: ["pending"] });
  const open = new Set(pending.map((r) => r.id));
  for (const [id, a] of approvals()) if (a.requestId && !open.has(a.requestId)) approvals().delete(id);
  pendingApprovals(); // drops the ones that expired
  for (const r of pending) {
    if (handledRequests().has(r.id) || approvals().has(r.id)) {
      // Asked here but never answered: it ran out of time.
      if (Date.parse(r.expiresAt) <= now && !approvals().has(r.id)) await repo.settleLaunchRequest(r.id, "expired");
      continue;
    }
    // Whatever happens next, this request is this computer's to decide once.
    handledRequests().add(r.id);
    const settle = (status: "launched" | "failed" | "denied" | "expired", extra?: { sessionId?: string | null; note?: string | null }) =>
      repo.settleLaunchRequest(r.id, status, extra);
    if (Date.parse(r.expiresAt) <= now) {
      await settle("expired");
      continue;
    }
    if (d.remoteStart === "off") {
      await settle("denied", { note: "Starting sessions from elsewhere is off on this computer" });
      continue;
    }
    const task = await repo.getTask(r.taskId);
    if (!task) {
      await settle("failed", { note: "The task is gone" });
    } else if (d.remoteStart === "auto") {
      const res = await startSession(r.taskId, { agent: r.agent, reason: "remote" });
      await settle(res.ok ? "launched" : "failed", { sessionId: res.session?.id, note: res.error });
    } else if (!(await ask(task, r.agent, "elsewhere", r.id, { at: Date.parse(r.requestedAt), until: Date.parse(r.expiresAt) }))) {
      await settle("failed", { note: "That task can't run on this computer" });
    }
  }
}

/** Signing out here, or this computer signed out from elsewhere: its agents lose PacedMind at once. */
export function cutOffAgents() {
  forgetSessionFiles(Object.values(deviceConfig().sessionTokens).map((t) => t.sessionId));
  revokeAllSessionTokens();
  clearApprovals();
}

async function signOutHere() {
  cutOffAgents();
  updateDevice({ deviceId: null, claimedSession: null });
  g.__pacedmindSeen = undefined;
  await (await supabase()).auth.signOut({ scope: "local" });
}
