"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment, createContext, useCallback, useContext, useEffect, useMemo, useOptimistic, useRef, useState, useTransition,
  type CSSProperties, type DragEvent, type ReactNode,
} from "react";
import {
  Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, Position, ReactFlow, ReactFlowProvider, ViewportPortal,
  getBezierPath, useReactFlow, useViewport,
  type Connection, type Edge, type EdgeChange, type EdgeProps, type EdgeTypes, type Node as FlowNode, type NodeChange,
  type NodeHandle, type NodeProps, type NodeTypes, type OnDelete, type OnNodeDrag,
} from "@xyflow/react";
import { format } from "date-fns";
import {
  connectAction, deleteEdgeAction, placeInFlowAction, removeFromFlowAction, setFlowOnAction,
} from "@/app/actions";
import { startSessionOrAsk } from "@/components/remote-start";
import { addToFlowAction, setAgentsAction, setStartAction, tidyFlowAction } from "@/app/(app)/flows/actions";
import { Icon, StatusIcon } from "@/components/icons";
import { Button, Dot, Kbd, Menu, Segmented, Switch, cx, toast } from "@/components/ui";
import { parseLocal, toDateStr, toDateTimeStr } from "@/lib/dates";
import { GRID, NODE_H, NODE_W, freeSpot, layoutFlow, snap, type Point } from "@/lib/flow-layout";
import { AGENT_LABEL, EDGE_LABEL, type AgentId, type EdgeMode, type FlowEdge, type Session, type Status } from "@/lib/types";

/* ---------- data from the server ---------- */

export interface FlowTask {
  id: number;
  key: string;
  title: string;
  status: Status;
  /** Who runs it: the task's agent, else the project's, else Claude Code. */
  agent: AgentId;
  flowX: number | null;
  flowY: number | null;
  sortOrder: number;
  completedAt: string | null;
}

export interface FlowViewProps {
  project: { id: string; name: string; flowOn: boolean; folder: string | null; color: string };
  projects: { id: string; name: string; color: string; inFlow: number }[];
  tasks: FlowTask[];
  /** Open tasks in the project that are yours: they stay out of the flow. */
  yours: number;
  /** Connections between the project's tasks. */
  edges: FlowEdge[];
  /** Latest session per task id. */
  sessions: Record<number, Session>;
  /** Task id → key of the task whose terminal session its latest session carries on. */
  continuedFrom: Record<number, string>;
  /** Tasks whose running session the flow started on its own. */
  autoStarted: number[];
  now: string;
  workStart: string;
  workDays: number[];
}

/* ---------- canvas geometry and styles ---------- */

// Node size and the grid come from src/lib/flow-layout.ts, which the server's placement and tidy use too.
const HANDLE = 16;
const AGENTS: AgentId[] = ["claude", "codex"];
const ACCENT = "var(--color-accent)";
const ACCENT_LINE = "color-mix(in srgb, var(--color-accent) 70%, transparent)";
const DND_TYPE = "application/x-organizer-task";
const SNAP_GRID: [number, number] = [GRID, GRID];
const otherAgent = (a: AgentId): AgentId => (a === "claude" ? "codex" : "claude");

/** Handle bounds given up front, so edges don't wait for the DOM to be measured. */
const HANDLES: NodeHandle[] = [
  { type: "target", position: Position.Top, x: (NODE_W - HANDLE) / 2, y: -HANDLE / 2, width: HANDLE, height: HANDLE },
  { type: "source", position: Position.Bottom, x: (NODE_W - HANDLE) / 2, y: NODE_H - HANDLE / 2, width: HANDLE, height: HANDLE },
];
const HANDLE_STYLE = { width: HANDLE, height: HANDLE, minWidth: 0, minHeight: 0, background: "transparent", border: "none" };
const DELETE_KEYS = ["Delete", "Backspace"];
const CONNECTION_LINE = { stroke: ACCENT_LINE, strokeWidth: 1.5, strokeDasharray: "5 4" };
const DEFAULT_VIEWPORT = { x: 40, y: 40, zoom: 1 };
/** React Flow asks to keep its attribution unless you subscribe to Pro; this lets it blend into the canvas. */
const CANVAS_STYLE = { "--xy-attribution-background-color": "transparent" } as CSSProperties;

const MODE_LINE: Record<EdgeMode, { stroke: string; width: number; dash?: string }> = {
  auto: { stroke: "var(--color-line-strong)", width: 1.5 },
  manual: { stroke: "var(--color-line-strong)", width: 1.5, dash: "5 4" },
  session: { stroke: "var(--color-mut2)", width: 2 },
  time: { stroke: "var(--color-line-strong)", width: 1.8, dash: "1 4" },
};

const LEGEND: { mode: EdgeMode; label: string }[] = [
  { mode: "auto", label: "Automatically" },
  { mode: "manual", label: "After you mark it done" },
  { mode: "session", label: "Same session, no stop" },
  { mode: "time", label: "At a set time" },
];

/* ---------- types ---------- */

type Tone = "done" | "waiting" | "running" | "ready" | "queued" | "stopped" | "canceled";
type NodeInfo = { tone: Tone; state: string; note: string };

const TONE_DOT: Record<Tone, string> = {
  done: "var(--color-faint)", canceled: "var(--color-faint)", waiting: ACCENT, running: "var(--color-fg3)", ready: "var(--color-mut2)", queued: "var(--color-dim)", stopped: "var(--color-dim)",
};

type TaskNodeData = {
  key: string;
  title: string;
  tone: Tone;
  state: string;
  note: string;
  agent: AgentId;
  /** Lights the outgoing dot: a task dropped from the palette will run after this one. */
  linkOut: boolean;
};
type TaskNode = FlowNode<TaskNodeData, "task">;

type ModeEdgeData = { mode: EdgeMode; label: string; into: boolean; spent: boolean; showLabel: boolean };
type ModeEdge = Edge<ModeEdgeData, "mode">;

type Selection = { kind: "node" | "edge"; id: number } | null;
type Ghost = { taskId: number; x: number; y: number; after: number | null };
type TaskPatch = Partial<Pick<FlowTask, "flowX" | "flowY" | "agent">>;
type EdgeOp =
  | { kind: "add"; edge: FlowEdge }
  | { kind: "remove"; ids: number[] }
  | { kind: "detach"; taskIds: number[] }
  | { kind: "mode"; toTaskId: number; mode: EdgeMode; atTime: string | null };
type Result = { ok?: boolean; error?: string; message?: string } | void;

interface Graph {
  byId: Map<number, FlowTask>;
  /** Connections whose both ends are on the canvas. */
  edges: FlowEdge[];
  incoming: Map<number, FlowEdge[]>;
  outgoing: Map<number, FlowEdge[]>;
}

/* ---------- pure helpers ---------- */

function patchTasks(tasks: FlowTask[], patch: Record<number, TaskPatch>): FlowTask[] {
  return tasks.map((t) => (patch[t.id] ? { ...t, ...patch[t.id] } : t));
}

function editEdges(edges: FlowEdge[], op: EdgeOp): FlowEdge[] {
  switch (op.kind) {
    case "add":
      return edges.some((e) => e.fromTaskId === op.edge.fromTaskId && e.toTaskId === op.edge.toTaskId) ? edges : [...edges, op.edge];
    case "remove":
      return edges.filter((e) => !op.ids.includes(e.id));
    case "detach":
      return edges.filter((e) => !op.taskIds.includes(e.fromTaskId) && !op.taskIds.includes(e.toTaskId));
    case "mode":
      return edges.map((e) => (e.toTaskId === op.toTaskId ? { ...e, mode: op.mode, atTime: op.mode === "time" ? op.atTime : null } : e));
  }
}

