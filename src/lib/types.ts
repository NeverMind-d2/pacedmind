export type Status = "backlog" | "todo" | "progress" | "review" | "done" | "canceled";
/** Linear-style priority: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
export type Priority = 0 | 1 | 2 | 3 | 4;
export type AgentId = "claude" | "codex";
/** How the target task's session starts once the source task is ready. */
export type EdgeMode = "auto" | "manual" | "session" | "time";
export type SessionStatus = "starting" | "running" | "finished" | "done" | "closed" | "failed";

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
  startDate: string | null;
  targetDate: string | null;
  folder: string | null;
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
  agent: AgentId | null;
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
}

/** What task lists and the detail panel need besides the tasks themselves. */
export interface TaskContext {
  areas: Area[];
  projects: Project[];
  /** Latest session per task id. */
  sessions: Record<number, Session>;
  sessionEvents: Record<string, SessionEvent[]>;
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

export const EDGE_LABEL: Record<EdgeMode, string> = {
  auto: "Auto",
  manual: "Manual",
  session: "Same session",
  time: "At a set time",
};
