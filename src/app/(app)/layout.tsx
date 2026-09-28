import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Sidebar } from "@/components/sidebar";
import { AppHeader } from "@/components/app-header";
import { QuickAdd } from "@/components/quick-add";
import { ActivityEditor } from "@/components/activity-editor";
import { CommandPalette } from "@/components/command-palette";
import { LiveRefresh } from "@/components/live-refresh";
import { Approvals } from "@/components/approvals";
import { RemoteStart } from "@/components/remote-start";
import { ImportOffer } from "@/components/import-projects";
import { CloudConnectOffer } from "@/components/cloud-connect-offer";
import { Toaster } from "@/components/ui";
import * as repo from "@/server/repo";
import { deviceConfig } from "@/server/device";
import { localTools, mcpLinks } from "@/server/devices";
import { mcpUrl } from "@/server/launcher";
import { MODE, authState } from "@/server/supabase";
import { nextStep } from "@/server/auth-flow";
import { approvalItems } from "@/server/requests";
import { usage } from "@/server/views";
import { dateOnly, todayStr } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * The app's frame. Signed in to PacedMind Cloud, every page needs the account's second factor (the database
 * insists on it too); the web app needs an account. Without one, the desktop app shows this computer's own
 * data once "Continue without an account" was chosen on the sign-in screen, and until then the screen itself.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await connection();
  const state = await authState();
  const step = state || MODE === "web" ? nextStep(state) : deviceConfig().withoutAccount ? null : "/login";
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
  // Signed in on the desktop, after the import's first offer: the agents here not yet on PacedMind Cloud's MCP server.
  const offer = MODE === "desktop" && state?.aal === "aal2" && deviceConfig().importOffered && !deviceConfig().cloudConnectOffered;
  const found = offer ? localTools() : null;
  const links = offer ? mcpLinks(mcpUrl(), true) : null;
  const cloudOffer = found && links ? (["claude", "codex"] as const).filter((a) => found[a].cli && links[a] !== "cloud") : [];
  const paletteTasks = tasks.map((t) => ({
    key: t.key, title: t.title, status: t.status,
    href: t.projectId ? `/project/${t.projectId}?task=${t.key}` : t.areaId ? `/area/${t.areaId}?task=${t.key}` : `/inbox?task=${t.key}`,
  }));
  return (
    <div className="flex h-full flex-col">
      <AppHeader email={user?.email ?? null} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar areas={areas} projects={projects} counts={counts} usage={usage(areas, projects, tasks)} />
        {/* On a phone the sidebar is a panel over the page, and the page takes the whole width. */}
        <main className="m-2 ml-0 flex min-w-0 flex-1 overflow-hidden rounded-[10px] border border-line bg-panel max-md:m-0 max-md:rounded-none max-md:border-x-0 max-md:border-b-0">{children}</main>
      </div>
      {approvals.length > 0 && <Approvals items={approvals} />}
      <RemoteStart devices={devices} tasks={tasks.map((t) => ({ id: t.id, key: t.key, title: t.title }))} />
      <QuickAdd areas={areas} projects={projects} />
      <ActivityEditor areas={areas} />
      <CommandPalette tasks={paletteTasks} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      <Toaster />
      <LiveRefresh />
      {/* The first time PacedMind opens on a computer, it offers to bring the Claude Code and Codex projects there over. */}
      {MODE === "desktop" && !deviceConfig().importOffered && <ImportOffer areas={areas} />}
      {/* Once signed in, it offers (once) to connect the agents here to PacedMind Cloud's MCP server. */}
      {cloudOffer.length > 0 && <CloudConnectOffer agents={cloudOffer} />}
    </div>
  );
}
