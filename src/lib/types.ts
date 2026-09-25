export type Status = "backlog" | "todo" | "progress" | "review" | "done" | "canceled";
/** Linear-style priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export type Priority = 0 | 1 | 2 | 3 | 4;
export type AgentId = "claude" | "codex";
/** Who does a task: an agent, or you ("human"). Tasks that are yours stay out of flows and agent sessions. */
export type Doer = AgentId | "human";
/** How the target task's session starts once the source task is ready. */
export type EdgeMode = "auto" | "manual" | "session" | "time";
export type SessionStatus = "starting" | "running" | "finished" | "done" | "closed" | "failed";
/**
 * Where an agent session runs: in a terminal or the agent's desktop app on a device where PacedMind is
 * installed, or in the provider's cloud (Claude Code on the web, Codex cloud).
 */
export type Surface = "terminal" | "desktop" | "cloud";
/** Whether PacedMind's MCP server is set up for sessions it doesn't configure itself (desktop apps). */
export type McpLink = "connected" | "elsewhere" | "missing";

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
  folder: string | null;
  /** The device `folder` is on; null means the device this PacedMind runs on. */
  deviceId: string | null;
  /** The Codex cloud environment (its label or id) that tasks sent to Codex cloud run in. */
  codexEnv: string | null;
  agent: AgentId | null;
  afterProjectId: string | null;
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
  /** Where its agent sessions run; null picks the terminal when the agent's CLI is installed, else its desktop app. */
  runIn: Surface | null;
  /** The device its sessions run on and its folder is on; null means the project's device. */
  deviceId: string | null;
  /** Its own working folder (a workspace on its device); null means the project's folder. */
  folder: string | null;
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
  surface: Surface;
  /** The device it runs on; null for cloud sessions. */
  deviceId: string | null;
  folder: string | null;
  branch: string | null;
  /** Where to follow it, e.g. claude.ai/code for cloud sessions. */
  url: string | null;
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

export interface Settings {
  workStart: string;
  workEnd: string;
  lunchStart: string;
  lunchEnd: string;
  workDays: number[];
  terminal: "wt" | "cmd";
  claudeCommand: string;
  codexCommand: string;
  mcpToken: string;
  port: number;
  /** True once the import of Claude Code and Codex projects was offered (it opens by itself only once). */
  importOffered: boolean;
}

/** What PacedMind found on a device for one agent. */
export interface AgentTools {
  /** The command-line tool, when it answered `--version`; `path` when it isn't on the PATH but was found where installers put it. */
  cli: { version: string; path?: string } | null;
  /** The desktop app, when it's installed. */
  app: { version: string | null } | null;
  /** Whether sessions PacedMind doesn't set up itself (the desktop app) can reach PacedMind's MCP server. */
  mcp: McpLink;
}

/** A computer where PacedMind is installed. Sessions run on it in a terminal or an agent's desktop app. */
export interface Device {
  id: string;
  name: string;
  platform: string;
  agents: Record<AgentId, AgentTools>;
  /** When it last checked in. */
  seenAt: string;
  /** When it last looked for the agents; null until the first check finished. */
  checkedAt: string | null;
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

export const SURFACE_LABEL: Record<Surface, string> = { terminal: "Terminal", desktop: "Desktop app", cloud: "Cloud" };
/** The agent's desktop app and its cloud, by name. */
export const APP_LABEL: Record<AgentId, string> = { claude: "Claude app", codex: "Codex app" };
export const CLOUD_LABEL: Record<AgentId, string> = { claude: "Claude Code on the web", codex: "Codex cloud" };

/**
 * Where a task's sessions run when the task doesn't say: in a terminal when the agent's CLI is on the device,
 * else in its desktop app when that is. Until the device was checked, in a terminal.
 */
export function surfaceOf(runIn: Surface | null, tools: AgentTools | undefined): Surface {
  if (runIn) return runIn;
  return tools && !tools.cli && tools.app ? "desktop" : "terminal";
}

/** "Windows", "macOS" or "Linux" for a Node platform name. */
export function platformName(platform: string): string {
  return platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform;
}

/** Whether a device can run an agent's sessions that way; cloud sessions need the CLI to start them. */
export function canRun(tools: AgentTools | undefined, surface: Surface): boolean {
  if (!tools) return surface === "terminal";
  return surface === "desktop" ? !!tools.app : !!tools.cli;
}

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
