import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./device";
import { findProjects, inside, keyOf, type FoundProject } from "./import";
import { MODE } from "./supabase";
import type { Area, FolderHints, FoundFolder, Project } from "@/lib/types";

/*
 * Whether your projects and areas are on this computer. One without a folder here is looked for among the folders you
 * work in with Claude Code and Codex (import.ts) and the projects' folders here: by its repository (Project.repo,
 * Area.repo, which a computer with its folder read from its copy), else by its name. Nothing is set from this: the app
 * offers what it found, and you choose. Reading the agents' records takes a moment, so the last result is kept and read
 * again in the background once it's a minute old.
 */

const FRESH = 60_000;
const g = globalThis as unknown as { __pacedmindFolders?: { at: number; list: FoundProject[] }; __pacedmindFoldersRead?: Promise<void> | null };

/** Reads the folders again, one read at a time. */
export function refreshFolders(): Promise<void> {
  g.__pacedmindFoldersRead ??= findProjects({ link: false })
    .then((list) => { g.__pacedmindFolders = { at: Date.now(), list }; })
    .catch((e) => console.error("[organizer] finding folders failed", e))
    .finally(() => { g.__pacedmindFoldersRead = null; });
  return g.__pacedmindFoldersRead;
}

async function workFolders(): Promise<FoundProject[]> {
  const kept = g.__pacedmindFolders;
  if (!kept) await refreshFolders();
  else if (Date.now() - kept.at > FRESH) void refreshFolders();
  return (g.__pacedmindFolders?.list ?? []).filter((f) => !f.problem);
}

const plain = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const isFolder = (folder: string) => {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
};

export async function folderHints(areas: Area[], projects: Project[]): Promise<FolderHints | null> {
  if (MODE !== "desktop") return null;
  const work = await workFolders();
  const known = [
    ...projects.flatMap((p) => (p.folder ? [{ folder: p.folder, repo: p.repo }] : [])),
    ...work.map((f) => ({ folder: f.folder, repo: f.repo })),
  ];
  const taken = new Set(projects.flatMap((p) => (p.folder ? [keyOf(p.folder)] : [])));
  // A folder that holds two or more of the others (like a "Projects" folder) is nobody's copy.
  const holder = (f: FoundProject) => work.filter((o) => inside(keyOf(o.folder), keyOf(f.folder))).length >= 2;

  const copies = (target: { name: string; repo: string | null }): FoundFolder[] => {
    const out = new Map<string, FoundFolder>();
    if (target.repo) {
      // One kept as "host/owner/name#sub" is the folder `sub` in a copy of the repository.
      const [root, sub] = target.repo.split("#");
      for (const k of known) {
        if (k.repo === target.repo) out.set(keyOf(k.folder), { folder: k.folder, repo: target.repo, how: "repo" });
        else if (sub && k.repo === root) {
          const folder = path.join(k.folder, ...sub.split("/"));
          if (isFolder(folder)) out.set(keyOf(folder), { folder, repo: target.repo, how: "repo" });
        }
      }
    } else {
      for (const f of work) {
        if (!taken.has(keyOf(f.folder)) && !holder(f) && plain(f.name) === plain(target.name)) {
          out.set(keyOf(f.folder), { folder: f.folder, repo: f.repo, how: "name" });
        }
      }
    }
    return [...out.values()].slice(0, 5);
  };

  const found = <T extends { id: string; folder: string | null; name: string; repo: string | null }>(items: T[]) =>
    Object.fromEntries(items.flatMap((x) => {
      const list = x.folder ? [] : copies(x);
      return list.length ? [[x.id, list]] : [];
    }));
  return { projects: found(projects), areas: found(areas), workspaces: path.join(dataDir(), "workspaces") };
}
