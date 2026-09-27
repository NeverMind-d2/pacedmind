import { UpcomingView } from "@/components/views/upcoming";
import { projectTargets } from "@/server/calendar";
import * as repo from "@/server/repo";
import { isOpen, taskContext } from "@/server/views";
import { addDaysStr, dateOnly, todayStr } from "@/lib/dates";

export default async function UpcomingPage(props: PageProps<"/upcoming">) {
  const sp = await props.searchParams;
  const today = todayStr();
  const from = addDaysStr(today, 1);
  const to = addDaysStr(today, 14);
  const inRange = (d: string | null) => !!d && dateOnly(d) >= from && dateOnly(d) <= to;
  const [all, events, projects] = await Promise.all([repo.listTasks(), repo.occurrences(from, to), repo.listProjects()]);
  const tasks = all.filter((t) => isOpen(t) && (inRange(t.dueDate) || inRange(t.plannedDate)));
  return (
    <UpcomingView
      today={today}
      tasks={tasks}
      events={events}
      targets={projectTargets(projects, all, today)}
      ctx={await taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
    />
  );
}
