/*
 * Flow canvas geometry and layout, shared by the canvas (src/components/views/flow.tsx) and the server
 * (src/server/ops.ts, used by the MCP tools). Sessions sit anywhere on a free grid; no agent has a column.
 */

export const NODE_W = 220;
export const NODE_H = 70;
export const GRID = 20;
/** A row of the tidy layout: a node and the gap below it, where the connection's label sits. */
export const ROW = 140;
/** A column of the tidy layout: a node and the gap beside it. */
export const COL = 280;

export const snap = (v: number) => Math.round(v / GRID) * GRID;

export type Point = { x: number; y: number };
export interface LayoutItem extends Point { id: number; sortOrder: number }
export interface LayoutLink { fromTaskId: number; toTaskId: number }

/**
 * Lays a flow out top to bottom in the order its sessions run: each task one row below the last task it waits
 * for, under the tasks it follows where there's room, with branches side by side. Tasks keep their left-to-right
 * order. Returns task id → position.
 */
export function layoutFlow(items: LayoutItem[], links: LayoutLink[]): Map<number, Point> {
  const byId = new Map(items.map((t) => [t.id, t]));
  const live = links.filter((l) => l.fromTaskId !== l.toTaskId && byId.has(l.fromTaskId) && byId.has(l.toTaskId));
  const before = (a: LayoutItem, b: LayoutItem) => a.y - b.y || a.x - b.x || a.sortOrder - b.sortOrder;

  // Run order; anything caught in a loop goes last, in its current order.
  const indegree = new Map(items.map((t) => [t.id, 0]));
  for (const l of live) indegree.set(l.toTaskId, (indegree.get(l.toTaskId) ?? 0) + 1);
  const ready = items.filter((t) => !indegree.get(t.id));
  const order: LayoutItem[] = [];
  while (ready.length) {
    ready.sort(before);
    const t = ready.shift()!;
    order.push(t);
    for (const l of live) {
      if (l.fromTaskId !== t.id) continue;
      const left = (indegree.get(l.toTaskId) ?? 1) - 1;
      indegree.set(l.toTaskId, left);
      if (left === 0) ready.push(byId.get(l.toTaskId)!);
    }
  }
  const row = new Map<number, number>();
  for (const t of order) {
    const above = live.filter((l) => l.toTaskId === t.id).map((l) => row.get(l.fromTaskId) ?? 0);
    row.set(t.id, above.length ? Math.max(...above) + 1 : 0);
  }
  const loopRow = Math.max(-1, ...row.values()) + 1;
  for (const t of items) if (!row.has(t.id)) row.set(t.id, loopRow);

  // Each row left to right: under the tasks it follows (their average), else where it is now,
  // pushed right until it clears the task before it.
  const at = new Map<number, Point>();
  for (const r of [...new Set(row.values())].sort((a, b) => a - b)) {
    const inRow = items
      .filter((t) => row.get(t.id) === r)
      .map((t) => {
        const xs = live.filter((l) => l.toTaskId === t.id).flatMap((l) => at.get(l.fromTaskId)?.x ?? []);
        return { t, want: xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : t.x };
      })
      .sort((a, b) => a.want - b.want || a.t.x - b.t.x || a.t.sortOrder - b.t.sortOrder);
    let next = -Infinity;
    for (const { t, want } of inRow) {
      const x = Math.max(snap(want), next);
      at.set(t.id, { x, y: r * ROW });
      next = x + COL;
    }
  }
  const left = Math.min(...[...at.values()].map((p) => p.x));
  if (Number.isFinite(left)) for (const p of at.values()) p.x -= left;
  return at;
}

/** Where a new node goes: below the task it runs after, else under everything, moved right past any node in its way. */
export function freeSpot(nodes: Point[], below?: Point): Point {
  const y = snap(below ? below.y + ROW : nodes.length ? Math.max(...nodes.map((p) => p.y)) + ROW : 0);
  let x = snap(below ? below.x : nodes.length ? Math.min(...nodes.map((p) => p.x)) : 0);
  const blocked = (cx: number) => nodes.some((p) => Math.abs(p.x - cx) < NODE_W + GRID && Math.abs(p.y - y) < NODE_H + GRID);
  while (blocked(x)) x += COL;
  return { x, y };
}