function buildGraph(tasks: FlowTask[], edges: FlowEdge[]): Graph {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const onCanvas = (id: number) => {
    const t = byId.get(id);
    return !!t && t.flowX !== null && t.flowY !== null;
  };
  const live = edges.filter((e) => onCanvas(e.fromTaskId) && onCanvas(e.toTaskId));
  const incoming = new Map<number, FlowEdge[]>();
  const outgoing = new Map<number, FlowEdge[]>();
  for (const e of live) {
    incoming.set(e.toTaskId, [...(incoming.get(e.toTaskId) ?? []), e]);
    outgoing.set(e.fromTaskId, [...(outgoing.get(e.fromTaskId) ?? []), e]);
  }
  return { byId, edges: live, incoming, outgoing };
}

const sameDay = (a: Date, b: Date) => toDateStr(a) === toDateStr(b);
const dayBefore = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);

/** "12:22", "yesterday 12:22" or "Mon 21 Sep, 12:22". */
function clock(stamp: string, now: number): string {
  const d = parseLocal(stamp);
  const today = new Date(now);
  if (sameDay(d, today)) return format(d, "HH:mm");
  if (sameDay(d, dayBefore(today))) return `yesterday ${format(d, "HH:mm")}`;
  return format(d, "EEE d MMM, HH:mm");
}

/** Like clock(), but reads well after a verb: "at 12:22", "yesterday 12:22". */
const since = (stamp: string, now: number) => {
  const c = clock(stamp, now);
  return /^\d/.test(c) ? `at ${c}` : c;
};

/** "today 09:40", "yesterday 18:10" or "Mon 21 Sep". */
function when(stamp: string, now: number): string {
  const d = parseLocal(stamp);
  const today = new Date(now);
  if (sameDay(d, today)) return `today ${format(d, "HH:mm")}`;
  if (sameDay(d, dayBefore(today))) return `yesterday ${format(d, "HH:mm")}`;
  return format(d, "EEE d MMM");
}

function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

/** Formats a "YYYY-MM-DDTHH:mm" value, falling back to the raw text if it isn't one. */
function formatAt(at: string, pattern: string): string {
  const d = parseLocal(at);
  return Number.isNaN(d.getTime()) ? at : format(d, pattern);
}
const atLabel = (at: string) => formatAt(at, "EEE d MMM, HH:mm");
const names = (keys: string[]) => (keys.length < 2 ? keys.join("") : `${keys.slice(0, -1).join(", ")} and ${keys[keys.length - 1]}`);
const agentShort = (a: AgentId) => (a === "claude" ? "Claude" : "Codex");

const READY = new Set<Status>(["review", "done"]);

/** Mirrors src/server/flow.ts: whether one connection lets its target start. */
function satisfied(e: FlowEdge, source: FlowTask | undefined, nowStr: string): boolean {
  if (!source) return true;
  if (e.mode === "manual") return source.status === "done";
  if (e.mode === "time") return READY.has(source.status) && !!e.atTime && e.atTime <= nowStr;
  return READY.has(source.status);
}

function startMode(incoming: FlowEdge[]): EdgeMode | "mixed" | null {
  if (!incoming.length) return null;
  const m = incoming[0].mode;
  return incoming.every((e) => e.mode === m) ? m : "mixed";
}

function edgeLabel(e: FlowEdge): string {
  if (e.mode === "time") return e.atTime ? formatAt(e.atTime, "EEE HH:mm") : "Set time";
  return EDGE_LABEL[e.mode];
}

const keyOf = (g: Graph, id: number) => g.byId.get(id)?.key ?? "?";

function nodeInfo(
  t: FlowTask, g: Graph, sessions: Record<number, Session>, continuedFrom: Record<number, string>, autoStarted: Set<number>, now: number,
): NodeInfo {
  const s = sessions[t.id];
  const incoming = g.incoming.get(t.id) ?? [];
  if (t.status === "done") {
    const note = s?.endedAt ? `Session closed ${when(s.endedAt, now)}` : t.completedAt ? `Marked done ${when(t.completedAt, now)}` : "Checked and done";
    return { tone: "done", state: "Done", note };
  }
  if (t.status === "canceled") return { tone: "canceled", state: "Canceled", note: "Won't run" };
  if (s && (s.status === "running" || s.status === "starting")) {
    const note = continuedFrom[t.id]
      ? `Same session as ${continuedFrom[t.id]}`
      : `Started ${autoStarted.has(t.id) ? "on its own " : ""}${since(s.startedAt, now)}`;
    return { tone: "running", state: `Running ${duration(now - parseLocal(s.startedAt).getTime())}`, note };
  }
  if (s?.status === "finished" || t.status === "review") {
    const note = s?.status === "finished" && s.finishedAt ? `Finished ${clock(s.finishedAt, now)}, check it and mark done` : "Check it and mark done";
    return { tone: "waiting", state: "Waiting for you", note };
  }
  if (s?.status === "closed") return { tone: "stopped", state: "Stopped", note: "Terminal closed before it finished" };
  if (s?.status === "failed") return { tone: "stopped", state: "Didn't start", note: s.note ?? "The terminal didn't open" };

  const nowStr = toDateTimeStr(new Date(now));
  const ready = incoming.every((e) => satisfied(e, g.byId.get(e.fromTaskId), nowStr));
  const state = t.status === "progress" ? "In progress" : "Not started";
  const src = names(incoming.map((e) => keyOf(g, e.fromTaskId)));
  const mode = startMode(incoming);
  let note: string;
  if (!mode) note = "Start it yourself";
  else if (mode === "session") note = `Same session as ${src}`;
  else if (ready) note = `Ready, ${src} ${incoming.length > 1 ? "are" : "is"} ${mode === "manual" ? "done" : "finished"}`;
  else if (mode === "manual") note = `Starts when you mark ${src} done`;
  else if (mode === "time") note = incoming[0].atTime ? `Starts ${atLabel(incoming[0].atTime)}` : "Starts at a set time";
  else if (mode === "auto" && incoming.length === 1) note = `Starts when ${src} finishes`;
  else note = `Waits for ${src}`;
  return { tone: ready ? "ready" : "queued", state, note };
}

/** What happens to the target of a connection once its source finishes. */
function nextText(e: FlowEdge, g: Graph): string {
  const key = keyOf(g, e.toTaskId);
  const from = keyOf(g, e.fromTaskId);
  if (e.mode === "session") return `${key} carries on in the same session`;
  if (e.mode === "manual") return `${key} starts after you mark ${from} done`;
  if (e.mode === "time") return e.atTime ? `${key} starts ${atLabel(e.atTime)}` : `${key} starts at a set time`;
  const all = g.incoming.get(e.toTaskId) ?? [];
  if (all.length > 1) return `${key} starts when ${names(all.map((x) => keyOf(g, x.fromTaskId)))} are ${all.length === 2 ? "both" : "all"} done`;
  return `${key} starts on its own`;
}

/** No self-links, duplicates or loops. */
function canConnect(from: number, to: number, g: Graph): boolean {
  if (from === to || g.edges.some((e) => e.fromTaskId === from && e.toTaskId === to)) return false;
  const seen = new Set<number>();
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of g.outgoing.get(id) ?? []) stack.push(e.toTaskId);
  }
  return true;
}

