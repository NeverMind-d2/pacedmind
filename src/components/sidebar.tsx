"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";
import { createAreaAction, createProjectAction, updateAreaAction, updateProjectAction } from "@/app/actions";
import { FALLBACK_COLOR, nextColor, projectColor } from "@/lib/colors";
import { fmtShort } from "@/lib/dates";
import type { Area, Project, Usage } from "@/lib/types";
import { AreaMenu, InlineName, MoreButton, ProjectMenu, type OpenMenu } from "./entity-menu";
import { Icon, ProgressRing, type IconName } from "./icons";
import { Popover, PopoverItem, PopoverLabel, anchorOf, type Anchor } from "./popover";
import { cx, useAction } from "./ui";
import { ThemeToggle } from "./theme";

const NAV: { href: string; label: string; icon: IconName; count?: "inbox" | "today" | "sessions" }[] = [
  { href: "/inbox", label: "Inbox", icon: "inbox", count: "inbox" },
  { href: "/today", label: "Today", icon: "sun", count: "today" },
  { href: "/upcoming", label: "Upcoming", icon: "clock" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/timeline", label: "Timeline", icon: "timeline" },
  { href: "/projects", label: "Projects", icon: "box" },
  { href: "/roadmap", label: "Roadmap", icon: "roadmap" },
  { href: "/flows", label: "Flows", icon: "flow" },
  { href: "/sessions", label: "Sessions", icon: "terminal", count: "sessions" },
];

export function openQuickAdd() {
  window.dispatchEvent(new CustomEvent("organizer:new"));
}

const item = "flex h-[30px] items-center gap-2.5 rounded-md px-2 text-fg3 hover:bg-hover";
const editing = "flex h-[30px] items-center gap-2.5 rounded-md bg-hover px-2";

function AreaDot({ color }: { color: string }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-ink/[0.06]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    </span>
  );
}

