"use client";

import { useState } from "react";
import { setAreaFolderAction } from "@/app/actions";
import { repoLink, type Area, type Project } from "@/lib/types";
import { Picker } from "./picker";
import { Button, useAction } from "./ui";

/**
 * A local folder shared by this area's tasks, with existing project folders offered as choices. `found`: this
 * computer's copies of the repository the area's workspace holds on your other computers (Area.repo), offered first.
 */
export function AreaWorkspace({ area, projects, onSaved, compact = false, found = [] }: {
  area: Area; projects: Project[]; onSaved?: () => void; compact?: boolean; found?: string[];
}) {
  const [folder, setFolder] = useState(area.folder ?? "");
  const { pending, run } = useAction();
  const link = repoLink(area.repo);
  const folders = [...new Set([...found, ...projects.map((p) => p.folder).filter((f): f is string => !!f)])];
  return (
    <form className={compact ? "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2" : "flex flex-col gap-2"} onSubmit={(e) => {
      e.preventDefault();
      run(async () => {
        const result = await setAreaFolderAction(area.id, folder.trim() || null);
        if (result.ok) onSaved?.();
        return result;
      });
    }}>
      <span className="col-span-2 flex min-w-0 items-baseline gap-2 text-[12px] text-fg2">
        Workspace for {area.name}
        {link && <a href={link.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[11.5px] text-mut2 hover:text-fg2">{link.label}</a>}
      </span>
      <Picker label={`Workspace for ${area.name}`} values={[folder]} options={[
        { value: "", label: "No area workspace" },
        ...folders.map((f) => ({ value: f, label: found.includes(f) && link ? `${f} · ${link.label}` : f })),
        ...(folder && !folders.includes(folder) ? [{ value: folder, label: folder }] : []),
      ]} custom={(text) => text || null} onChange={([value]) => setFolder(value)} placeholder="Choose or enter a folder" />
      {!compact && <p className="text-[11.5px] leading-relaxed text-mut2">
        Tasks use this folder unless their project or the task has its own. Saved on this computer only.
      </p>}
      <Button type="submit" size="sm" disabled={pending || (folder.trim() || null) === area.folder} className="self-end">Save workspace</Button>
      {!area.folder && found.length > 0 && link && (
        <p className="col-span-2 text-[11.5px] leading-relaxed text-mut2">
          On your other computers this workspace holds {link.label}. {found.length === 1 ? `It's at ${found[0]} here.` : "It's in the folders listed first."}
        </p>
      )}
    </form>
  );
}
