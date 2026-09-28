"use client";

import { useState } from "react";
import { setAreaFolderAction } from "@/app/actions";
import type { Area, Project } from "@/lib/types";
import { Picker } from "./picker";
import { Button, useAction } from "./ui";

/** A local folder shared by this area's tasks, with existing project folders offered as choices. */
export function AreaWorkspace({ area, projects, onSaved, compact = false }: { area: Area; projects: Project[]; onSaved?: () => void; compact?: boolean }) {
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
      <span className="col-span-2 text-[12px] text-fg2">Workspace for {area.name}</span>
      <Picker label={`Workspace for ${area.name}`} values={[folder]} options={[
        { value: "", label: "No area workspace" }, ...folders.map((f) => ({ value: f, label: f })),
        ...(folder && !folders.includes(folder) ? [{ value: folder, label: folder }] : []),
      ]} custom={(text) => text || null} onChange={([value]) => setFolder(value)} placeholder="Choose or enter a folder" />
      {!compact && <p className="text-[11.5px] leading-relaxed text-mut2">
        Tasks use this folder unless the task or its project has its own. Choose the same folder as your project in Codex or Claude.
        Choose No area workspace to remove the default. Saved only on this computer.
      </p>}
      <Button type="submit" size="sm" disabled={pending || (folder.trim() || null) === area.folder} className="self-end">Save workspace</Button>
    </form>
  );
}
