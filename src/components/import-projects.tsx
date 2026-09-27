"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { differenceInCalendarDays } from "date-fns";
import { dismissImportAction, findProjectsAction, importProjectsAction } from "@/app/actions";
import type { FoundProject, ImportSource } from "@/server/import";
import type { AgentId, Area } from "@/lib/types";
import { AgentIcon, AreaMark, Icon } from "./icons";
import { Button, Menu, cx, useAction } from "./ui";

const SOURCE_LABEL: Record<ImportSource, string> = {
  "claude-app": "Claude app", "claude-cli": "Claude Code CLI", "codex-app": "Codex app", "codex-cli": "Codex CLI",
};

/** "today", "yesterday", "5 days ago", "3 months ago", in calendar days. */
function ago(ms: number, now: number): string {
  const days = differenceInCalendarDays(now, ms);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 31) return `${days} days ago`;
  const months = Math.round(days / 30.4);
  return months < 12 ? `${months} month${months > 1 ? "s" : ""} ago` : "over a year ago";
}

/** The agent a project should start with: the one that worked there last. */
function lastAgent(p: FoundProject): AgentId | null {
  const c = p.used.claude;
  const x = p.used.codex;
  if (c === undefined) return x === undefined ? null : "codex";
  if (x === undefined) return "claude";
  return x > c ? "codex" : "claude";
}

/** The area imported projects go to at first: one that already holds code projects, else one that sounds like it. */
function defaultArea(areas: Area[]): string {
  return (areas.find((a) => /dev|code|project|build/i.test(a.name)) ?? areas[0])?.id ?? "";
}

/**
 * Brings the folders you work in with Claude Code and Codex over as projects. Opens by itself the first time
 * PacedMind starts (`auto`, only when it finds something), and from Settings.
 */
