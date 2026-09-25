export type Status = "backlog" | "todo" | "progress" | "review" | "done" | "canceled";
/** Linear-style priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export type Priority = 0 | 1 | 2 | 3 | 4;
export type AgentId = "claude" | "codex";
/** Who does a task: an agent, or you ("human"). Tasks that are yours stay out of flows and agent sessions. */
export type Doer = AgentId | "human";
/** How the target task's session starts once the source task is ready. */
export type EdgeMode = "auto" | "manual" | "session" | "time";
export type SessionStatus = "starting" | "running" | "finished" | "done" | "closed" | "failed";

/** A session that is (about to be) at work in a terminal. */
export const isLiveSession = (s: { status: SessionStatus }) => s.status === "starting" || s.status === "running";
export const LIVE_STATUSES: SessionStatus[] = ["starting", "running"];

/**
 * What a desktop app does with a session asked for from elsewhere (the web app, another computer): refuse
 * it, ask you on that computer first, or start it right away (the request always needs a fresh 2FA code).
 */
export type RemoteStart = "off" | "ask" | "auto";

export interface Area {
  id: string;
  name: string;
  key: string;
  color: string;
  sort: number;
}

export interface Project {
  id: string;
  areaId: string;
  name: string;
  /** Own color; null means the area's color is used. */
  color: string | null;
  startDate: string | null;
  targetDate: string | null;
  /** Where its sessions run on this computer; set in the desktop app, never stored in the cloud. */
  folder: string | null;
  agent: AgentId | null;
  afterProjectId: string | null;
  /** Whether its flow may start sessions on this computer by itself (a switch in the desktop app). */
  flowOn: boolean;
  sort: number;
}

export interface Subtask {
  id: number;
  taskId: number;
  title: string;
  done: boolean;
  sort: number;
}

export interface Task {
  id: number;
  key: string;
  areaId: string | null;
  projectId: string | null;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  /** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local time). */
  dueDate: string | null;
  /** "YYYY-MM-DD": the day you mean to work on it. */
  plannedDate: string | null;
  estimateMin: number;
  labels: string[];
  reminder: string | null;
  agent: Doer | null;
  sortOrder: number;
  flowX: number | null;
  flowY: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  subtasks: Subtask[];
}

export interface CalEvent {
  id: number;
  title: string;
  areaId: string | null;
  /** "YYYY-MM-DDTHH:mm" local. For weekly events this is the first occurrence. */
  start: string;
  end: string;
  recurrence: "weekly" | null;
}

/** One concrete occurrence of a CalEvent within a range. */
export interface EventOccurrence {
  eventId: number;
  title: string;
  areaId: string | null;
  start: string;
  end: string;
}

export interface Session {
  id: string;
  taskId: number;
  agent: AgentId;
  /** The computer it runs on. */
  deviceId: string | null;
  folder: string | null;
  branch: string | null;
  status: SessionStatus;
  startedAt: string;
  finishedAt: string | null;
  endedAt: string | null;
  note: string | null;
  cliSessionId: string | null;
  continuesSessionId: string | null;
}

export interface SessionEvent {
  id: number;
  sessionId: string;
  at: string;
  kind: string;
  text: string;
}

export interface FlowEdge {
  id: number;
  fromTaskId: number;
  toTaskId: number;
  mode: EdgeMode;
  /** For mode "time": "YYYY-MM-DDTHH:mm". */
  atTime: string | null;
}

/** Planning settings, stored with the account. How sessions start is per computer (DeviceSettings). */
export interface Settings {
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
  workDays: number[];
}

/** What the desktop app on this computer decides for itself (src/server/device.ts), as Settings shows it. */
export interface DeviceSettings {
  name: string;
  terminal: "wt" | "cmd";
  claudeCommand: string;
  codexCommand: string;
  remoteStart: RemoteStart;
  /** This computer's id in the account's list, once registered. */
  deviceId: string | null;
  /** Whether the app's secrets on disk are encrypted with a key from the OS keychain. */
  encrypted: boolean;
}

/** A computer with the desktop app, signed in to the account. */
export interface Device {
  id: string;
  name: string;
  platform: "windows" | "macos" | "linux";
  remoteStart: RemoteStart;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export type LaunchRequestStatus = "pending" | "launched" | "denied" | "expired" | "failed" | "canceled";

/** A session asked for from elsewhere, waiting for (or decided by) the desktop app on `deviceId`. */
export interface LaunchRequest {
  id: string;
  deviceId: string;
  taskId: number;
  agent: AgentId;
  requestedVia: string;
  requestedAt: string;
  expiresAt: string;
  status: LaunchRequestStatus;
  decidedAt: string | null;
  sessionId: string | null;
  note: string | null;
}

/** What task lists and the detail panel need besides the tasks themselves. */
export interface TaskContext {
  areas: Area[];
  projects: Project[];
  /** Latest session per task id. */
  sessions: Record<number, Session>;
  sessionEvents: Record<string, SessionEvent[]>;
}

/** Task counts per area and project, for the sidebar, the overview and delete confirmations. */
export interface Usage {
  areas: Record<string, { projects: number; tasks: number; open: number }>;
  /** pct is the done share of tasks that aren't canceled. */
  projects: Record<string, { tasks: number; open: number; done: number; pct: number }>;
}

export const STATUS_LABEL: Record<Status, string> = {
  backlog: "Backlog",
  todo: "Todo",
  progress: "In progress",
  review: "In review",
  done: "Done",
  canceled: "Canceled",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

export const AGENT_LABEL: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex",
};

export const DOER_LABEL: Record<Doer, string> = { ...AGENT_LABEL, human: "You" };

/** The agent that runs a task: its own, else the project's, else Claude Code. Null for a task that is yours. */
export function agentOf(task: { agent: Doer | null }, projectAgent?: AgentId | null): AgentId | null {
  if (task.agent === "human") return null;
  return task.agent ?? projectAgent ?? "claude";
}

export const EDGE_LABEL: Record<EdgeMode, string> = {
  auto: "Auto",
  manual: "Manual",
  session: "Same session",
  time: "At a set time",
};
