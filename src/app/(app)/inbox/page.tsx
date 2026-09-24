import { TaskList } from "@/components/task-list";
import * as repo from "@/server/repo";
import { groupByStatus, isOpen, taskContext } from "@/server/views";

export default async function InboxPage(props: PageProps<"/inbox">) {
  const sp = await props.searchParams;
  const tasks = repo.listTasks("area_id IS NULL AND project_id IS NULL").filter(isOpen);
  return (
    <TaskList
      icon="inbox"
      title="Inbox"
      subtitle="Tasks without an area or project"
      groups={groupByStatus(tasks)}
      ctx={taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
      empty="Your inbox is clear"
    />
  );
}
