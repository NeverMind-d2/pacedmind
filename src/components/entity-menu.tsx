"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteAreaAction, deleteProjectAction, updateAreaAction, updateProjectAction } from "@/app/actions";
import { PALETTE, projectColor } from "@/lib/colors";
import type { Area, Project, Usage } from "@/lib/types";
import { ConfirmDialog } from "./dialog";
import { Icon } from "./icons";
import { Popover, PopoverItem, PopoverLabel, PopoverSeparator, anchorOf, type Anchor } from "./popover";
import { cx, useAction } from "./ui";

/** Which area or project menu is open, and where. */
export type OpenMenu = { kind: "area" | "project"; id: string; anchor: Anchor } | null;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const MENU_WIDTH = 240;

export function ColorSwatches({ value, onPick }: { value: string | null; onPick: (color: string) => void }) {
  const current = value?.toUpperCase() ?? null;
  return (
    <div className="flex justify-between px-1.5 pb-1.5 pt-0.5">
      {PALETTE.map((c) => {
        const on = current === c.value.toUpperCase();
        return (
          <button key={c.value} type="button" title={c.name} aria-label={c.name} aria-pressed={on} onClick={() => onPick(c.value)}
            className={cx("flex h-5 w-5 items-center justify-center rounded-[5px] border", on ? "border-strong" : "border-transparent hover:border-[#3a3a3f]")}>
            <span className="h-3 w-3 rounded-full" style={{ background: c.value }} />
          </button>
        );
      })}
    </div>
  );
}

/** A text field that saves on Enter or blur and cancels on Escape. Saves at most once. */
export function InlineName({ initial, placeholder, onSave, onCancel, className }: {
  initial: string; placeholder: string; onSave: (v: string) => void; onCancel: () => void; className?: string;
}) {
  const [v, setV] = useState(initial);
  const settled = useRef(false);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const name = v.trim();
    if (save && name && name !== initial) onSave(name);
    else onCancel();
  };
  return (
    <input autoFocus value={v} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => finish(true)} onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      className={cx("h-6 min-w-0 flex-1 rounded border border-[#3a3a3f] bg-[#030303] px-1.5 text-[13px] text-strong outline-none", className)} />
  );
}

/** The "…" button that opens a row's menu. Shown while the row is hovered or focused, or its menu is open. */
export function MoreButton({ label, open, onOpen, onClose, className }: {
  label: string; open: boolean; onOpen: (a: Anchor) => void; onClose: () => void; className?: string;
}) {
  return (
    <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      // Keep the popover's outside-click handler from closing it before this click toggles it.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.preventDefault(); if (open) onClose(); else onOpen(anchorOf(e.currentTarget)); }}
      className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded text-mut hover:bg-sel hover:text-fg2",
        open ? "bg-sel text-fg2 opacity-100" : "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100", className)}>
      <Icon name="more" size={15} />
    </button>
  );
}

export function AreaMenu({ area, anchor, usage, onClose, onRename, onNewProject }: {
  area: Area; anchor: Anchor; usage: Usage; onClose: () => void; onRename: () => void; onNewProject: () => void;
}) {
  const { run } = useAction();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const u = usage.areas[area.id] ?? { projects: 0, tasks: 0, open: 0 };
  if (confirm) {
    return (
      <ConfirmDialog title={`Delete ${area.name}?`} confirmLabel="Delete area" danger
        onCancel={onClose} onConfirm={() => { run(() => deleteAreaAction(area.id)); onClose(); }}>
        {u.projects ? `${u.projects === 1 ? "Its project" : `Its ${u.projects} projects`} will be deleted too. ` : ""}
        {u.tasks ? `${plural(u.tasks, "task stays", "tasks stay")} and ${u.tasks === 1 ? "moves" : "move"} to the Inbox.` : "It has no tasks."}
      </ConfirmDialog>
    );
  }
  return (
    <Popover anchor={anchor} onClose={onClose} width={MENU_WIDTH}>
      <PopoverLabel>{area.name} <span className="font-mono">{area.key}</span></PopoverLabel>
      <PopoverItem icon={<Icon name="pen" size={14} />} onClick={() => { onClose(); onRename(); }}>Rename</PopoverItem>
      <PopoverItem icon={<Icon name="plus" size={14} />} onClick={() => { onClose(); onNewProject(); }}>New project</PopoverItem>
      <PopoverItem icon={<Icon name="layers" size={14} />} onClick={() => { onClose(); router.push(`/area/${area.id}`); }}>Open tasks</PopoverItem>
      <PopoverSeparator />
      <PopoverLabel>Color</PopoverLabel>
      <ColorSwatches value={area.color} onPick={(c) => run(() => updateAreaAction(area.id, { color: c }))} />
      <PopoverSeparator />
      <PopoverItem icon={<Icon name="trash" size={14} />} danger onClick={() => setConfirm(true)}>Delete area…</PopoverItem>
    </Popover>
  );
}

