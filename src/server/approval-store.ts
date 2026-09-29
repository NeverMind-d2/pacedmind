import "server-only";
import type { AgentId, FolderTargetKind, LaunchRequestKind, Surface } from "@/lib/types";

/*
 * What waits for you to allow it in this computer's PacedMind window: sessions (requests.ts decides what goes in) and
 * folders (folder-requests.ts). A separate module, so that signing out anywhere (supabase.ts) can clear them without
 * importing the launcher.
 */

/**
 * Who asked: the web app or another computer (a person), an agent over this computer's MCP server, or an agent from
 * elsewhere (signed in to PacedMind Cloud, or on another computer).
 */
export type ApprovalFrom = "elsewhere" | "agent" | "agentElsewhere";

/** A session waiting for you, with what it would run as you saw it: launching refuses if any of it changed. */
export interface Approval {
  modelSettings: import("@/lib/agent-models").ModelSelection | null;
  id: string;
  /** The launch request it answers, or null when it's this computer's own (an agent over MCP). */
  requestId: string | null;
  from: ApprovalFrom;
  /** Start a new session, resume one, or send one back to its agent with changes. */
  kind: LaunchRequestKind;
  taskId: number;
  key: string;
  agent: AgentId;
  folder: string;
  /** Where it would run: a terminal or the agent's app here, or the agent's cloud. */
  surface: Surface;
  /** For sending a session back to work: the session and what should change (untrusted text the agent reads). */
  changes?: { sessionId: string; text: string };
  /** For resuming a session: which one, and "desktop" when a terminal conversation moves into the Claude app. */
  resume?: { sessionId: string; to?: Surface };
  /** For starting one: what its task needs that the agent doesn't have here (Task.needs), by name. */
  missing?: string[];
  requestedAt: number;
  expiresAt: number;
}

/** A folder waiting for you: set for a project, an area or a task on this computer once you allow it. */
export interface FolderApproval {
  id: string;
  /** The folder request it answers, or null when an agent asked over this computer's own MCP server. */
  requestId: string | null;
  from: ApprovalFrom;
  target: { kind: FolderTargetKind; id: string };
  /** What gets the folder, as you were shown it ("Organizer app", "DEV-12 Fix the login"). */
  name: string;
  /** The folder as asked for, checked when it was asked and again when you allow it. */
  folder: string;
  requestedAt: number;
  expiresAt: number;
}

const g = globalThis as unknown as {
  __pacedmindApprovals?: Map<string, Approval>;
  __pacedmindHandled?: Set<string>;
  __pacedmindFolderApprovals?: Map<string, FolderApproval>;
  __pacedmindFoldersHandled?: Set<string>;
};

export const approvals = () => (g.__pacedmindApprovals ??= new Map());

/** Launch requests this computer already decided: never acted on twice, whatever the cloud says later. */
export const handledRequests = () => (g.__pacedmindHandled ??= new Set());

export const folderApprovals = () => (g.__pacedmindFolderApprovals ??= new Map());

/** Folder requests this computer already put in front of you (or settled): never asked twice. */
export const handledFolderRequests = () => (g.__pacedmindFoldersHandled ??= new Set());

export function clearApprovals() {
  approvals().clear();
  folderApprovals().clear();
}
