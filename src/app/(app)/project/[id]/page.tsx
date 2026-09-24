import Link from "next/link";
import { notFound } from "next/navigation";
import { TaskList } from "@/components/task-list";
import { Icon } from "@/components/icons";
import * as repo from "@/server/repo";
import { groupByStatus, taskContext } from "@/server/views";
import { fmtShort } from "@/lib/dates";

export default async function ProjectPage(props: PageProps<"/project/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const project = repo.getProject(id);
  if (!project) notFound();
  const area = repo.listAreas().find((a) => a.id === project.areaId);
  const tasks = repo.listTasks("project_id = ?", id);
  const link = "inline-flex h-7 items-center gap-1.5 rounded-md border border-ctl px-2.5 text-[12.5px] text-fg2 hover:bg-hover";
  return (
    <TaskList
      icon="layers"
      title={project.name}
      subtitle={[area?.name, project.targetDate && `target ${fmtShort(project.targetDate)}`].filter(Boolean).join(" · ")}
      groups={groupByStatus(tasks)}
      ctx={taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
      addDefaults={{ projectId: id }}
      headerRight={
        <>
          <Link href={`/roadmap?p=${id}`} className={link}><Icon name="roadmap" size={13} />Roadmap</Link>
          <Link href={`/flows?p=${id}`} className={link}><Icon name="flow" size={13} />Flow</Link>
        </>
      }
      empty={`No tasks in ${project.name} yet`}
    />
  );
}
