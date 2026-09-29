"use server";

import { refresh } from "next/cache";
import * as repo from "@/server/repo";
import { guardAction } from "@/server/guard";

type Result = { ok: boolean; error?: string };

/** Saves a task order: the tasks get sort orders 1, 2, 3… in the given order. */
export async function reorderTasksAction(taskIds: number[]): Promise<Result> {
  await guardAction();
  if (!Array.isArray(taskIds) || !taskIds.every(Number.isInteger)) return { ok: false, error: "Invalid task order" };
  const current = new Map((await repo.listTasks()).map((t) => [t.id, t.sortOrder]));
  await Promise.all(taskIds.map((id, i) => (current.has(id) && current.get(id) !== i + 1 ? repo.updateTask(id, { sortOrder: i + 1 }) : null)));
  refresh();
  return { ok: true };
}

/** Makes `nextId` the project that starts once `projectId` is done, or none when it's null. */
export async function setNextProjectAction(projectId: string, nextId: string | null): Promise<Result> {
  await guardAction();
  if (nextId === projectId) return { ok: false, error: "A project can't start after itself" };
  const projects = await repo.listProjects();
  if (!projects.some((p) => p.id === projectId) || (nextId && !projects.some((p) => p.id === nextId))) {
    return { ok: false, error: "Project not found" };
  }
  for (const p of projects) {
    if (p.afterProjectId === projectId && p.id !== nextId) {
      await repo.updateProject(p.id, { afterProjectId: null });
    }
  }
  if (nextId) {
    await repo.updateProject(nextId, { afterProjectId: projectId });
  }
  refresh();
  return { ok: true };
}
