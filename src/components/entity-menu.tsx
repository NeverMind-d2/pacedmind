"use client";

import { useEffect, useRef, useState } from "react";
import { deleteAreaAction, deleteProjectAction, setAreaPictureAction, updateAreaAction, updateProjectAction } from "@/app/actions";
import { AREA_ICON_CATEGORIES, areaIconLabel, findAreaIcons, type AreaIcon } from "@/lib/area-icons";
import { AREA_PICTURE_MAX, AREA_PICTURE_PX } from "@/lib/area-picture";
import { PALETTE, projectColor } from "@/lib/colors";
import type { Area, Project, Usage } from "@/lib/types";
import { ConfirmDialog } from "./dialog";
import { AreaIconSvg, AreaMark, AreaPicture, Icon } from "./icons";
import { Popover, PopoverItem, PopoverLabel, PopoverLink, PopoverSeparator, anchorOf, type Anchor } from "./popover";
import { cx, toast, useAction } from "./ui";

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
            className={cx("flex h-5 w-5 items-center justify-center rounded-[5px] border", on ? "border-strong" : "border-transparent hover:border-line-strong")}>
            <span className="h-3 w-3 rounded-full" style={{ background: c.value }} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The area's icon, drawn in its color: every icon by category, or those a search finds by name or meaning (Enter
 * picks the first). Remove puts the area's dot back. The current icon is scrolled into view when the menu opens.
 */
