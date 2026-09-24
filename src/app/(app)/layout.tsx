import { connection } from "next/server";
import { Sidebar } from "@/components/sidebar";
import { QuickAdd } from "@/components/quick-add";
import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/ui";
import * as repo from "@/server/repo";
import { dateOnly, todayStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const areas = repo.listAreas();
  const projects = repo.listProjects();
  const tasks = repo.listTasks();
  const today = todayStr();
  const open = (t: (typeof tasks)[number]) => t.status !== "done" && t.status !== "canceled";
  const counts = {
    inbox: tasks.filter((t) => !t.areaId && !t.projectId && open(t)).length,
    today: tasks.filter((t) => open(t) && ((t.dueDate && dateOnly(t.dueDate) <= today) || t.plannedDate === today)).length,
    sessions: repo.listSessions("status = 'finished'").length,
  };
  const progress = Object.fromEntries(
    projects.map((p) => {
      const pts = tasks.filter((t) => t.projectId === p.id && t.status !== "canceled");
      return [p.id, pts.length ? Math.round((pts.filter((t) => t.status === "done").length / pts.length) * 100) : 0];
    }),
  );
  const paletteTasks = tasks.map((t) => ({
    key: t.key, title: t.title, status: t.status,
    href: t.projectId ? `/project/${t.projectId}?task=${t.key}` : t.areaId ? `/area/${t.areaId}?task=${t.key}` : `/inbox?task=${t.key}`,
  }));
  return (
    <div className="flex h-full">
      <Sidebar areas={areas} projects={projects} counts={counts} progress={progress} />
      <main className="m-2 ml-0 flex min-w-0 flex-1 overflow-hidden rounded-[10px] border border-line bg-panel">{children}</main>
      <QuickAdd areas={areas} projects={projects} />
      <CommandPalette tasks={paletteTasks} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      <Toaster />
    </div>
  );
}
