import "server-only";
import crypto from "node:crypto";
import * as repo from "./repo";
import { folderApprovals, handledFolderRequests, type ApprovalFrom, type FolderApproval } from "./approval-store";
import { folderProblem } from "./folders";
import { linkFolder, linkWorkspace } from "./project-links";
import type { FolderTargetKind } from "@/lib/types";

/*
 * Folders asked for from outside this window: an agent asks to use a folder for a project, an area (its workspace) or a
 * task on one of your computers. Folders are each computer's own settings (device.ts), so a request only suggests one:
 * it waits in that computer's window, which checks the folder (folders.ts) and sets it once you allow it, as picking it
 * in Settings or a task's details does. Nothing sets one by itself.
 * - An agent on this computer's own MCP server: an approval here (askForFolder).
 * - From elsewhere (an agent signed in to PacedMind Cloud, the web app, an agent on another computer): a folder request
 *   in the account (folder_requests), which only the computer it names picks up (syncFolderRequests) and settles.
 */

export type FolderTarget = { kind: FolderTargetKind; id: string };

/** How long a folder an agent here asked for waits for you. One from elsewhere waits as long as its request (a day). */
const TTL_MS = 30 * 60_000;

/** What gets the folder, as the approval shows it; null when it's gone. */
async function targetName(t: FolderTarget): Promise<string | null> {
  if (t.kind === "project") return (await repo.getProject(t.id))?.name ?? null;
  if (t.kind === "area") {
    const area = (await repo.listAreas()).find((a) => a.id === t.id);
    return area ? `${area.name}'s workspace` : null;
  }
  const task = Number.isSafeInteger(Number(t.id)) ? await repo.getTask(Number(t.id)) : null;
  return task ? `${task.key} ${task.title}` : null;
}

/**
 * Puts a folder in front of you, after checking that it can be one here. Returns the approval, or why it can't be asked
 * for (the target is gone, or the folder isn't one here).
 */
export async function askForFolder(
  target: FolderTarget, folder: string, from: ApprovalFrom, requestId: string | null, times?: { at: number; until: number },
): Promise<FolderApproval | string> {
  const name = await targetName(target);
  if (!name) return `That ${target.kind} is gone.`;
  const problem = folderProblem(folder);
  if (problem) return `${folder} can't be a folder on this computer: ${problem}`;
  // A newer folder for the same thing replaces the older one.
  for (const [id, a] of folderApprovals()) {
    if (a.target.kind !== target.kind || a.target.id !== target.id) continue;
    folderApprovals().delete(id);
    if (a.requestId) await repo.settleFolderRequest(a.requestId, "failed", "A newer request for the same folder replaced it");
  }
  const now = Date.now();
  const a: FolderApproval = {
    id: requestId ?? crypto.randomUUID(), requestId, from, target, name, folder,
    requestedAt: times?.at ?? now, expiresAt: times?.until ?? now + TTL_MS,
  };
  folderApprovals().set(a.id, a);
  return a;
}

export function pendingFolderApprovals(): FolderApproval[] {
  const now = Date.now();
  for (const [id, a] of folderApprovals()) if (a.expiresAt <= now) folderApprovals().delete(id);
  return [...folderApprovals().values()].sort((a, b) => a.requestedAt - b.requestedAt);
}

export const isFolderApproval = (id: string) => folderApprovals().has(id);

/** Sets the folder as Settings or a task's details would, after checking it again. Why it couldn't, or null. */
async function apply(t: FolderTarget, folder: string): Promise<string | null> {
  const problem = folderProblem(folder);
  if (problem) return problem;
  if (t.kind === "project") {
    const project = await repo.getProject(t.id);
    if (!project) return "The project is gone.";
    await linkFolder(project, folder);
    return null;
  }
  if (t.kind === "area") {
    const area = (await repo.listAreas()).find((a) => a.id === t.id);
    return area ? linkWorkspace(area, folder) : "The area is gone.";
  }
  const task = await repo.getTask(Number(t.id));
  if (!task) return "The task is gone.";
  try {
    await repo.updateTask(task.id, { folder });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}

/** You allowed it in this window: the folder is set, and the request (if it came from elsewhere) says so. */
export async function approveFolder(id: string): Promise<{ ok: boolean; error?: string; message?: string }> {
  const a = folderApprovals().get(id);
  folderApprovals().delete(id);
  if (!a || a.expiresAt <= Date.now()) return { ok: false, error: "That request expired. Ask for the folder again." };
  const problem = await apply(a.target, a.folder);
  if (a.requestId) await repo.settleFolderRequest(a.requestId, problem ? "failed" : "done", problem ?? "Set on the computer");
  return problem ? { ok: false, error: problem } : { ok: true, message: `${a.name} uses ${a.folder} here now` };
}

export async function refuseFolder(id: string) {
  const a = folderApprovals().get(id);
  folderApprovals().delete(id);
  if (a?.requestId) await repo.settleFolderRequest(a.requestId, "refused", "Refused on the computer");
}

/**
 * The folder requests sent to this computer, every few seconds while it's signed in (requests.ts): each is put in front
 * of you once, or settled when it can't be one here. Those waiting too long expire.
 */
export async function syncFolderRequests(here: string, now: number) {
  const pending = await repo.listFolderRequests({ deviceId: here, status: ["pending"] });
  const open = new Set(pending.map((r) => r.id));
  for (const [id, a] of folderApprovals()) if (a.requestId && !open.has(a.requestId)) folderApprovals().delete(id);
  for (const r of pending) {
    if (Date.parse(r.expiresAt) <= now) {
      folderApprovals().delete(r.id);
      await repo.settleFolderRequest(r.id, "expired");
      continue;
    }
    if (handledFolderRequests().has(r.id)) continue;
    handledFolderRequests().add(r.id);
    const from: ApprovalFrom = r.requestedVia === "agent" ? "agentElsewhere" : "elsewhere";
    const asked = await askForFolder(r.target, r.folder, from, r.id, { at: Date.parse(r.requestedAt), until: Date.parse(r.expiresAt) });
    if (typeof asked === "string") await repo.settleFolderRequest(r.id, "failed", asked);
  }
}