export function AreaIconPicker({ area, onPick }: { area: Pick<Area, "color" | "icon">; onPick: (icon: AreaIcon | null) => void }) {
  const [query, setQuery] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLButtonElement>(null);
  // Only the list scrolls (scrollIntoView could move the page, which closes the menu).
  useEffect(() => {
    if (list.current && current.current) list.current.scrollTop = current.current.offsetTop - 64;
  }, []);
  const found = query.trim() ? findAreaIcons(query) : null;
  const grid = (icons: readonly AreaIcon[]) => (
    <div className="grid grid-cols-8 gap-0.5">
      {icons.map((icon) => (
        <button key={icon} ref={area.icon === icon ? current : undefined} type="button" title={areaIconLabel(icon)} aria-label={areaIconLabel(icon)}
          aria-pressed={area.icon === icon} onClick={() => onPick(icon)}
          className={cx("flex h-[26px] items-center justify-center rounded-[5px] border", area.icon === icon ? "border-strong" : "border-transparent hover:border-line-strong")}>
          <AreaIconSvg icon={icon} color={area.color} size={15} />
        </button>
      ))}
    </div>
  );
  return (
    <>
      <div className="flex items-center justify-between pr-1.5">
        <PopoverLabel>Icon</PopoverLabel>
        {area.icon && (
          <button type="button" title="Show the area's dot instead" onClick={() => onPick(null)} className="rounded px-1 pt-0.5 text-[11.5px] text-mut2 hover:text-fg2">
            Remove
          </button>
        )}
      </div>
      <div className="px-1.5 pb-1.5">
        <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search icons" placeholder="Search icons"
          onKeyDown={(e) => { if (e.key === "Enter" && found?.length) { e.preventDefault(); onPick(found[0]); } }}
          className="mb-1 h-7 w-full rounded-md border border-line2 bg-input px-2 text-[12.5px] text-fg2 outline-none placeholder:text-dim focus:border-ctl" />
        <div ref={list} className="relative max-h-[204px] overflow-y-auto">
          {found
            ? found.length ? grid(found) : <p className="px-1 py-2 text-[12px] text-mut2">No icons match.</p>
            : AREA_ICON_CATEGORIES.map((c) => (
              <div key={c.name}>
                <div className="px-0.5 pb-0.5 pt-1.5 text-[11px] text-mut2">{c.name}</div>
                {grid(c.icons)}
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

/**
 * Draws an image file into what an area's picture is (area-picture.ts): a square PNG of AREA_PICTURE_PX at most,
 * with the whole image fitted in and the rest left clear. Any image the browser shows works, SVG too, and only the
 * PNG leaves the browser. A picture with too much detail for the size limit is tried smaller.
 */
async function areaPictureFrom(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pick a picture: PNG, JPEG, WebP, GIF or SVG.");
  if (file.size > 20_000_000) throw new Error("That file is over 20 MB. Pick a smaller picture.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new Error("That picture couldn't be read."); });
    // An SVG without a size of its own reports none: draw it at the largest size.
    const [w, h] = img.naturalWidth && img.naturalHeight ? [img.naturalWidth, img.naturalHeight] : [AREA_PICTURE_PX, AREA_PICTURE_PX];
    // A small image, such as a favicon, keeps its size rather than turning blurry.
    const largest = Math.min(AREA_PICTURE_PX, Math.max(w, h));
    for (const side of [largest, 48, 32].filter((s) => s <= largest)) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      const g = canvas.getContext("2d");
      if (!g) break;
      g.imageSmoothingQuality = "high";
      const scale = Math.min(side / w, side / h);
      g.drawImage(img, (side - w * scale) / 2, (side - h * scale) / 2, w * scale, h * scale);
      const png = canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
      if (png.length <= AREA_PICTURE_MAX) return png;
    }
    throw new Error("That picture has too much detail to keep small. Try a simpler logo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The area's own picture, such as a company logo, shown instead of its icon. Choosing one opens the file picker; the
 * browser makes it small (areaPictureFrom). Remove puts the area's dot back.
 */
export function AreaPicturePicker({ area, onPick }: { area: Pick<Area, "id" | "picture">; onPick: (picture: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setReading(true);
    try {
      onPick(await areaPictureFrom(file));
    } catch (e) {
      toast(e instanceof Error ? e.message : "That picture couldn't be read.", "error");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <>
      <div className="flex items-center justify-between pr-1.5">
        <PopoverLabel>Picture</PopoverLabel>
        {area.picture && (
          <button type="button" title="Show the area's dot instead" onClick={() => onPick(null)} className="rounded px-1 pt-0.5 text-[11.5px] text-mut2 hover:text-fg2">
            Remove
          </button>
        )}
      </div>
      <PopoverItem icon={area.picture ? <AreaPicture area={area} size={14} /> : <Icon name="image" size={14} />} onClick={() => input.current?.click()}>
        {reading ? "Reading the picture…" : area.picture ? "Replace the picture…" : "Use a picture, such as a logo…"}
      </PopoverItem>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden aria-label="Picture file"
        onChange={(e) => choose(e.target.files?.[0])} />
    </>
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
      className={cx("h-6 min-w-0 flex-1 rounded border border-line-strong bg-input px-1.5 text-[13px] text-strong outline-none", className)} />
  );
}

/**
 * The "…" button that opens a row's menu. Shown while the row is hovered or focused, or its menu is open. A touch
 * screen has no hover: rows that have room for it show it there with `pointer-coarse:opacity-100`.
 */
export function MoreButton({ label, open, onOpen, onClose, className }: {
  label: string; open: boolean; onOpen: (a: Anchor) => void; onClose: () => void; className?: string;
}) {
  // The popover closes itself when a press starts outside it, this button included, so the click that follows
  // goes by whether the menu was open when the press began: a second press closes it instead of opening it again.
  const wasOpen = useRef(false);
  return (
    <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
      onPointerDown={() => { wasOpen.current = open; }}
      onClick={(e) => {
        e.preventDefault();
        if (open || wasOpen.current) onClose();
        else onOpen(anchorOf(e.currentTarget));
        wasOpen.current = false;
      }}
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
      <PopoverLink icon={<Icon name="layers" size={14} />} href={`/area/${area.id}`} onClick={onClose}>Open tasks</PopoverLink>
      <PopoverSeparator />
      <PopoverLabel>Color</PopoverLabel>
      <ColorSwatches value={area.color} onPick={(c) => run(() => updateAreaAction(area.id, { color: c }))} />
      <PopoverSeparator />
      <AreaIconPicker area={area} onPick={(icon) => run(() => updateAreaAction(area.id, { icon }))} />
      <PopoverSeparator />
      <AreaPicturePicker area={area} onPick={(picture) => run(() => setAreaPictureAction(area.id, picture))} />
      <PopoverSeparator />
      <PopoverItem icon={<Icon name="trash" size={14} />} danger onClick={() => setConfirm(true)}>Delete area…</PopoverItem>
    </Popover>
  );
}

export function ProjectMenu({ project, areas, anchor, usage, onClose, onRename }: {
  project: Project; areas: Area[]; anchor: Anchor; usage: Usage; onClose: () => void; onRename: () => void;
}) {
  const { run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const [moving, setMoving] = useState(false);
  const area = areas.find((a) => a.id === project.areaId);
  const u = usage.projects[project.id] ?? { tasks: 0, open: 0, done: 0, pct: 0 };
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
      <PopoverLink icon={<Icon name="layers" size={14} />} href={`/project/${project.id}`} onClick={onClose}>Open tasks</PopoverLink>
      <PopoverLink icon={<Icon name="roadmap" size={14} />} href={`/roadmap?p=${project.id}`} onClick={onClose}>Open roadmap</PopoverLink>
      <PopoverLink icon={<Icon name="flow" size={14} />} href={`/flows?p=${project.id}`} onClick={onClose}>Open flow</PopoverLink>
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
            <PopoverItem key={a.id} icon={<AreaMark area={a} dot={8} />}
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
