"use client";

import { useId, useState } from "react";
import { setAreaFolderAction } from "@/app/actions";
import type { Area, Project } from "@/lib/types";
import { Button, useAction } from "./ui";

/** A local folder shared by this area's tasks, with existing project folders offered as choices. */
export function AreaWorkspace({ area, projects, onSaved, compact = false }: { area: Area; projects: Project[]; onSaved?: () => void; compact?: boolean }) {
  const id = useId();
  const [folder, setFolder] = useState(area.folder ?? "");
  const { pending, run } = useAction();
  const folders = [...new Set(projects.map((p) => p.folder).filter((f): f is string => !!f))];
  return (
    <form className={compact ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" : "flex flex-col gap-2"} onSubmit={(e) => {
      e.preventDefault();
      run(async () => {
        const result = await setAreaFolderAction(area.id, folder.trim() || null);
        if (result.ok) onSaved?.();
        return result;
      });
    }}>
      <label htmlFor={id} className="col-span-2 text-[12px] text-fg2">Workspace for {area.name}</label>
      <input id={id} list={`${id}-folders`} value={folder} onChange={(e) => setFolder(e.target.value)}
        placeholder="Absolute path to an existing folder" autoComplete="off"
        className="h-8 w-full min-w-0 rounded-md border border-line2 bg-input px-2 font-mono text-[11.5px] text-fg2 outline-none focus:border-line-strong" />
      <datalist id={`${id}-folders`}>{folders.map((f) => <option key={f} value={f} />)}</datalist>
      {!compact && <p className="text-[11.5px] leading-relaxed text-mut2">
        Tasks use this folder unless the task or its project has its own. Choose the same folder as your project in Codex or Claude.
        Clear it to remove the area&apos;s default. Saved only on this computer.
      </p>}
      <Button type="submit" size="sm" disabled={pending || (folder.trim() || null) === area.folder} className="self-end">Save workspace</Button>
    </form>
  );
}
