import { Timeline } from "@/components/views/timeline";
import { TIMELINE_DAYS, TIMELINE_LEAD, TIMELINE_ZOOMS, type TimelineZoom } from "@/lib/timeline";
import * as repo from "@/server/repo";
import { taskContext } from "@/server/views";
import { dayLoads, latestSessions, taskStates, workdayMinutes } from "@/server/timeline";
import { addDaysStr, mondayOf, parseLocal, toDateStr, toStamp } from "@/lib/dates";

const day = (v: unknown) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = parseLocal(v);
  return isNaN(d.getTime()) ? null : toDateStr(d);
};

/**
 * The timeline scrolls through a wide range of days around `at` (the day it opens on; `from` in older links), and
 * asks for the next range when it's scrolled near either end.
 */
export default async function TimelinePage(props: PageProps<"/timeline">) {
  const sp = await props.searchParams;
  const now = new Date();
  const focus = day(sp.at) ?? day(sp.from);
  const from = toDateStr(mondayOf(parseLocal(addDaysStr(focus ?? toDateStr(now), -TIMELINE_LEAD))));
  const zoom = TIMELINE_ZOOMS.find((z) => z === sp.zoom) ?? "month";
  const dw = typeof sp.dw === "string" && /^\d{1,4}(\.\d+)?$/.test(sp.dw) ? Number(sp.dw) : null;

  const [tasks, sessions, edges, areas, projects, settings] = await Promise.all([
    repo.listTasks(), repo.listSessions(), repo.listEdges(), repo.listAreas(), repo.listProjects(), repo.getSettings(),
  ]);
  const latest = latestSessions(sessions);
  return (
    <Timeline
      from={from}
      focus={focus}
      now={toStamp(now)}
      zoom={zoom as TimelineZoom}
      dayWidth={dw}
      areas={areas}
      projects={projects}
      tasks={tasks}
      sessions={sessions}
      edges={edges}
      states={await taskStates(tasks, latest, edges, now)}
      loads={await dayLoads(tasks, Object.values(latest), from, TIMELINE_DAYS, now)}
      dayMinutes={workdayMinutes(settings)}
      ctx={await taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
    />
  );
}
