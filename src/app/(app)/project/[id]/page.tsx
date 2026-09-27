import Link from "next/link";
import { redirect } from "next/navigation";
import { TaskList } from "@/components/task-list";
import { Icon } from "@/components/icons";
import * as repo from "@/server/repo";
import { groupByStatus, taskContext } from "@/server/views";
import { fmtShort } from "@/lib/dates";

export default async function ProjectPage(props: PageProps<"/project/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const project = await repo.getProject(id);
  // Deleted (maybe just now, from its own menu): show the overview instead of a 404.
  if (!project) redirect("/projects");
  const [areas, tasks] = await Promise.all([repo.listAreas(), repo.listTasks({ projectId: id })]);
  const area = areas.find((a) => a.id === project.areaId);
  const link = "inline-flex h-7 items-center gap-1.5 rounded-md border border-ctl px-2.5 text-[12.5px] text-fg2 hover:bg-hover";
  return (
    <TaskList
      icon="layers"
      title={project.name}
      subtitle={[area?.name, project.targetDate && `target ${fmtShort(project.targetDate)}`].filter(Boolean).join(" · ")}
      groups={groupByStatus(tasks)}
      ctx={await taskContext(tasks)}
      initialKey={typeof sp.task === "string" ? sp.task : null}
      addDefaults={{ projectId: id }}
      headerRight={
        // On a phone, icons only, like the New task button next to them: the title needs the room.
        <>
          <Link href={`/roadmap?p=${id}`} aria-label="Roadmap" className={link}><Icon name="roadmap" size={13} /><span className="max-sm:hidden">Roadmap</span></Link>
          <Link href={`/flows?p=${id}`} aria-label="Flow" className={link}><Icon name="flow" size={13} /><span className="max-sm:hidden">Flow</span></Link>
        </>
      }
      empty={`No tasks in ${project.name} yet`}
    />
  );
}
