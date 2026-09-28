"use client";

import Link from "next/link";
import type { Area, Project } from "@/lib/types";
import { AGENT_LABEL, APP_LABEL, deviceOnline, mcpReaches } from "@/lib/types";
import { AreaWorkspace } from "./area-workspace";
import { useExecution } from "./execution-context";
import { AreaMark, Icon } from "./icons";
import { openAdd } from "./task-list";
import { Button, IconButton } from "./ui";

export function AreaDetail({ area, projects, onClose }: { area: Area; projects: Project[]; onClose: () => void }) {
  const { devices, hereId, desktop } = useExecution();
  const own = projects.filter((p) => p.areaId === area.id);
  return <aside aria-label="Area details" className="flex w-[380px] shrink-0 flex-col border-l border-line max-lg:w-[320px] max-md:fixed max-md:inset-0 max-md:z-30 max-md:w-auto max-md:border-l-0 max-md:bg-panel">
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-4">
      <AreaMark area={area} size={16} /><h2 className="min-w-0 flex-1 truncate font-medium text-strong">{area.name}</h2>
      <IconButton label="Close area details" onClick={onClose}><Icon name="x" size={15} /></IconButton>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
      <p className="text-[12px] text-mut2">{area.key} · {own.length} projects</p>
      {desktop ? <AreaWorkspace key={`${area.id}-${area.folder}`} area={area} projects={own} />
        : <p className="text-[12px] text-mut2">Set this area&apos;s workspace in PacedMind on each computer that runs its tasks.</p>}
      <section className="space-y-3" aria-label="Computers and harnesses">
        <h3 className="text-[12px] font-medium text-fg2">Computers & harnesses</h3>
        <p className="text-[11.5px] leading-relaxed text-mut2">Choose a harness to create a task for that computer. Project preferences and reported activity show where this area is used.</p>
        {devices.map((d) => {
          const local = desktop && d.id === hereId;
          const assigned = own.filter((p) => p.deviceId === d.id && !!d.id);
          const seen = own.filter((p) => d.otherSessions.some((s) => s.projectId === p.id));
          const folders = local ? own.filter((p) => p.folder) : [];
          return <div key={d.id} className="space-y-2 rounded-lg border border-line2 p-3">
            <div className="flex items-center gap-2 text-[12px] text-fg2"><Icon name="laptop" size={14} /><span className="min-w-0 flex-1 truncate">{d.name}</span><span className="text-[10.5px] text-mut2">{local ? "This computer" : deviceOnline(d) ? "Online" : "Offline"}</span></div>
            <div className="space-y-1 text-[11px] text-mut2">
              {local && area.folder && <p>Area workspace configured here</p>}
              {folders.length > 0 && <p>Project folders: {folders.map((p) => p.name).join(", ")}</p>}
              {assigned.length > 0 && <p>Preferred by: {assigned.map((p) => p.name).join(", ")}</p>}
              {seen.length > 0 && <p>Reported activity: {seen.map((p) => p.name).join(", ")}</p>}
              {!local && !assigned.length && !seen.length && <p>No workspace activity reported for this area</p>}
              {!local && <p>Workspace paths stay on this computer.</p>}
              {!local && d.remoteStart === "off" && <p>Remote starts are refused on this computer.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              {(["claude", "codex"] as const).flatMap((agent) => (["terminal", "desktop"] as const).flatMap((runIn) => {
                const tools = d.agents[agent];
                if (!(runIn === "terminal" ? tools.cli : tools.app)) return [];
                return [<button key={`${agent}-${runIn}`} type="button" onClick={() => openAdd({ areaId: area.id, deviceId: d.id || null, agent, runIn })}
                  className="flex items-center gap-2 rounded-md border border-ctl px-2 py-1.5 text-left text-[12px] text-fg2 hover:bg-hover">
                  <Icon name={runIn === "terminal" ? "terminal" : "laptop"} size={13} /><span className="flex-1">{runIn === "terminal" ? AGENT_LABEL[agent] : APP_LABEL[agent]}</span>
                  {runIn === "desktop" && <span className="text-[10px] text-mut2">{mcpReaches(tools.mcp) ? "Connected" : "Not connected"}</span>}<Icon name="plus" size={12} />
                </button>];
              }))}
              {!d.checkedAt && <p className="text-[11px] text-mut2">Harnesses have not been checked yet.</p>}
              {d.checkedAt && !d.agents.claude.cli && !d.agents.claude.app && !d.agents.codex.cli && !d.agents.codex.app && <p className="text-[11px] text-mut2">No harnesses found.</p>}
            </div>
          </div>;
        })}
        {!devices.length && <p className="text-[12px] text-mut2">No computers connected. Open the desktop app on a computer to connect it.</p>}
        <Link href="/settings/computers" className="text-[12px] text-fg2 underline underline-offset-2">Manage computers</Link>
      </section>
      <section className="space-y-2">
        <h3 className="text-[12px] font-medium text-fg2">Projects</h3>
        {own.map((p) => <Link key={p.id} href={`/project/${p.id}`} className="block rounded-md px-2 py-1.5 text-[12px] text-fg2 hover:bg-hover">{p.name}</Link>)}
        <Button onClick={() => openAdd({ areaId: area.id })}><Icon name="plus" size={13} />New task in {area.name}</Button>
      </section>
    </div>
  </aside>;
}
