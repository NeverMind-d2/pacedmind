import { ProjectsView } from "@/components/views/projects";
import * as repo from "@/server/repo";
import { usage } from "@/server/views";
import { todayStr } from "@/lib/dates";

export default async function ProjectsPage() {
  const [areas, projects, tasks] = await Promise.all([repo.listAreas(), repo.listProjects(), repo.listTasks()]);
  return <ProjectsView areas={areas} projects={projects} usage={usage(areas, projects, tasks)} today={todayStr()} />;
}