/** Tasks chained by "same session" connections with one agent share a terminal: they get a box behind them. */
function sessionGroups(g: Graph): { boxes: { agent: AgentId; ids: number[] }[]; inner: Set<number> } {
  const parent = new Map<number, number>();
  const find = (x: number) => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const inner = new Set<number>();
  for (const e of g.edges) {
    const a = g.byId.get(e.fromTaskId);
    const b = g.byId.get(e.toTaskId);
    if (e.mode !== "session" || !a || !b || a.agent !== b.agent) continue;
    inner.add(e.id);
    parent.set(find(a.id), find(b.id));
  }
  const members = new Map<number, number[]>();
  for (const e of g.edges) {
    if (!inner.has(e.id)) continue;
    for (const id of [e.fromTaskId, e.toTaskId]) {
      const list = members.get(find(id)) ?? [];
      if (!list.includes(id)) list.push(id);
      members.set(find(id), list);
    }
  }
  return { boxes: [...members.values()].map((ids) => ({ agent: g.byId.get(ids[0])!.agent, ids })), inner };
}

/**
 * The task and every task it shares one terminal session with: linked by "same session" connections in either
 * direction. One session can't switch agents, so they change agent together.
 */
function sessionChain(taskId: number, g: Graph): number[] {
  const chain = new Set([taskId]);
  const stack = [taskId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of [...(g.incoming.get(id) ?? []), ...(g.outgoing.get(id) ?? [])]) {
      if (e.mode !== "session") continue;
      for (const other of [e.fromTaskId, e.toTaskId]) {
        if (!chain.has(other)) {
          chain.add(other);
          stack.push(other);
        }
      }
    }
  }
  return [...chain];
}

const positionOf = (t: FlowTask): Point => ({ x: t.flowX ?? 0, y: t.flowY ?? 0 });

/** Default for "at a set time": the next work day at the start of the work day. */
function nextWorkMorning(now: number, workStart: string, workDays: number[]): string {
  const d = new Date(now);
  for (let i = 1; i <= 7; i++) {
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (!workDays.length || workDays.includes(day.getDay())) return `${toDateStr(day)}T${workStart}`;
  }
  return `${toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))}T${workStart}`;
}

function shortPath(p: string): string {
  if (p.length <= 32) return p;
  const sep = p.includes("\\") ? "\\" : "/";
  return `…${sep}${p.split(/[\\/]/).filter(Boolean).slice(-2).join(sep)}`;
}

function lastRun(s: Session, now: number): string {
  switch (s.status) {
    case "starting":
    case "running":
      return `Running since ${clock(s.startedAt, now)}`;
    case "finished":
      return `Finished ${clock(s.finishedAt ?? s.startedAt, now)}, waiting for you`;
    case "done":
      return `Done, finished ${clock(s.finishedAt ?? s.endedAt ?? s.startedAt, now)}`;
    case "closed":
      return `Closed before finishing, ${clock(s.endedAt ?? s.startedAt, now)}`;
    default:
      return `Didn't start, ${clock(s.startedAt, now)}`;
  }
}

