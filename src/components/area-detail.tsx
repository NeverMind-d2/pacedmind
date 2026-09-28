"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { linkFoundFolderAction } from "@/app/actions";
import { projectColor } from "@/lib/colors";
import { AGENT_LABEL, APP_LABEL, mcpReaches, type Area, type Device, type FoundFolder, type Project, type Surface } from "@/lib/types";
import { AreaWorkspace } from "./area-workspace";
import { deviceState, useExecution } from "./execution-context";
import { folderName, usePacedMindFolder } from "./folder-field";
import { AgentIcon, AreaMark, Icon } from "./icons";
import { openAdd } from "./task-list";
import { Button, Dot, IconButton, Menu, useAction } from "./ui";

export function AreaDetail({ area, projects, onClose }: { area: Area; projects: Project[]; onClose: () => void }) {
  const { devices, hereId, desktop, folders } = useExecution();
  const own = projects.filter((p) => p.areaId === area.id);
  return <aside aria-label="Area details" className="flex w-[340px] shrink-0 flex-col border-l border-line max-lg:w-[300px] max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-auto max-md:border-l-0 max-md:bg-panel">
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
      <AreaMark area={area} size={16} /><h2 className="min-w-0 flex-1 truncate font-medium text-strong">{area.name}</h2>
      <span className="text-[12px] text-mut2">{area.key}</span>
      <IconButton label="Close area details" onClick={onClose}><Icon name="x" size={15} /></IconButton>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
      {/* Folders are this computer's: the desktop app sets them. */}
      {desktop && <Section title="Workspace" note="this computer">
        <AreaWorkspace bare key={`${area.id}-${area.folder}`} area={area} />
      </Section>}
      <Section title="Computers" action={<Link href="/settings/computers" className="text-[12px] text-mut hover:text-fg2">Manage</Link>}>
        {devices.length ? <div className="divide-y divide-line rounded-lg border border-line2">
          {devices.map((d) => <Computer key={d.id} device={d} area={area} projects={own} local={desktop && d.id === hereId} hereId={hereId} />)}
        </div> : <p className="text-[12px] text-mut2">None yet. Open the desktop app on a computer to add it.</p>}
      </Section>
      <Section title="Projects" action={<button type="button" onClick={() => openAdd({ areaId: area.id })} className="flex items-center gap-1 text-[12px] text-mut hover:text-fg2">
        <Icon name="plus" size={12} />New task</button>}>
        {own.length ? <div className="-mx-2">
          {own.map((p) => <div key={p.id} className="flex h-8 items-center gap-2 rounded-md px-2 hover:bg-hover">
            <Link href={`/project/${p.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 text-[12.5px] text-fg2">
              <Dot color={projectColor(p, [area])} /><span className="truncate">{p.name}</span>
            </Link>
            {desktop && <Here project={p} found={folders?.projects[p.id] ?? []} />}
          </div>)}
        </div> : <p className="text-[12px] text-mut2">No projects</p>}
      </Section>
    </div>
  </aside>;
}

function Section({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="space-y-2" aria-label={title}>
    <div className="flex items-center gap-2">
      <h3 className="text-[12px] font-medium text-fg2">{title}</h3>
      {note && <span className="text-[11.5px] text-mut2">{note}</span>}
      <span className="flex-1" />{action}
    </div>
    {children}
  </section>;
}

/** Whether a project is on this computer: its folder here, a copy found here to use, or neither. */
function Here({ project, found }: { project: Project; found: FoundFolder[] }) {
  const { pending, run } = useAction();
  const ours = usePacedMindFolder();
  if (project.folder) {
    return <span title={project.folder} className="flex min-w-0 max-w-[50%] items-center gap-1 text-[11.5px] text-mut2">
      <Icon name="folder" size={12} className="shrink-0" /><span className="truncate">{ours(project.folder) ? "PacedMind's folder" : folderName(project.folder)}</span>
    </span>;
  }
  if (found.length) {
    return <Button size="sm" disabled={pending} title={`Found on this computer: ${found[0].folder}`} className="shrink-0"
      onClick={() => run(() => linkFoundFolderAction(project.id, found[0].folder))}>Found here · Use</Button>;
  }
  return <span className="shrink-0 text-[11.5px] text-dim" title="No folder of it on this computer">Not here</span>;
}

/** One computer: where it stands, which of the area's projects use it, and a new task for one of its agents. */
function Computer({ device: d, area, projects, local, hereId }: { device: Device; area: Area; projects: Project[]; local: boolean; hereId: string | null }) {
  const used = projects.filter((p) => (!!d.id && p.deviceId === d.id) || d.otherSessions.some((s) => s.projectId === p.id) || (local && !!p.folder));
  const agents = (["claude", "codex"] as const).flatMap((agent) => (["terminal", "desktop"] as Surface[]).flatMap((runIn) => {
    const tools = d.agents[agent];
    if (!(runIn === "terminal" ? tools.cli : tools.app)) return [];
    return [{ value: { agent, runIn }, label: runIn === "terminal" ? AGENT_LABEL[agent] : APP_LABEL[agent], icon: <AgentIcon agent={agent} size={12} />,
      hint: runIn === "desktop" && !mcpReaches(tools.mcp) ? "Not connected" : undefined }];
  }));
  const note = !d.checkedAt ? "Agents not checked yet" : !agents.length ? "No agents found"
    : !local && d.remoteStart === "off" ? "Refuses starts from other computers" : null;
  return <div className="flex items-start gap-2.5 px-3 py-2.5">
    <Icon name="laptop" size={14} className="mt-0.5 shrink-0 text-mut" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="truncate text-fg2">{d.name}</span>
        <span className="shrink-0 text-[11.5px] text-mut2">{deviceState(d, hereId)}</span>
      </div>
      {(used.length > 0 || note) && <p className="mt-0.5 truncate text-[11.5px] text-mut2" title={used.map((p) => p.name).join(", ")}>
        {note ?? used.map((p) => p.name).join(", ")}
      </p>}
    </div>
    {agents.length > 0 && <Menu align="right" width={220} items={agents}
      trigger={<IconButton label={`New task on ${d.name}`} className="-my-1 -mr-1"><Icon name="plus" size={14} /></IconButton>}
      onSelect={({ agent, runIn }) => openAdd({ areaId: area.id, deviceId: d.id || null, agent, runIn })} />}
  </div>;
}
