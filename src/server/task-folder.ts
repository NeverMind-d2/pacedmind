import "server-only";
import fs from "node:fs";
import path from "node:path";
import { areaFolder, dataDir, projectFolder } from "./device";
import { folderProblem } from "./folders";
import type { Task } from "@/lib/types";

type FolderTask = Pick<Task, "key" | "projectId" | "areaId" | "folder">;
const TASK_KEY = /^[A-Z][A-Z0-9]{1,7}-[1-9][0-9]{0,8}$/;

/** All configured paths come from this computer's settings. Never use a folder from a cloud row. */
function configuredFolder(task: FolderTask): string | null {
  return task.folder ?? projectFolder(task.projectId) ?? areaFolder(task.areaId);
}

/** Task → project → area → private scratch folder. Also used in launch approvals and tool previews. */
export function plannedFolder(task: FolderTask): string | null {
  if (!TASK_KEY.test(task.key)) return null;
  return configuredFolder(task) ?? path.join(dataDir(), "workspaces", task.key.toLowerCase());
}

export function resolveFolder(task: FolderTask): { folder?: string; error?: string } {
  const folder = plannedFolder(task);
  if (!folder) return { error: "Invalid task key" };
  if (configuredFolder(task)) {
    const problem = folderProblem(folder);
    if (problem) return { error: `Can't use the folder ${folder}: ${problem} Change it ${task.folder ? "in the task's details" : "in Settings → Projects"}.` };
  } else {
    fs.mkdirSync(folder, { recursive: true });
  }
  return { folder };
}