function SectionHeader({ label, addLabel, onAdd }: { label: string; addLabel: string; onAdd: (a: Anchor) => void }) {
  return (
    <div className="group flex h-[26px] items-center pl-2 pr-1">
      <Link href="/projects" title="All areas and projects" className="mr-auto text-[12px] font-medium text-mut2 hover:text-fg3">{label}</Link>
      <button type="button" aria-label={addLabel} title={addLabel} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => onAdd(anchorOf(e.currentTarget))}
        className="flex h-5 w-5 items-center justify-center rounded text-mut opacity-0 hover:bg-hover hover:text-fg2 focus-visible:opacity-100 group-hover:opacity-100">
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

/** A sidebar link with a "…" menu on hover and the same menu on right-click. */
function MenuRow({ href, active, open, label, onMenu, onClose, children, trailing }: {
  href: string; active: boolean; open: boolean; label: string;
  onMenu: (a: Anchor) => void; onClose: () => void; children: ReactNode; trailing?: ReactNode;
}) {
  const onContextMenu = (e: MouseEvent) => { e.preventDefault(); onMenu({ x: e.clientX, y: e.clientY }); };
  return (
    <div className="group relative" onContextMenu={onContextMenu}>
      <Link href={href} className={cx(item, active && "bg-sel text-strong", open && "bg-hover")}>
        {children}
        {trailing && <span className={cx("group-hover:opacity-0 group-has-[:focus-visible]:opacity-0", open && "opacity-0")}>{trailing}</span>}
      </Link>
      <MoreButton label={`${label} options`} open={open} onOpen={onMenu} onClose={onClose} className="absolute right-1 top-[3px]" />
    </div>
  );
}

type Draft = { kind: "area" } | { kind: "project"; areaId: string } | null;

export function Sidebar({ areas, projects, counts, usage }: {
  areas: Area[];
  projects: Project[];
  counts: { inbox: number; today: number; sessions: number };
  usage: Usage;
}) {
  const path = usePathname();
  const router = useRouter();
  const { run } = useAction();
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [pickArea, setPickArea] = useState<Anchor | null>(null);
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  const closeMenu = () => setMenu(null);

  const newProject = (anchor?: Anchor) => {
    if (!areas.length) setDraft({ kind: "area" });
    else if (areas.length === 1 || !anchor) setDraft({ kind: "project", areaId: areas[0].id });
    else setPickArea(anchor);
  };
  const createArea = (name: string) => {
    setDraft(null);
    run(() => createAreaAction({ name, color: nextColor(areas.map((a) => a.color)) }));
  };
  const createProject = (name: string, areaId: string) => {
    setDraft(null);
    run(async () => {
      const r = await createProjectAction({ name, areaId });
      if (r.ok && r.id) router.push(`/project/${r.id}`);
      return r;
    });
  };

  const menuArea = menu?.kind === "area" ? areas.find((a) => a.id === menu.id) : undefined;
  const menuProject = menu?.kind === "project" ? projects.find((p) => p.id === menu.id) : undefined;
  const draftArea = draft?.kind === "project" ? areas.find((a) => a.id === draft.areaId) : undefined;

  return (
    <nav aria-label="Main" className="flex w-60 shrink-0 flex-col gap-[18px] overflow-y-auto px-2.5 py-3">
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("organizer:palette"))} aria-label="Search (Ctrl+K)" title="Search (Ctrl+K)"
          className="flex h-[30px] flex-1 items-center gap-2 rounded-md px-2 text-mut hover:bg-hover">
          <Icon name="search" size={14} />
          <span className="text-[12px]">Search</span>
          <kbd className="ml-auto text-[10px] text-dim">Ctrl K</kbd>
        </button>
        <button type="button" onClick={openQuickAdd} aria-label="New task (C)" title="New task (C)"
          className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line2 bg-raised text-fg2 hover:bg-hover">
          <Icon name="pen" size={15} />
        </button>
      </div>

      <div className="flex flex-col gap-px">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cx(item, active(n.href) && "bg-sel text-strong")}>
            <Icon name={n.icon} />
            <span className="flex-1">{n.label}</span>
            {n.count && counts[n.count] > 0 && <span className="text-[11.5px] text-mut2">{counts[n.count]}</span>}
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-px">
        <SectionHeader label="Areas" addLabel="New area" onAdd={() => setDraft({ kind: "area" })} />
        {areas.map((a) =>
          renaming === `area:${a.id}` ? (
            <div key={a.id} className={editing}>
              <AreaDot color={a.color} />
              <InlineName initial={a.name} placeholder="Area name" onCancel={() => setRenaming(null)}
                onSave={(name) => { setRenaming(null); run(() => updateAreaAction(a.id, { name })); }} />
            </div>
          ) : (
            <MenuRow key={a.id} href={`/area/${a.id}`} active={active(`/area/${a.id}`)} label={a.name}
              open={menu?.kind === "area" && menu.id === a.id} onClose={closeMenu}
              onMenu={(anchor) => setMenu({ kind: "area", id: a.id, anchor })}
              trailing={<span className="font-mono text-[10.5px] text-mut2">{a.key}</span>}>
              <AreaDot color={a.color} />
              <span className="flex-1 truncate">{a.name}</span>
            </MenuRow>
          ),
        )}
        {draft?.kind === "area" ? (
          <div className={editing}>
            <AreaDot color={nextColor(areas.map((a) => a.color))} />
            <InlineName initial="" placeholder="Area name" onSave={createArea} onCancel={() => setDraft(null)} />
          </div>
        ) : !areas.length && (
          <button type="button" onClick={() => setDraft({ kind: "area" })} className={cx(item, "text-mut")}>
            <Icon name="plus" size={14} />New area
          </button>
        )}
      </div>

      <div className="flex flex-col gap-px">
        <SectionHeader label="Projects" addLabel="New project" onAdd={newProject} />
        {projects.map((p) =>
          renaming === `project:${p.id}` ? (
            <div key={p.id} className={editing}>
              <ProgressRing pct={usage.projects[p.id]?.pct ?? 0} color={projectColor(p, areas)} size={16} />
              <InlineName initial={p.name} placeholder="Project name" onCancel={() => setRenaming(null)}
                onSave={(name) => { setRenaming(null); run(() => updateProjectAction(p.id, { name })); }} />
            </div>
          ) : (
            <MenuRow key={p.id} href={`/project/${p.id}`} active={active(`/project/${p.id}`)} label={p.name}
              open={menu?.kind === "project" && menu.id === p.id} onClose={closeMenu}
              onMenu={(anchor) => setMenu({ kind: "project", id: p.id, anchor })}
              trailing={p.targetDate && <span className="text-[11.5px] text-mut2">{fmtShort(p.targetDate)}</span>}>
              <ProgressRing pct={usage.projects[p.id]?.pct ?? 0} color={projectColor(p, areas)} size={16} />
              <span className="flex-1 truncate">{p.name}</span>
            </MenuRow>
          ),
        )}
        {draft?.kind === "project" ? (
          <div className={editing}>
            <ProgressRing pct={0} color={draftArea?.color ?? FALLBACK_COLOR} size={16} />
            <InlineName initial="" placeholder={`Project in ${draftArea?.name ?? "area"}`} onCancel={() => setDraft(null)}
              onSave={(name) => createProject(name, draft.areaId)} />
          </div>
        ) : !projects.length && (
          <button type="button" onClick={(e) => newProject(anchorOf(e.currentTarget))} className={cx(item, "text-mut")}>
            <Icon name="plus" size={14} />New project
          </button>
        )}
      </div>

      <div className="flex-1" />
      <div className="flex items-center gap-1.5">
        <Link href="/settings" className={cx(item, "flex-1 text-mut", active("/settings") && "bg-sel text-strong")}>
          <Icon name="settings" />
          <span className="flex-1">Settings</span>
        </Link>
        <ThemeToggle />
      </div>

      {menuArea && menu && (
        <AreaMenu area={menuArea} anchor={menu.anchor} usage={usage} onClose={closeMenu}
          onRename={() => setRenaming(`area:${menuArea.id}`)} onNewProject={() => setDraft({ kind: "project", areaId: menuArea.id })} />
      )}
      {menuProject && menu && (
        <ProjectMenu project={menuProject} areas={areas} anchor={menu.anchor} usage={usage} onClose={closeMenu}
          onRename={() => setRenaming(`project:${menuProject.id}`)} />
      )}
      {pickArea && (
        <Popover anchor={pickArea} onClose={() => setPickArea(null)} width={200}>
          <PopoverLabel>New project in</PopoverLabel>
          {areas.map((a) => (
            <PopoverItem key={a.id} icon={<span className="h-2 w-2 rounded-full" style={{ background: a.color }} />}
              onClick={() => { setPickArea(null); setDraft({ kind: "project", areaId: a.id }); }}>
              {a.name}
            </PopoverItem>
          ))}
        </Popover>
      )}
    </nav>
  );
}
