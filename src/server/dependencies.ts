import "server-only";
import * as repo from "./repo";
import type { Task } from "@/lib/types";

/*
 * Dependencies between tasks (drawn on the Timeline, or connect_tasks over MCP): a task waits for the ones before it.
 * They only order the work: nothing starts by itself.
 */

/**
 * Whether a task is far enough for the tasks that wait for it: done, or handed back for review. A hand-back that was
 * partial or blocked (`held`, repo.heldOutcomes) keeps them waiting until you mark it done.
 */
export const unblocks = (source: Task, held: Set<number>) => source.status === "done" || (source.status === "review" && !held.has(source.id));

/** The next task in a project that is ready to be worked on: open, first in its order, with nothing it waits for still open. */
export async function nextReadyTask(projectId: string): Promise<Task | null> {
  const [edges, tasks, held] = await Promise.all([repo.listEdges(), repo.listTasks(), repo.heldOutcomes()]);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const heldIds = new Set(held.keys());
  const open = tasks
    .filter((t) => t.projectId === projectId && (t.status === "todo" || t.status === "backlog"))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return open.find((t) => edges.filter((e) => e.toTaskId === t.id).every((e) => {
    const source = byId.get(e.fromTaskId);
    return !source || unblocks(source, heldIds);
  })) ?? null;
}
