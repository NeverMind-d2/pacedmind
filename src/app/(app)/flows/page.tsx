import { FlowView, type FlowDevice, type FlowTask } from "@/components/views/flow";
import { Icon } from "@/components/icons";
import { thisDevice } from "@/server/devices";
import * as repo from "@/server/repo";
import { projectColor } from "@/lib/colors";
import { nowStamp, parseLocal } from "@/lib/dates";
import { agentOf, type Session } from "@/lib/types";

const ms = (stamp: string) => parseLocal(stamp).getTime();

export default async function FlowsPage(props: PageProps<"/flows">) {
  const sp = await props.searchParams;
  const want = typeof sp.p === "string" ? sp.p : null;
  const projects = repo.listProjects();
  const areas = repo.listAreas();
  const all = repo.listTasks();
  const inFlow = (id: string) => all.filter((t) => t.projectId === id && t.flowX !== null && t.flowY !== null).length;
  const project = projects.find((p) => p.id === want) ?? projects.find((p) => inFlow(p.id) > 0) ?? projects.find((p) => p.agent) ?? projects[0];

  if (!project) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pl-5 pr-4">
          <Icon name="flow" className="text-mut" />
          <h1 className="text-[14px] font-semibold text-strong">Flows</h1>
        </div>
        <div className="flex flex-col items-center gap-3 px-8 py-24 text-center">
          <div className="text-[14px] text-fg2">No projects yet</div>
          <div className="max-w-sm text-[12.5px] leading-relaxed text-mut2">
            A flow lays out a project&apos;s tasks as agent sessions and decides which one starts after which. Create a project first.
          </div>
        </div>
      </div>
    );
  }

  const tasks = all.filter((t) => t.projectId === project.id);
  const ids = new Set(tasks.map((t) => t.id));
  const edges = repo.listEdges().filter((e) => ids.has(e.fromTaskId) && ids.has(e.toTaskId));
  const sessions = repo.listSessions().filter((s) => ids.has(s.taskId));
  const latest: Record<number, Session> = {};
  for (const s of sessions) latest[s.taskId] ??= s;

  // Sessions that carry on another task's terminal session ("same session" connections).
  const continuedFrom: Record<number, string> = {};
  for (const s of Object.values(latest)) {
    if (!s.continuesSessionId) continue;
    const prev = repo.getSession(s.continuesSessionId);
    const key = prev ? all.find((t) => t.id === prev.taskId)?.key : undefined;
    if (key) continuedFrom[s.taskId] = key;
  }

  // A running session counts as started by the flow when it began right after one of its triggers fired.
  const autoStarted = Object.values(latest)
    .filter((s) => (s.status === "running" || s.status === "starting") && !s.continuesSessionId)
    .filter((s) => {
      const start = ms(s.startedAt);
      return edges.some((e) => {
        if (e.toTaskId !== s.taskId) return false;
        const source = tasks.find((t) => t.id === e.fromTaskId);
        const marks = [
          source?.completedAt, e.mode === "time" ? e.atTime : null,
          ...sessions.filter((x) => x.taskId === e.fromTaskId).map((x) => x.finishedAt),
        ];
        return marks.some((m) => m && start - ms(m) >= -5_000 && start - ms(m) <= 120_000);
      });
    })
    .map((s) => s.taskId);

  // This computer first, then the other computers PacedMind runs on.
  const me = thisDevice();
  const devices: FlowDevice[] = [me, ...repo.listDevices().filter((d) => d.id !== me.id)].map((d) => ({
    id: d.id, name: d.name, here: d.id === me.id, checked: !!d.checkedAt, agents: d.agents,
  }));

  // Tasks that are yours ("human") never run as agent sessions, so they aren't offered to the flow.
  const flowTasks: FlowTask[] = tasks.flatMap((t) => {
    const agent = agentOf(t, project.agent);
    return agent ? [{
      id: t.id, key: t.key, title: t.title, status: t.status, agent,
      runIn: t.runIn, deviceId: t.deviceId ?? project.deviceId ?? me.id, folder: t.folder ?? project.folder, ownFolder: !!t.folder,
      flowX: t.flowX, flowY: t.flowY, sortOrder: t.sortOrder, completedAt: t.completedAt,
    }] : [];
  });
  const yours = tasks.filter((t) => t.agent === "human" && t.status !== "done" && t.status !== "canceled").length;
  const settings = repo.getSettings();

  return (
    <FlowView
      key={project.id}
      project={{
        id: project.id, name: project.name, flowOn: project.flowOn, folder: project.folder, color: projectColor(project, areas),
        codexEnv: project.codexEnv,
      }}
      projects={projects.map((p) => ({ id: p.id, name: p.name, color: projectColor(p, areas), inFlow: inFlow(p.id) }))}
      devices={devices}
      tasks={flowTasks}
      yours={yours}
      edges={edges}
      sessions={latest}
      continuedFrom={continuedFrom}
      autoStarted={autoStarted}
      now={nowStamp()}
      workStart={settings.workStart}
      workDays={settings.workDays}
    />
  );
}
