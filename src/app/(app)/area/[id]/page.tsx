import { redirect } from "next/navigation";
import { TaskList } from "@/components/task-list";
import * as repo from "@/server/repo";
import { groupByStatus, taskContext } from "@/server/views";

export default async function AreaPage(props: PageProps<"/area/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const area = (await repo.listAreas()).find((a) => a.id === id);
  // Deleted (maybe just now, from its own menu): show the overview instead of a 404.
  if (!area) redirect("/projects");
  const tasks = await repo.listTasks({ areaId: id });
  return (
    <TaskList
      icon="layers"
      title={area.name}
      subtitle={`${area.key} · ${tasks.filter((t) => t.status !== "done" && t.status !== "canceled").length} open`}
      groups={groupByStatus(tasks)}
      ctx={await taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
      addDefaults={{ areaId: id }}
      empty={`No tasks in ${area.name} yet`}
    />
  );
}
