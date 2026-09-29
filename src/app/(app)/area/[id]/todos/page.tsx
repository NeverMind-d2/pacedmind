import { redirect } from "next/navigation";
import { AreaMark } from "@/components/icons";
import { TaskList } from "@/components/task-list";
import * as repo from "@/server/repo";
import { groupByStatus, isOpen, taskContext } from "@/server/views";

/**
 * An area's To-dos: its tasks outside its projects, for small things like replying to an email or logging hours.
 * One can still be about a project (Task.relatedProjectId) without counting in it.
 */
export default async function AreaTodosPage(props: PageProps<"/area/[id]/todos">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const area = (await repo.listAreas()).find((a) => a.id === id);
  if (!area) redirect("/projects");
  const tasks = (await repo.listTasks({ areaId: id })).filter((t) => !t.projectId);
  return (
    <TaskList
      key={`${area.id}-todos`}
      icon="check"
      mark={area.picture || area.icon ? <AreaMark area={area} size={16} /> : undefined}
      title="To-dos"
      subtitle={`${area.name} · ${tasks.filter(isOpen).length} open`}
      groups={groupByStatus(tasks)}
      ctx={await taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
      addDefaults={{ areaId: id }}
      empty={`Nothing to do in ${area.name} outside its projects. Add small things here, like replying to an email.`}
    />
  );
}