/** Current time, starting from the server's clock (no hydration mismatch) and ticking every 30 s. */
function useNow(initial: string): number {
  const [now, setNow] = useState(() => parseLocal(initial).getTime());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/* ---------- the view ---------- */

export function FlowView(props: FlowViewProps) {
  return (
    <ReactFlowProvider>
      <FlowEditor {...props} />
    </ReactFlowProvider>
  );
}

/** Lets an edge label select the task its connection leads into. */
const PickNode = createContext<(taskId: number) => void>(() => {});
/** Lets a node's agent chip hand the task to the other agent. */
const SwitchAgent = createContext<(taskId: number) => void>(() => {});

const nodeTypes: NodeTypes = { task: TaskNodeView };
const edgeTypes: EdgeTypes = { mode: ModeEdgeView };

function FlowEditor(props: FlowViewProps) {
  const { project, sessions, continuedFrom } = props;
  const rf = useReactFlow<TaskNode, ModeEdge>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  // Server data with this client's pending changes applied; it falls back to the server's once they land.
  const [tasks, patchTask] = useOptimistic(props.tasks, patchTasks);
  const [edges, editEdge] = useOptimistic(props.edges, editEdges);
  const [flowOn, setFlowOn] = useOptimistic(project.flowOn);
  const now = useNow(props.now);
  const [sel, setSel] = useState<Selection>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<number | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);

  const autoStarted = useMemo(() => new Set(props.autoStarted), [props.autoStarted]);
  const graph = useMemo(() => buildGraph(tasks, edges), [tasks, edges]);
  const placed = useMemo(() => tasks.filter((t) => t.flowX !== null && t.flowY !== null), [tasks]);
  const info = useMemo(
    () => new Map(placed.map((t) => [t.id, nodeInfo(t, graph, sessions, continuedFrom, autoStarted, now)])),
    [placed, graph, sessions, continuedFrom, autoStarted, now],
  );
  const positions = useMemo(
    () => new Map(placed.map((t) => [t.id, drag?.id === t.id ? { x: drag.x, y: drag.y } : positionOf(t)])),
    [placed, drag],
  );
  const groups = useMemo(() => sessionGroups(graph), [graph]);
  const selNode = sel?.kind === "node" ? sel.id : null;
  const selEdge = sel?.kind === "edge" ? sel.id : null;
  const linkOut = ghost ? ghost.after : null;

  const nodes = useMemo<TaskNode[]>(() => placed.map((t) => {
    const i = info.get(t.id)!;
    return {
      id: String(t.id), type: "task", position: positions.get(t.id)!, width: NODE_W, height: NODE_H, handles: HANDLES,
      selected: t.id === selNode, dragging: drag?.id === t.id,
      data: { key: t.key, title: t.title, tone: i.tone, state: i.state, note: i.note, agent: t.agent, linkOut: t.id === linkOut },
    };
  }), [placed, info, positions, drag, selNode, linkOut]);

  const links = useMemo<ModeEdge[]>(() => graph.edges.map((e) => ({
    id: String(e.id), source: String(e.fromTaskId), target: String(e.toTaskId), type: "mode", selected: e.id === selEdge,
    data: {
      mode: e.mode, label: edgeLabel(e), into: e.toTaskId === selNode,
      spent: graph.byId.get(e.fromTaskId)?.status === "done" && graph.byId.get(e.toTaskId)?.status === "done",
      showLabel: !groups.inner.has(e.id),
    },
  })), [graph, groups, selNode, selEdge]);

  /* ----- header numbers ----- */

  const tones = placed.map((t) => ({ agent: t.agent, tone: info.get(t.id)!.tone }));
  const count = (...ts: Tone[]) => tones.filter((x) => ts.includes(x.tone)).length;
  // What each agent is doing right now, for the header.
  const agentStatus = AGENTS.map((agent) => {
    const mine = tones.filter((x) => x.agent === agent);
    const waiting = mine.filter((x) => x.tone === "waiting").length;
    const running = mine.filter((x) => x.tone === "running").length;
    const parts = [running ? `${running} running` : "", waiting ? `${waiting} waiting for you` : ""].filter(Boolean);
    return { agent, status: parts.length ? parts.join(", ") : "idle", busy: parts.length > 0 };
  });
  const summaryParts: [number, string][] = [
    [count("done", "canceled"), "done"], [count("running"), "running"], [count("waiting"), "waiting for you"],
    [count("ready", "queued", "stopped"), "not started"],
  ];
  const summary = placed.length
    ? summaryParts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`).join(" · ")
    : "Nothing in the flow yet";

  /* ----- actions ----- */

  const act = useCallback((optimistic: () => void, fn: () => Promise<Result>, success?: string) => {
    startTransition(async () => {
      optimistic();
      try {
        const r = await fn();
        if (r && r.ok === false) toast(r.error ?? "Something went wrong", "error");
        else if (r && r.message) toast(r.message);
        else if (success) toast(success);
      } catch (err) {
        toast(err instanceof Error ? err.message : "Something went wrong", "error");
      }
    });
  }, [startTransition]);

  /** Shows the whole flow, zoomed out only as far as needed and never in past 100%. */
  const fitTo = useCallback((points: Point[], ms = 0) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return;
    const xs = points.length ? points.map((p) => p.x) : [0];
    const ys = points.length ? points.map((p) => p.y) : [0];
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const width = Math.max(...xs) + NODE_W - left;
    const height = Math.max(...ys) + NODE_H - top;
    const pad = 48;
    const zoom = Math.min(1, Math.max(0.4, Math.min((box.width - 2 * pad) / width, (box.height - 2 * pad) / height)));
    const y = height * zoom < box.height - 2 * pad ? Math.min(pad, (box.height - height * zoom) / 2) : pad;
    void rf.setViewport({ x: (box.width - width * zoom) / 2 - left * zoom, y: y - top * zoom, zoom }, { duration: ms });
  }, [rf]);

  const move = (t: FlowTask, x: number, y: number) =>
    act(() => patchTask({ [t.id]: { flowX: x, flowY: y } }), () => placeInFlowAction(t.id, x, y));

  /** Hands a task to an agent, together with the tasks it shares a terminal session with. */
  const setAgent = (t: FlowTask, agent: AgentId) => {
    if (agent === t.agent) return;
    const ids = sessionChain(t.id, graph).filter((id) => graph.byId.get(id)?.agent !== agent);
    const keys = ids.map((id) => keyOf(graph, id));
    act(() => patchTask(Object.fromEntries(ids.map((id) => [id, { agent }]))), () => setAgentsAction(ids, agent),
      ids.length > 1 ? `${names(keys)} now run in ${AGENT_LABEL[agent]}, because they share one session` : `${t.key} now runs in ${AGENT_LABEL[agent]}`);
  };
  const setAgentRef = useRef(setAgent);
  useEffect(() => { setAgentRef.current = setAgent; });
  const switchAgent = useCallback((id: number) => {
    const t = graph.byId.get(id);
    if (t) setAgentRef.current(t, otherAgent(t.agent));
  }, [graph]);

  const addTask = (t: FlowTask, at: Point, after: number | null, message?: string) => {
    setSel({ kind: "node", id: t.id });
    act(() => {
      patchTask({ [t.id]: { flowX: at.x, flowY: at.y } });
      if (after !== null) editEdge({ kind: "add", edge: { id: -Date.now(), fromTaskId: after, toTaskId: t.id, mode: "auto", atTime: null } });
    }, () => addToFlowAction(t.id, at.x, at.y, t.agent, after), message);
  };

  const addAtEnd = (t: FlowTask) => {
    const at = freeSpot(placed.map(positionOf));
    addTask(t, at, null, `Added ${t.key} to the flow`);
    void rf.setCenter(at.x + NODE_W / 2, at.y + NODE_H / 2, { zoom: rf.getZoom(), duration: 300 });
  };

  const remove = (t: FlowTask) => {
    setSel(null);
    act(() => {
      patchTask({ [t.id]: { flowX: null, flowY: null } });
      editEdge({ kind: "detach", taskIds: [t.id] });
    }, () => removeFromFlowAction(t.id), `Removed ${t.key} from the flow`);
  };

  const removeEdge = (e: FlowEdge) => {
    setSel(null);
    act(() => editEdge({ kind: "remove", ids: [e.id] }), () => deleteEdgeAction(e.id));
  };

  const setStart = (t: FlowTask, mode: EdgeMode, atTime: string | null) => {
    const first = (graph.incoming.get(t.id) ?? [])[0];
    const source = first ? graph.byId.get(first.fromTaskId) : undefined;
    // One terminal session can't switch agents: "same session" hands the task (and whatever continues
    // its session) to the agent of the task it continues. It stays where it is on the canvas.
    const agent = mode === "session" && source && source.agent !== t.agent ? source.agent : null;
    const ids = agent ? sessionChain(t.id, graph).filter((id) => graph.byId.get(id)?.agent !== agent) : [];
    act(() => {
      editEdge({ kind: "mode", toTaskId: t.id, mode, atTime });
      if (agent) patchTask(Object.fromEntries(ids.map((id) => [id, { agent }])));
    }, async () => {
      const r = await setStartAction(t.id, mode, mode === "time" ? atTime : null);
      if (agent && r.ok) return setAgentsAction(ids, agent);
      return r;
    });
  };

  const tidyUp = () => {
    const at = layoutFlow(placed.map((t) => ({ ...positionOf(t), id: t.id, sortOrder: t.sortOrder })), graph.edges);
    const moved = placed.filter((t) => at.get(t.id)?.x !== t.flowX || at.get(t.id)?.y !== t.flowY);
    if (moved.length) {
      act(
        () => patchTask(Object.fromEntries(moved.map((t) => [t.id, { flowX: at.get(t.id)!.x, flowY: at.get(t.id)!.y }]))),
        () => tidyFlowAction(moved.map((t) => ({ taskId: t.id, ...at.get(t.id)! }))),
      );
    }
    fitTo([...at.values()], 300);
  };

  const toggleFlow = (on: boolean) =>
    act(() => setFlowOn(on), () => setFlowOnAction(project.id, on),
      on ? "Flow is on. Sessions start on their own when the one before is ready." : "Flow paused. Nothing starts on its own.");

  /* ----- canvas events ----- */

  const onNodesChange = useCallback((changes: NodeChange<TaskNode>[]) => {
    for (const c of changes) {
      if (c.type === "position" && c.position && c.dragging) {
        const { x, y } = c.position;
        setDrag({ id: Number(c.id), x, y });
      } else if (c.type === "select") {
        const id = Number(c.id);
        setSel((s) => (c.selected ? { kind: "node", id } : s?.kind === "node" && s.id === id ? null : s));
      }
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<ModeEdge>[]) => {
    for (const c of changes) {
      if (c.type !== "select") continue;
      const id = Number(c.id);
      setSel((s) => (c.selected ? { kind: "edge", id } : s?.kind === "edge" && s.id === id ? null : s));
    }
  }, []);

  const pickNode = useCallback((id: number) => setSel({ kind: "node", id }), []);

  const onNodeDragStop: OnNodeDrag<TaskNode> = (_e, node) => {
    setDrag(null);
    const t = graph.byId.get(Number(node.id));
    if (!t) return;
    // Anywhere on the grid; where it sits doesn't change who runs it.
    const x = snap(node.position.x);
    const y = snap(node.position.y);
    if (x !== t.flowX || y !== t.flowY) move(t, x, y);
  };

  const onConnect = (c: Connection) => {
    const from = Number(c.source);
    const to = Number(c.target);
    if (!canConnect(from, to, graph)) return;
    act(
      () => editEdge({ kind: "add", edge: { id: -Date.now(), fromTaskId: from, toTaskId: to, mode: "auto", atTime: null } }),
      () => connectAction(from, to, "auto"),
    );
  };

  const onDelete: OnDelete<TaskNode, ModeEdge> = ({ nodes: goneNodes, edges: goneEdges }) => {
    const taskIds = goneNodes.map((n) => Number(n.id));
    // Connections of removed tasks go with them on the server.
    const edgeIds = goneEdges.map((e) => Number(e.id)).filter((id) => {
      const e = graph.edges.find((x) => x.id === id);
      return !!e && !taskIds.includes(e.fromTaskId) && !taskIds.includes(e.toTaskId);
    });
    if (!taskIds.length && !edgeIds.length) return;
    setSel(null);
    const only = taskIds.length === 1 && !edgeIds.length ? graph.byId.get(taskIds[0]) : undefined;
    act(() => {
      if (taskIds.length) {
        patchTask(Object.fromEntries(taskIds.map((id) => [id, { flowX: null, flowY: null }])));
        editEdge({ kind: "detach", taskIds });
      }
      if (edgeIds.length) editEdge({ kind: "remove", ids: edgeIds });
    }, async () => {
      for (const id of taskIds) await removeFromFlowAction(id);
      for (const id of edgeIds) await deleteEdgeAction(id);
    }, only ? `Removed ${only.key} from the flow` : undefined);
  };

  /**
   * Where a task dragged from the palette would land (centred on the pointer, on the grid), and the task just
   * above it that it would run after.
   */
  const dropSpot = (clientX: number, clientY: number, taskId: number): Ghost => {
    const p = rf.screenToFlowPosition({ x: clientX, y: clientY });
    const x = snap(p.x - NODE_W / 2);
    let y = snap(p.y - NODE_H / 2);
    let after: FlowTask | null = null;
    for (const t of placed) {
      if (t.id === taskId || Math.abs((t.flowX ?? 0) - x) >= NODE_W) continue;
      const gap = y - ((t.flowY ?? 0) + NODE_H);
      if (gap >= -24 && gap <= 160 && (!after || (t.flowY ?? 0) > (after.flowY ?? 0))) after = t;
    }
    // Leave room for the connection's label between the two.
    if (after) y = Math.max(y, snap((after.flowY ?? 0) + NODE_H + 50));
    return { taskId, x, y, after: after?.id ?? null };
  };

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (paletteDrag === null || !e.dataTransfer.types.includes(DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const g = dropSpot(e.clientX, e.clientY, paletteDrag);
    setGhost((cur) => (cur && cur.taskId === g.taskId && cur.x === g.x && cur.y === g.y && cur.after === g.after ? cur : g));
  };

  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Element | null)) setGhost(null);
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    const t = graph.byId.get(Number(e.dataTransfer.getData(DND_TYPE)));
    setGhost(null);
    setPaletteDrag(null);
    if (!t || t.flowX !== null) return;
    e.preventDefault();
    const g = dropSpot(e.clientX, e.clientY, t.id);
    addTask(t, g, g.after);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement).closest?.("input, textarea, [role=menu]")) setSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ----- render ----- */

  const selectedTask = selNode !== null ? placed.find((t) => t.id === selNode) : undefined;
  const selectedEdge = selEdge !== null ? graph.edges.find((e) => e.id === selEdge) : undefined;
  const defaultAt = nextWorkMorning(now, props.workStart, props.workDays);
  const palette = tasks
    .filter((t) => (t.flowX === null || t.flowY === null) && t.status !== "done" && t.status !== "canceled")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const ghostTask = ghost ? graph.byId.get(ghost.taskId) : undefined;
  const ghostAfter = ghost && ghost.after !== null ? graph.byId.get(ghost.after) : undefined;

  let inspector: ReactNode = <EmptyInspector />;
  if (selectedTask) {
    const at = (graph.incoming.get(selectedTask.id) ?? []).find((e) => e.mode === "time")?.atTime ?? "";
    inspector = (
      <Inspector key={`${selectedTask.id}:${at}`} project={project} task={selectedTask} info={info.get(selectedTask.id)!}
        session={sessions[selectedTask.id]} graph={graph} flowOn={flowOn} now={now} defaultAt={defaultAt}
        onAgent={(agent) => setAgent(selectedTask, agent)}
        onStart={(mode, at) => setStart(selectedTask, mode, at)}
        onStartNow={() => act(() => {}, () => startSessionOrAsk(selectedTask.id, selectedTask.agent))}
        onRemove={() => remove(selectedTask)} />
    );
  } else if (selectedEdge) {
    inspector = <EdgeInspector edge={selectedEdge} graph={graph} onPick={pickNode} onRemove={() => removeEdge(selectedEdge)} />;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <FlowHeader project={project} projects={props.projects} summary={summary} agents={agentStatus} flowOn={flowOn}
        canTidy={placed.length > 0} onFlow={toggleFlow} onTidy={tidyUp} onFit={() => fitTo(placed.map(positionOf), 250)} />
      <div className="flex min-h-0 flex-1">
        <Palette project={project} tasks={palette} total={tasks.length} yours={props.yours} dragging={paletteDrag}
          onDragStart={(t) => setPaletteDrag(t.id)} onDragEnd={() => { setPaletteDrag(null); setGhost(null); }} onAdd={addAtEnd} />

        <section aria-label="Flow canvas" className="relative min-w-0 flex-1 overflow-hidden"
          onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
          <div ref={canvasRef} className="absolute inset-0">
            <PickNode.Provider value={pickNode}>
            <SwitchAgent.Provider value={switchAgent}>
              <ReactFlow<TaskNode, ModeEdge>
                nodes={nodes}
                edges={links}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                onConnect={onConnect}
                isValidConnection={(c) => canConnect(Number(c.source), Number(c.target), graph)}
                onDelete={onDelete}
                onPaneClick={() => setSel(null)}
                onInit={() => fitTo(placed.map(positionOf))}
                deleteKeyCode={DELETE_KEYS}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                snapToGrid
                snapGrid={SNAP_GRID}
                nodeDragThreshold={3}
                connectionRadius={28}
                connectionLineStyle={CONNECTION_LINE}
                panOnScroll
                zoomOnDoubleClick={false}
                minZoom={0.3}
                maxZoom={1.5}
                defaultViewport={DEFAULT_VIEWPORT}
                colorMode="dark"
                style={CANVAS_STYLE}
              >
                <Background variant={BackgroundVariant.Dots} gap={GRID} size={1.6} color="var(--color-ctl)" />
                <ViewportPortal>
                  {groups.boxes.map((b) => {
                    // A box around the sessions that share one terminal, wherever they are on the grid.
                    const ps = b.ids.map((id) => positions.get(id) ?? { x: 0, y: 0 });
                    const left = Math.min(...ps.map((p) => p.x)) - 12;
                    const top = Math.min(...ps.map((p) => p.y)) - 12;
                    return (
                      <div key={b.ids.join("-")} aria-hidden="true"
                        className="pointer-events-none absolute left-0 top-0 -z-10 rounded-xl border border-ctl bg-ink/[0.015]"
                        style={{
                          width: Math.max(...ps.map((p) => p.x)) + NODE_W + 12 - left, height: Math.max(...ps.map((p) => p.y)) + NODE_H + 22 - top,
                          transform: `translate(${left}px, ${top}px)`,
                        }}>
                        <span className="absolute bottom-[3px] right-2.5 text-[11px] text-mut2">One {AGENT_LABEL[b.agent]} session</span>
                      </div>
                    );
                  })}
                  {ghost && ghostTask && <GhostNode task={ghostTask} x={ghost.x} y={ghost.y} after={ghostAfter} />}
                </ViewportPortal>
              </ReactFlow>
            </SwitchAgent.Provider>
            </PickNode.Provider>
          </div>
          {!placed.length && !ghost && <EmptyCanvas />}
        </section>

        {inspector}
      </div>
    </div>
  );
}

/* ---------- header ---------- */

function FlowHeader({ project, projects, summary, agents, flowOn, canTidy, onFlow, onTidy, onFit }: {
  project: FlowViewProps["project"];
  projects: FlowViewProps["projects"];
  summary: string;
  agents: { agent: AgentId; status: string; busy: boolean }[];
  flowOn: boolean;
  canTidy: boolean;
  onFlow: (on: boolean) => void;
  onTidy: () => void;
  onFit: () => void;
}) {
  const router = useRouter();
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-3.5 pr-4">
      <h1 className="sr-only">Flow for {project.name}</h1>
      <Menu width={260}
        trigger={
          <button type="button" aria-haspopup="menu" className="flex h-[30px] items-center gap-[7px] rounded-md px-2 hover:bg-hover">
            <Dot color={project.color} size={7} />
            <span className="max-w-[240px] truncate text-[14px] font-semibold text-strong">{project.name}</span>
            <Icon name="chevronDown" size={13} strokeWidth={2} className="text-mut2" />
          </button>
        }
        items={projects.map((p) => ({
          value: p.id, label: p.name, icon: <Dot color={p.color} size={7} />, hint: p.inFlow ? `${p.inFlow} in flow` : undefined,
        }))}
        onSelect={(id) => { if (id !== project.id) router.push(`/flows?p=${id}`); }} />
      <div className="flex h-7 shrink-0 items-center gap-0.5 rounded-[7px] border border-line bg-input p-0.5">
        <Link href={`/roadmap?p=${project.id}`} className="flex h-[22px] items-center gap-1.5 rounded-[5px] px-2.5 text-[12px] text-mut hover:bg-hover hover:text-fg2">
          <Icon name="roadmap" size={12} strokeWidth={2} />Roadmap
        </Link>
        <span aria-current="page" className="flex h-[22px] items-center gap-1.5 rounded-[5px] bg-sel px-2.5 text-[12px] text-strong">
          <Icon name="flow" size={12} strokeWidth={2} />Flow
        </span>
      </div>
      <span className="ml-1.5 min-w-0 truncate text-[12px] text-mut2">{summary}</span>
      <span className="flex-1" />
      {agents.map((a) => (
        <span key={a.agent} className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-mut2 xl:flex">
          <Icon name="terminal" size={13} strokeWidth={1.9} className="text-mut" />
          <span className="text-fg3">{AGENT_LABEL[a.agent]}</span>
          <span className={a.busy ? "text-fg2" : undefined}>{a.status}</span>
        </span>
      ))}
      <ZoomControls onFit={onFit} />
      <Button onClick={onTidy} disabled={!canTidy} title="Line the sessions up in the order they run">Tidy up</Button>
      <label className="flex h-7 shrink-0 cursor-pointer items-center gap-2 pl-1 text-[12.5px] text-fg3"
        title="When the flow is on, PacedMind starts the next session on its own">
        {flowOn ? "Flow on" : "Paused"}
        <Switch on={flowOn} onChange={onFlow} label="Flow on" />
      </label>
    </div>
  );
}

function ZoomControls({ onFit }: { onFit: () => void }) {
  const { zoom } = useViewport();
  const { zoomIn, zoomOut } = useReactFlow();
  const btn = "flex h-[26px] w-[26px] items-center justify-center rounded-md hover:bg-hover hover:text-fg2";
  return (
    <div className="flex h-7 shrink-0 items-center rounded-[7px] border border-line2 text-[12px] text-mut">
      <button type="button" aria-label="Zoom out" className={btn} onClick={() => zoomOut({ duration: 150 })}>
        <Icon name="minus" size={11} strokeWidth={2.4} />
      </button>
      <span className="w-[38px] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" className={btn} onClick={() => zoomIn({ duration: 150 })}>
        <Icon name="plus" size={11} strokeWidth={2.4} />
      </button>
      <span className="h-3.5 w-px bg-line2" />
      <button type="button" className="h-[26px] rounded-md px-2 hover:bg-hover hover:text-fg2" onClick={onFit}>Fit</button>
    </div>
  );
}

/* ---------- palette ---------- */

function Palette({ project, tasks, total, yours, dragging, onDragStart, onDragEnd, onAdd }: {
  project: FlowViewProps["project"];
  tasks: FlowTask[];
  total: number;
  yours: number;
  dragging: number | null;
  onDragStart: (t: FlowTask) => void;
  onDragEnd: () => void;
  onAdd: (t: FlowTask) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = q ? tasks.filter((t) => t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)) : tasks;
  const empty = q
    ? "No tasks match."
    : total ? `Every open task in ${project.name} is in the flow.` : `No tasks in ${project.name} yet. Press C to add one.`;
  return (
    <aside aria-label="Add to the flow" className="flex w-[250px] shrink-0 flex-col border-r border-line">
      <div className="flex flex-col gap-2.5 px-3.5 pb-2 pt-3.5">
        <div className="text-[12.5px] font-medium text-fg2">Add to the flow</div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search tasks" placeholder="Search tasks"
          className="h-[30px] rounded-md border border-line2 bg-input px-2.5 text-[12.5px] text-fg2 outline-none placeholder:text-dim focus:border-ctl" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex h-[26px] items-center gap-[7px] px-1.5 text-[12px] text-mut2">
          <Dot color={project.color} size={6} />
          <span className="truncate">{project.name}</span>
        </div>
        {list.map((t) => (
          <button key={t.id} type="button" draggable title="Drag onto the canvas, or click to add it at the end of the flow"
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_TYPE, String(t.id));
              e.dataTransfer.effectAllowed = "move";
              onDragStart(t);
            }}
            onDragEnd={onDragEnd}
            onClick={() => onAdd(t)}
            className={cx("flex h-8 w-full items-center gap-2 rounded-md border px-1.5 text-left",
              dragging === t.id ? "border-dashed border-ctl text-dim" : "border-transparent text-fg2 hover:bg-hover")}>
            <Grip />
            <span className="w-11 shrink-0 font-mono text-[11px] text-mut2">{t.key}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{t.title}</span>
          </button>
        ))}
        {!list.length && <p className="px-1.5 py-1 text-[12px] leading-relaxed text-mut2">{empty}</p>}
        {yours > 0 && !q && (
          <p className="px-1.5 pt-2 text-[12px] leading-relaxed text-mut2">
            {yours === 1 ? "1 task is yours" : `${yours} tasks are yours`}, so {yours === 1 ? "it stays" : "they stay"} out of the flow.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-[7px] border-t border-line px-4 py-3">
        <div className="text-[12px] text-mut2">How the next session starts</div>
        {LEGEND.map((l) => {
          const line = MODE_LINE[l.mode];
          return (
            <span key={l.mode} className="flex items-center gap-2 text-[12px] text-mut">
              <svg width="24" height="8" viewBox="0 0 24 8" aria-hidden="true">
                <path d="M1 4H23" stroke={line.stroke === "var(--color-line-strong)" ? "var(--color-mut2)" : line.stroke} strokeWidth={line.width}
                  strokeDasharray={line.dash} strokeLinecap="round" />
              </svg>
              {l.label}
            </span>
          );
        })}
      </div>
    </aside>
  );
}

function Grip() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" className="shrink-0">
      {[2, 6, 10].flatMap((y) => [2, 6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" fill="var(--color-faint)" />))}
    </svg>
  );
}

/* ---------- canvas layers ---------- */

function EmptyCanvas() {
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
      <div className="text-[13.5px] text-fg2">Drag tasks here to build the flow</div>
      <div className="max-w-xs text-[12.5px] leading-relaxed text-mut2">
        Each task runs as one agent session. Connect them to decide which session starts after which.
      </div>
    </div>
  );
}

/** Preview of a palette task while it's dragged over the canvas. */
function GhostNode({ task, x, y, after }: { task: FlowTask; x: number; y: number; after: FlowTask | undefined }) {
  const [path] = after
    ? getBezierPath({
      sourceX: (after.flowX ?? 0) + NODE_W / 2, sourceY: (after.flowY ?? 0) + NODE_H, sourcePosition: Position.Bottom,
      targetX: x + NODE_W / 2, targetY: y - 7, targetPosition: Position.Top,
    })
    : [""];
  return (
    <>
      {after && (
        <svg aria-hidden="true" width="1" height="1" className="pointer-events-none absolute left-0 top-0 overflow-visible">
          <path d={path} fill="none" stroke={ACCENT_LINE} strokeWidth={1.5} strokeDasharray="5 4" />
        </svg>
      )}
      <div className="pointer-events-none absolute left-0 top-0 flex flex-col gap-[3px] rounded-lg border border-dashed border-accent/60 bg-accent/5 px-3 py-[7px]"
        style={{ width: NODE_W, height: NODE_H, transform: `translate(${x}px, ${y}px)` }}>
        <div className="flex h-[14px] items-center gap-[7px] leading-[14px]">
          <ToneIcon tone="queued" />
          <span className="font-mono text-[11px] text-mut2">{task.key}</span>
        </div>
        <div className="h-[18px] truncate text-[13px] leading-[18px] text-fg2">{task.title}</div>
        <div className="h-4 truncate text-[11.5px] leading-4 text-accent-fg">
          {after ? `Drop to run after ${after.key}` : `Drop to add it here, run by ${AGENT_LABEL[task.agent]}`}
        </div>
      </div>
    </>
  );
}

/* ---------- node and edge ---------- */

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "done") return <StatusIcon status="done" size={13} />;
  if (tone === "canceled") return <StatusIcon status="canceled" size={13} />;
  const ring = { waiting: ACCENT, running: "var(--color-fg3)", ready: "var(--color-mut2)", queued: "var(--color-dim)", stopped: "var(--color-dim)" }[tone];
  return (
    <svg width={13} height={13} viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r="6" fill="none" stroke={ring} strokeWidth="1.5" strokeDasharray={tone === "queued" ? "2 2" : undefined} />
      {tone === "waiting" && <circle cx="7" cy="7" r="2.5" fill={ACCENT} />}
      {tone === "running" && <path d="M7 3 A4 4 0 0 1 7 11 Z" fill="var(--color-fg3)" />}
      {tone === "stopped" && <path d="M4.5 7 H9.5" stroke="var(--color-dim)" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

function HandleDot({ on = false }: { on?: boolean }) {
  return (
    <span className={cx(
      "pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] bg-panel",
      on ? "border-accent" : "border-line-strong group-hover:border-mut2 in-[.valid]:border-accent",
    )} />
  );
}

function TaskNodeView({ id, data, selected }: NodeProps<TaskNode>) {
  const done = data.tone === "done" || data.tone === "canceled";
  return (
    <div className={cx(
      "group flex h-full w-full flex-col gap-[3px] rounded-lg border px-3 py-[7px]",
      done ? "bg-panel" : "bg-raised",
      selected ? "border-accent shadow-[0_0_0_1px_var(--color-accent)]" : done ? "border-line" : "border-ctl",
    )}>
      <Handle type="target" position={Position.Top} isConnectableStart={false} style={HANDLE_STYLE}><HandleDot /></Handle>
      <div className="flex h-[14px] items-center gap-[7px] leading-[14px]">
        <ToneIcon tone={data.tone} />
        <span className="font-mono text-[11px] text-mut2">{data.key}</span>
        <span className="flex-1" />
        <span className={cx("whitespace-nowrap text-[11px]", data.tone === "waiting" ? "text-fg2" : "text-mut2")}>{data.state}</span>
      </div>
      <div className={cx("h-[18px] truncate text-[13px] leading-[18px]", done ? "text-mut2" : "text-strong")}>{data.title}</div>
      <div className="flex h-4 min-w-0 items-center gap-1.5 text-[11.5px] leading-4">
        <AgentChip taskId={Number(id)} agent={data.agent} done={done} />
        <span className="truncate text-mut2">{data.note}</span>
      </div>
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE}><HandleDot on={data.linkOut} /></Handle>
    </div>
  );
}

/** Who runs the session. Clicking hands it to the other agent (with anything that shares its session). */
function AgentChip({ taskId, agent, done }: { taskId: number; agent: AgentId; done: boolean }) {
  const switchAgent = useContext(SwitchAgent);
  const label = <><Icon name="terminal" size={10} strokeWidth={2} className="shrink-0" />{AGENT_LABEL[agent]}</>;
  const look = "flex h-4 shrink-0 items-center gap-1 whitespace-nowrap rounded-[4px] border border-ctl px-1.5 text-[10.5px] leading-none text-mut";
  if (done) return <span className={look}>{label}</span>;
  return (
    <button type="button" title={`${AGENT_LABEL[agent]} runs this. Click to hand it to ${AGENT_LABEL[otherAgent(agent)]}.`}
      onClick={(e) => { e.stopPropagation(); switchAgent(taskId); }}
      className={cx("nodrag nopan hover:border-line-strong hover:text-fg2", look)}>
      {label}
    </button>
  );
}

function ModeEdgeView({ id, target, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<ModeEdge>) {
  const pick = useContext(PickNode);
  if (!data) return null;
  // Handles sit centred on the node's border; draw from the source's bottom edge to just above the target.
  const top = targetY + HANDLE / 2;
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY: sourceY - HANDLE / 2, sourcePosition: Position.Bottom, targetX, targetY: top - 7, targetPosition: Position.Top,
  });
  const line = MODE_LINE[data.mode];
  const hot = !!selected || data.into;
  const stroke = hot ? ACCENT : data.spent ? "var(--color-ctl)" : line.stroke;
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={18}
        style={{ stroke, strokeWidth: line.width, strokeDasharray: line.dash, strokeLinecap: "round" }} />
      <path d={`M ${targetX - 4} ${top - 9} L ${targetX} ${top - 3} L ${targetX + 4} ${top - 9}`} fill="none" stroke={stroke}
        strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {data.showLabel && (
        <EdgeLabelRenderer>
          <button type="button" title="Change how it starts" onClick={() => pick(Number(target))}
            className={cx(
              "nodrag nopan absolute left-0 top-0 flex h-5 items-center whitespace-nowrap rounded-full border bg-raised px-2 text-[11px] hover:border-line-strong",
              hot ? "border-accent/60 text-fg2" : data.spent ? "border-ctl text-dim" : "border-ctl text-mut",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: "all" }}>
            {data.label}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/* ---------- inspector ---------- */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[12px] text-mut2">{title}</div>
      {children}
    </div>
  );
}

function Inspector({ project, task, info, session, graph, flowOn, now, defaultAt, onAgent, onStart, onStartNow, onRemove }: {
  project: FlowViewProps["project"];
  task: FlowTask;
  info: NodeInfo;
  session: Session | undefined;
  graph: Graph;
  flowOn: boolean;
  now: number;
  defaultAt: string;
  onAgent: (agent: AgentId) => void;
  onStart: (mode: EdgeMode, atTime: string | null) => void;
  onStartNow: () => void;
  onRemove: () => void;
}) {
  const incoming = graph.incoming.get(task.id) ?? [];
  const outgoing = graph.outgoing.get(task.id) ?? [];
  const mode = startMode(incoming);
  const sources = incoming.map((e) => graph.byId.get(e.fromTaskId)).filter((t): t is FlowTask => !!t);
  const src = names(sources.map((t) => t.key));
  const srcAgent = sources[0]?.agent ?? task.agent;
  const at = incoming.find((e) => e.mode === "time" && e.atTime)?.atTime ?? null;
  const [draft, setDraft] = useState(at ?? defaultAt);
  const validDraft = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(draft);
  const active = session?.status === "running" || session?.status === "starting";
  const options: { mode: EdgeMode; title: string; desc: string }[] = [
    { mode: "auto", title: "Automatically", desc: `A new ${AGENT_LABEL[task.agent]} session starts as soon as ${src} finishes.` },
    { mode: "manual", title: "Manually", desc: `Starts after you mark ${src} done.` },
    {
      mode: "session", title: "In the same session",
      desc: `${agentShort(srcAgent)} carries on from ${src} in the same terminal, without stopping.` +
        (srcAgent !== task.agent ? ` Hands it to ${AGENT_LABEL[srcAgent]}.` : ""),
    },
    { mode: "time", title: "At a set time", desc: `${atLabel(at ?? (validDraft ? draft : defaultAt))}, once ${src} is done.` },
  ];
  const commitTime = () => {
    if (validDraft && draft !== at) onStart("time", draft);
  };
  const next = outgoing.length ? outgoing.map((e) => nextText(e, graph)) : ["Nothing yet. Drag a task below it to continue."];

  return (
    <aside aria-label="Selected session" className="flex w-[320px] shrink-0 flex-col border-l border-line">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-5 pr-3 text-[12.5px] text-mut">
        <span className="font-mono text-[11.5px] text-mut2">{task.key}</span>
        <span className="text-faint">·</span>
        <span className="truncate">{project.name}</span>
        <span className="flex-1" />
        <Link href={`/project/${project.id}?task=${task.key}`} className="inline-flex h-[26px] shrink-0 items-center rounded-md px-2 text-fg3 hover:bg-hover">
          Open task
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-[18px]">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[16px] font-semibold leading-snug text-strong">{task.title}</h2>
          <div className="flex gap-[7px] text-[12.5px] leading-snug text-mut">
            <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TONE_DOT[info.tone] }} />
            <span>{info.state} · {info.note}</span>
          </div>
        </div>

        <Section title="Session">
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-2 text-[12.5px]">
            <span className="text-mut2">Agent</span>
            <div className="flex">
              <Segmented value={task.agent} onChange={onAgent} options={AGENTS.map((a) => ({ value: a, label: AGENT_LABEL[a] }))} />
            </div>
            <span className="text-mut2">Folder</span>
            <span title={project.folder ?? `No project folder: it runs in PacedMind's workspaces/${task.key.toLowerCase()}`}
              className="truncate font-mono text-[11.5px] text-fg3">
              {project.folder ? shortPath(project.folder) : "PacedMind workspace"}
            </span>
            <span className="text-mut2">Branch</span>
            {mode === "session"
              ? <span className="truncate text-fg3">Same branch as {src}</span>
              : <span className="truncate font-mono text-[11.5px] text-fg3">{session?.branch ?? `agent/${task.key.toLowerCase()}`}</span>}
            {session && (
              <>
                <span className="text-mut2">Last run</span>
                <Link href={`/sessions?s=${session.id}`} className="truncate text-fg3 hover:text-strong">{lastRun(session, now)}</Link>
              </>
            )}
          </div>
        </Section>

        <Section title="Starts">
          {incoming.length ? (
            <div role="radiogroup" aria-label="How it starts" className="flex flex-col gap-1.5">
              {options.map((o) => {
                const on = mode === o.mode;
                return (
                  <Fragment key={o.mode}>
                    <button type="button" role="radio" aria-checked={on}
                      onClick={() => { if (!on) onStart(o.mode, o.mode === "time" ? (validDraft ? draft : defaultAt) : null); }}
                      className={cx("flex gap-2.5 rounded-[7px] border px-2.5 py-2 text-left",
                        on ? "border-accent/55 bg-accent/5" : "border-line2 hover:bg-hover")}>
                      <span className={cx("mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                        on ? "border-accent" : "border-line-strong")}>
                        {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] text-fg">{o.title}</span>
                        <span className="text-[12px] leading-[1.45] text-mut2">{o.desc}</span>
                      </span>
                    </button>
                    {o.mode === "time" && on && (
                      <input type="datetime-local" aria-label="Start at" value={draft}
                        onChange={(e) => setDraft(e.target.value)} onBlur={commitTime}
                        onKeyDown={(e) => { if (e.key === "Enter") commitTime(); }}
                        className="h-[30px] rounded-md border border-line2 bg-input px-2.5 text-[12.5px] text-fg2 outline-none focus:border-ctl" />
                    )}
                  </Fragment>
                );
              })}
              {mode === "mixed" && (
                <p className="text-[12px] leading-relaxed text-mut2">Its connections start in different ways. Pick one to use for all of them.</p>
              )}
            </div>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-mut2">
              Nothing leads here, so you start it yourself. To run it after another task, drag from the dot under that task to the dot above this one.
            </p>
          )}
        </Section>

        <Section title="When it finishes">
          <div className="flex flex-col gap-1.5">
            {next.map((text, i) => (
              <div key={i} className="flex gap-2 text-[12.5px] leading-[1.45] text-fg3">
                <Icon name="arrowRight" size={12} strokeWidth={2.2} className="mt-[3px] shrink-0 text-dim" />
                <span>{text}</span>
              </div>
            ))}
            {!flowOn && outgoing.some((e) => e.mode !== "session") && (
              <p className="text-[12px] leading-relaxed text-mut2">The flow is paused, so these don&apos;t start on their own.</p>
            )}
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 pb-4 pt-3">
        <Button onClick={onStartNow} disabled={active || task.status === "done" || task.status === "canceled"}
          title={active ? "A session for this task is already running" : `Open ${AGENT_LABEL[task.agent]} in a new terminal`}>
          <Icon name="terminal" size={12} strokeWidth={2} />Start session now
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onRemove}>Remove from flow</Button>
      </div>
    </aside>
  );
}