export function ProjectMenu({ project, areas, anchor, usage, onClose, onRename }: {
  project: Project; areas: Area[]; anchor: Anchor; usage: Usage; onClose: () => void; onRename: () => void;
}) {
  const { run } = useAction();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState(false);
  const area = areas.find((a) => a.id === project.areaId);
  const u = usage.projects[project.id] ?? { tasks: 0, open: 0, done: 0, pct: 0 };
  const go = (href: string) => { onClose(); router.push(href); };
  if (confirm) {
    return (
      <ConfirmDialog title={`Delete ${project.name}?`} confirmLabel="Delete project" danger
        onCancel={onClose} onConfirm={() => { run(() => deleteProjectAction(project.id)); onClose(); }}>
        {u.tasks ? `${plural(u.tasks, "task stays", "tasks stay")} in ${area?.name ?? "the area"} without a project. ` : "It has no tasks. "}
        Its folder, agent and flow settings are removed.
      </ConfirmDialog>
    );
  }
  const others = areas.filter((a) => a.id !== project.areaId);
  return (
    <Popover anchor={anchor} onClose={onClose} width={MENU_WIDTH}>
      <PopoverLabel>{project.name}</PopoverLabel>
      <PopoverItem icon={<Icon name="pen" size={14} />} onClick={() => { onClose(); onRename(); }}>Rename</PopoverItem>
      <PopoverItem icon={<Icon name="layers" size={14} />} onClick={() => go(`/project/${project.id}`)}>Open tasks</PopoverItem>
      <PopoverItem icon={<Icon name="roadmap" size={14} />} onClick={() => go(`/roadmap?p=${project.id}`)}>Open roadmap</PopoverItem>
      <PopoverItem icon={<Icon name="flow" size={14} />} onClick={() => go(`/flows?p=${project.id}`)}>Open flow</PopoverItem>
      <PopoverSeparator />
      <PopoverLabel>Color</PopoverLabel>
      <ColorSwatches value={project.color} onPick={(c) => run(() => updateProjectAction(project.id, { color: c }))} />
      <PopoverItem icon={<span className="h-3 w-3 rounded-full border border-dashed" style={{ borderColor: projectColor({ ...project, color: null }, areas) }} />}
        hint={project.color === null && <Icon name="check" size={13} />}
        onClick={() => project.color !== null && run(() => updateProjectAction(project.id, { color: null }))}>
        Same as {area?.name ?? "its area"}
      </PopoverItem>
      {others.length > 0 && (
        <>
          <PopoverSeparator />
          <PopoverItem icon={<Icon name="arrowRight" size={14} />} hint={<Icon name={moving ? "chevronDown" : "chevronRight"} size={12} />} onClick={() => setMoving((m) => !m)}>
            Move to area
          </PopoverItem>
          {moving && others.map((a) => (
            <PopoverItem key={a.id} icon={<span className="h-2 w-2 rounded-full" style={{ background: a.color }} />}
              onClick={() => { run(() => updateProjectAction(project.id, { areaId: a.id }), `Moved ${project.name} to ${a.name}`); onClose(); }}>
              <span className="pl-1">{a.name}</span>
            </PopoverItem>
          ))}
        </>
      )}
      <PopoverSeparator />
      <PopoverItem icon={<Icon name="trash" size={14} />} danger onClick={() => setConfirm(true)}>Delete project…</PopoverItem>
    </Popover>
  );
}
