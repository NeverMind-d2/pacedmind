import { Timeline, type TimelineZoom } from "@/components/views/timeline";
import * as repo from "@/server/repo";
import { taskContext } from "@/server/views";
import { dayLoads, latestSessions, taskStates, workdayMinutes } from "@/server/timeline";
import { mondayOf, parseLocal, toDateStr, toStamp } from "@/lib/dates";

const ZOOMS: TimelineZoom[] = ["week", "month", "quarter"];
/** Days covered by the widest zoom (Quarter, 13 weeks), so every zoom has its time blocks. */
const WIDEST = 91;

export default async function TimelinePage(props: PageProps<"/timeline">) {
  const sp = await props.searchParams;
  const now = new Date();
  const picked = typeof sp.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? parseLocal(sp.from) : null;
  const from = toDateStr(mondayOf(picked && !isNaN(picked.getTime()) ? picked : now));
  const zoom = ZOOMS.find((z) => z === sp.zoom) ?? "month";

  const [tasks, sessions, edges, areas, projects, settings] = await Promise.all([
    repo.listTasks(), repo.listSessions(), repo.listEdges(), repo.listAreas(), repo.listProjects(), repo.getSettings(),
  ]);
  const latest = latestSessions(sessions);
  return (
    <Timeline
      from={from}
      now={toStamp(now)}
      zoom={zoom}
      areas={areas}
      projects={projects}
      tasks={tasks}
      sessions={sessions}
      edges={edges}
      states={taskStates(tasks, latest, edges, now)}
      loads={await dayLoads(tasks, Object.values(latest), from, WIDEST, now)}
      dayMinutes={workdayMinutes(settings)}
      ctx={await taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
    />
  );
}
