import { notFound } from "next/navigation";
import { TaskList } from "@/components/task-list";
import * as repo from "@/server/repo";
import { groupByStatus, taskContext } from "@/server/views";

export default async function AreaPage(props: PageProps<"/area/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const area = repo.listAreas().find((a) => a.id === id);
  if (!area) notFound();
  const tasks = repo.listTasks("area_id = ?", id);
  return (
    <TaskList
      icon="layers"
      title={area.name}
      subtitle={`${area.key} · ${tasks.filter((t) => t.status !== "done" && t.status !== "canceled").length} open`}
      groups={groupByStatus(tasks)}
      ctx={taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
      addDefaults={{ areaId: id }}
      empty={`No tasks in ${area.name} yet`}
    />
  );
}
