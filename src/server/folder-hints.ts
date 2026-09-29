import "server-only";
import fs from "node:fs";
import path from "node:path";
import { dataDir, deviceConfig } from "./device";
import { findWork, inside, keyOf, type FoundArea, type FoundProject } from "./import";
import { markedAround, type Marker } from "./marker";
import { MODE } from "./supabase";
import type { Area, FolderHints, FoundFolder, Project } from "@/lib/types";

/*
 * Whether your projects and areas are on this computer. One without a folder here is looked for among what import.ts
 * finds (the folders you work in with Claude Code and Codex, the repositories in and around them, and the folders that
 * hold them, as areas) and the projects' folders here: by its pacedmind.md (marker.ts) first, then by its repository
 * (Project.repo, Area.repo, which a computer with its folder read from its copy), for an area by the projects of yours
 * in it, else by its name. Nothing is set from this: the app offers what it found, and you choose. Looking takes a
 * moment, so the last result is kept and read again in the background once it's a minute old.
 */

const FRESH = 60_000;
type Kept = { at: number; list: FoundProject[]; boxes: FoundArea[]; marked: { folder: string; marker: Marker }[] };
const g = globalThis as unknown as { __pacedmindFolders?: Kept; __pacedmindFoldersRead?: Promise<void> | null };

/** Reads the folders again, one read at a time. */
export function refreshFolders(): Promise<void> {
  g.__pacedmindFoldersRead ??= findWork({ link: false })
    .then(({ projects: list, areas: boxes }) => {
      const d = deviceConfig();
      const marked = markedAround([...Object.values(d.folders), ...Object.values(d.areaFolders), ...list.map((f) => f.folder)]);
      g.__pacedmindFolders = { at: Date.now(), list, boxes, marked };
    })
    .catch((e) => console.error("[organizer] finding folders failed", e))
    .finally(() => { g.__pacedmindFoldersRead = null; });
  return g.__pacedmindFoldersRead;
}

async function workFolders(): Promise<{ work: FoundProject[]; boxes: FoundArea[]; marked: Kept["marked"] }> {
  const kept = g.__pacedmindFolders;
  if (!kept) await refreshFolders();
  else if (Date.now() - kept.at > FRESH) void refreshFolders();
  return {
    work: (g.__pacedmindFolders?.list ?? []).filter((f) => !f.problem),
    boxes: (g.__pacedmindFolders?.boxes ?? []).filter((b) => !b.problem),
    marked: g.__pacedmindFolders?.marked ?? [],
  };
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
  const { work, boxes, marked } = await workFolders();
  const known = [
    ...projects.flatMap((p) => (p.folder ? [{ folder: p.folder, repo: p.repo }] : [])),
    ...work.map((f) => ({ folder: f.folder, repo: f.repo })),
  ];
  const taken = new Set(projects.flatMap((p) => (p.folder ? [keyOf(p.folder)] : [])));
  // A folder that holds two or more of the others (like a "Projects" folder) is nobody's copy.
  const holder = (f: FoundProject) => work.filter((o) => inside(keyOf(o.folder), keyOf(f.folder))).length >= 2;

  const copies = (kind: "project" | "area", target: { id: string; name: string; repo: string | null }): FoundFolder[] => {
    const out = new Map<string, FoundFolder>();
    // Its own pacedmind.md is the surest: it names it by id.
    for (const m of marked) {
      if (m.marker[kind]?.id === target.id.toLowerCase() && (kind === "area" || !taken.has(keyOf(m.folder)))) {
        out.set(keyOf(m.folder), { folder: m.folder, repo: null, how: "marker" });
      }
    }
    // An area folder found here that is this area, by what the search recognised it by (its projects, say).
    if (kind === "area") {
      for (const b of boxes) {
        if (b.joins?.id === target.id && !out.has(keyOf(b.folder))) out.set(keyOf(b.folder), { folder: b.folder, repo: null, how: b.joins.how });
      }
    }
    if (target.repo) {
      // One kept as "host/owner/name#sub" is the folder `sub` in a copy of the repository.
      const [root, sub] = target.repo.split("#");
      for (const k of known) {
        if (k.repo === target.repo && !out.has(keyOf(k.folder))) out.set(keyOf(k.folder), { folder: k.folder, repo: target.repo, how: "repo" });
        else if (sub && k.repo === root) {
          const folder = path.join(k.folder, ...sub.split("/"));
          if (isFolder(folder) && !out.has(keyOf(folder))) out.set(keyOf(folder), { folder, repo: target.repo, how: "repo" });
        }
      }
    } else if (!out.size) {
      for (const f of work) {
        // An area's workspace holds its projects, so only a project's copy can't be a folder of folders.
        if (!taken.has(keyOf(f.folder)) && (kind === "area" || !holder(f)) && plain(f.name) === plain(target.name)) {
          out.set(keyOf(f.folder), { folder: f.folder, repo: f.repo, how: "name" });
        }
      }
    }
    return [...out.values()].slice(0, 5);
  };

  const found = <T extends { id: string; folder: string | null; name: string; repo: string | null }>(kind: "project" | "area", items: T[]) =>
    Object.fromEntries(items.flatMap((x) => {
      const list = x.folder ? [] : copies(kind, x);
      return list.length ? [[x.id, list]] : [];
    }));
  return { projects: found("project", projects), areas: found("area", areas), workspaces: path.join(dataDir(), "workspaces") };
}