export function ImportProjects({ areas, auto = false, onClose }: { areas: Area[]; auto?: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [found, setFound] = useState<FoundProject[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [areaId, setAreaId] = useState(() => defaultArea(areas));
  const [now] = useState(() => Date.now());
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  // Looks once when it opens; pages refreshing behind it don't start over.
  useEffect(() => {
    let live = true;
    findProjectsAction().then((list) => {
      if (!live) return;
      const open = list.filter((p) => !p.projectId && !p.problem);
      // Nothing to bring over: the first-start offer quietly goes away.
      if (auto && !open.length) {
        void dismissImportAction();
        closeRef.current();
        return;
      }
      setFound(list);
      setPicked(new Set(list.filter((p) => p.suggested).map((p) => p.folder)));
    }, () => {
      if (live && auto) closeRef.current();
    });
    return () => { live = false; };
  }, [auto]);

  const close = () => {
    if (auto) void dismissImportAction();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (auto && !found) return null;
  const area = areas.find((a) => a.id === areaId);
  const available = found?.filter((p) => !p.projectId && !p.problem) ?? [];
  const both = available.filter((p) => p.used.claude !== undefined && p.used.codex !== undefined).length;
  const count = available.filter((p) => picked.has(p.folder)).length;
  const toggle = (folder: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  const submit = () => {
    const items = available.filter((p) => picked.has(p.folder))
      .map((p) => ({ folder: p.folder, name: (names[p.folder] ?? p.name).trim() || p.name, agent: lastAgent(p) }));
    run(async () => {
      const r = await importProjectsAction(items, areaId);
      if (r.ok) onClose();
      return r;
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-overlay px-4 pt-[9vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Bring your projects over"
        className="flex max-h-[80vh] w-[680px] max-w-full flex-col overflow-hidden rounded-xl border border-line2 bg-raised shadow-[var(--shadow-popover)]">
        <div className="flex flex-col gap-1.5 border-b border-line px-6 pb-4 pt-5 max-sm:px-4">
          <div className="flex items-center gap-2">
            <AgentIcon agent="claude" size={15} className="text-fg3" />
            <AgentIcon agent="codex" size={15} className="text-fg3" />
            <h2 className="ml-1 text-[15px] font-semibold text-strong">Bring your projects over</h2>
          </div>
          <p className="text-[12.5px] leading-relaxed text-mut">
            {found
              ? available.length
                ? <>PacedMind found {available.length} folder{available.length > 1 ? "s" : ""} you work in with Claude Code and Codex on this computer{both ? `, ${both} of them with both` : ""}. Each one becomes a project whose tasks run their sessions in that folder.</>
                : "Every folder you work in with Claude Code and Codex on this computer is already a project."
              : "Looking through Claude Code and Codex on this computer…"}
          </p>
        </div>

        <div className="min-h-[120px] flex-1 overflow-y-auto px-3 py-2">
          {found?.map((p) => {
            const taken = !!p.projectId;
            const off = taken || !!p.problem;
            const on = !off && picked.has(p.folder);
            const last = Math.max(0, ...Object.values(p.used).map((v) => v ?? 0));
            const agents = (["claude", "codex"] as AgentId[]).filter((a) => p.used[a] !== undefined);
            return (
              <div key={p.folder} className={cx("flex items-center gap-3 rounded-lg px-3 py-2", !off && "hover:bg-hover")}>
                <button type="button" role="checkbox" aria-checked={on} disabled={off} aria-label={`Import ${p.name}`}
                  onClick={() => toggle(p.folder)}
                  className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded border-[1.5px]",
                    on ? "border-accent bg-accent" : off ? "border-line" : "border-line-strong")}>
                  {on && <Icon name="check" size={11} strokeWidth={3} className="text-white" />}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {on ? (
                    <input value={names[p.folder] ?? p.name} aria-label={`Name for ${p.folder}`}
                      onChange={(e) => setNames((n) => ({ ...n, [p.folder]: e.target.value }))}
                      className="-mx-1 h-[22px] min-w-0 rounded bg-transparent px-1 text-[13px] text-fg outline-none hover:bg-input focus:bg-input" />
                  ) : (
                    <span className={cx("truncate text-[13px]", off ? "text-mut2" : "text-fg2")}>{p.name}</span>
                  )}
                  <span title={p.folder} className="truncate font-mono text-[11px] text-mut2">{p.folder}</span>
                </div>
                <span title={p.sources.map((s) => SOURCE_LABEL[s]).join(", ")} className="flex shrink-0 items-center gap-1.5 text-mut">
                  {agents.map((a) => <AgentIcon key={a} agent={a} size={13} />)}
                </span>
                <span title={p.problem ?? undefined} className="w-[112px] shrink-0 text-right text-[12px] text-mut2 max-sm:w-[76px]">
                  {taken ? "Already a project" : p.problem ? "Can't be used" : last ? ago(last, now) : ""}
                </span>
              </div>
            );
          })}
        </div>

        {/* On a narrow phone the buttons go to a line of their own, on the right. */}
        <div className="flex items-center gap-2 border-t border-line px-6 py-3.5 max-sm:flex-wrap max-sm:px-4">
          <span className="whitespace-nowrap text-[12.5px] text-mut2">Add to</span>
          <Menu width={200}
            trigger={
              <button type="button" className="flex h-7 items-center gap-1.5 rounded-md border border-line2 px-2 text-[12.5px] text-fg2 hover:bg-hover">
                {area && <AreaMark area={area} size={13} />}{area?.name ?? "Pick an area"}<Icon name="chevronDown" size={11} className="text-mut2" />
              </button>
            }
            items={areas.map((a) => ({ value: a.id, label: a.name, icon: <AreaMark area={a} size={13} /> }))}
            onSelect={setAreaId} />
          <span className="flex-1" />
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={close}>{auto ? "Not now" : "Cancel"}</Button>
            <Button variant="primary" disabled={pending || !count || !areaId} onClick={submit}>
              {count ? `Add ${count} project${count > 1 ? "s" : ""}` : "Add projects"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Offers the import once, the first time PacedMind opens. */
export function ImportOffer({ areas }: { areas: Area[] }) {
  const [open, setOpen] = useState(true);
  return open ? <ImportProjects areas={areas} auto onClose={() => setOpen(false)} /> : null;
}