function EdgeInspector({ edge, graph, onPick, onRemove }: {
  edge: FlowEdge;
  graph: Graph;
  onPick: (taskId: number) => void;
  onRemove: () => void;
}) {
  const from = graph.byId.get(edge.fromTaskId);
  const to = graph.byId.get(edge.toTaskId);
  return (
    <aside aria-label="Selected connection" className="flex w-[320px] shrink-0 flex-col border-l border-line">
      <div className="flex h-11 shrink-0 items-center border-b border-line px-5 text-[12.5px] text-mut">Connection</div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-[18px]">
        <div className="flex items-center gap-2 font-mono text-[13px] text-fg2">
          {from?.key}<Icon name="arrowRight" size={13} className="text-dim" />{to?.key}
        </div>
        <p className="text-[12.5px] leading-relaxed text-mut">{nextText(edge, graph)}.</p>
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="text-mut2">Starts</span>
          <span className="text-fg2">{EDGE_LABEL[edge.mode]}{edge.mode === "time" && edge.atTime ? `, ${atLabel(edge.atTime)}` : ""}</span>
        </div>
        {to && <Button className="self-start" onClick={() => onPick(to.id)}>Change how {to.key} starts</Button>}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 pb-4 pt-3">
        <Button variant="ghost" onClick={onRemove}><Icon name="trash" size={13} />Remove connection</Button>
        <span className="flex-1" />
        <Kbd>Delete</Kbd>
      </div>
    </aside>
  );
}

function EmptyInspector() {
  return (
    <aside aria-label="Selected session" className="flex w-[320px] shrink-0 flex-col border-l border-line">
      <div className="flex h-11 shrink-0 items-center border-b border-line px-5 text-[12.5px] text-mut">Nothing selected</div>
      <div className="flex flex-col gap-3 px-5 py-[18px] text-[12.5px] leading-relaxed text-mut2">
        <p>Select a session on the canvas to choose its agent and how it starts.</p>
        <p>Put sessions anywhere on the grid. To run one after another, drag from the dot under the first to the dot above the second.</p>
        <p>Click the agent on a session to hand it to Claude Code or Codex. Tidy up lines everything up in the order it runs. <Kbd>Delete</Kbd> removes what&apos;s selected.</p>
      </div>
    </aside>
  );
}
