import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Sidebar } from "@/components/sidebar";
import { AppHeader } from "@/components/app-header";
import { QuickAdd } from "@/components/quick-add";
import { CommandPalette } from "@/components/command-palette";
import { LiveRefresh } from "@/components/live-refresh";
import { Approvals } from "@/components/approvals";
import { RemoteStart } from "@/components/remote-start";
import { ImportOffer } from "@/components/import-projects";
import { Toaster } from "@/components/ui";
import * as repo from "@/server/repo";
import { deviceConfig } from "@/server/device";
import { MODE, authState } from "@/server/supabase";
import { nextStep } from "@/server/auth-flow";
import { approvalItems } from "@/server/requests";
import { usage } from "@/server/views";
import { dateOnly, todayStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * The app's frame. Signed in to PacedMind Cloud, every page needs the account's second factor (the database
 * insists on it too); the web app needs an account. Without one, the desktop app shows this computer's own data.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const state = await authState();
  const step = state || MODE === "web" ? nextStep(state) : null;
  if (step) redirect(step);
  const user = state?.user ?? null;
  const [areas, projects, tasks, waiting, all] = await Promise.all([
    repo.listAreas(), repo.listProjects(), repo.listTasks(), repo.listSessions({ status: ["finished"] }), repo.listDevices(),
  ]);
  // Where "Start on a computer" can send a session: in the desktop app, the other computers.
  const me = MODE === "desktop" ? deviceConfig().deviceId : null;
  const devices = all.filter((d) => d.id !== me);
  const today = todayStr();
  const open = (t: (typeof tasks)[number]) => t.status !== "done" && t.status !== "canceled";
  const counts = {
    inbox: tasks.filter((t) => !t.areaId && !t.projectId && open(t)).length,
    today: tasks.filter((t) => open(t) && ((t.dueDate && dateOnly(t.dueDate) <= today) || t.plannedDate === today)).length,
    sessions: waiting.length,
  };
  const approvals = MODE === "desktop" ? approvalItems(tasks) : [];
  const paletteTasks = tasks.map((t) => ({
    key: t.key, title: t.title, status: t.status,
    href: t.projectId ? `/project/${t.projectId}?task=${t.key}` : t.areaId ? `/area/${t.areaId}?task=${t.key}` : `/inbox?task=${t.key}`,
  }));
  return (
    <div className="flex h-full flex-col">
      <AppHeader email={user?.email ?? null} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar areas={areas} projects={projects} counts={counts} usage={usage(areas, projects, tasks)} />
        <main className="m-2 ml-0 flex min-w-0 flex-1 overflow-hidden rounded-[10px] border border-line bg-panel">{children}</main>
      </div>
      {approvals.length > 0 && <Approvals items={approvals} />}
      <RemoteStart devices={devices} tasks={tasks.map((t) => ({ id: t.id, key: t.key, title: t.title }))} />
      <QuickAdd areas={areas} projects={projects} />
      <CommandPalette tasks={paletteTasks} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      <Toaster />
      <LiveRefresh />
      {/* The first time PacedMind opens on a computer, it offers to bring the Claude Code and Codex projects there over. */}
      {MODE === "desktop" && !deviceConfig().importOffered && <ImportOffer areas={areas} />}
    </div>
  );
}
