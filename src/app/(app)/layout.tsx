import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Sidebar } from "@/components/sidebar";
import { AppHeader } from "@/components/app-header";
import { ExecutionProvider } from "@/components/execution-context";
import { QuickAdd } from "@/components/quick-add";
import { ActivityEditor } from "@/components/activity-editor";
import { CommandPalette } from "@/components/command-palette";
import { LiveRefresh } from "@/components/live-refresh";
import { Approvals } from "@/components/approvals";
import { RemoteStart } from "@/components/remote-start";
import { ImportOffer } from "@/components/import-projects";
import { CloudConnectOffer } from "@/components/cloud-connect-offer";
import { LinkOffer, type Linkable } from "@/components/link-offer";
import { Toaster } from "@/components/ui";
import { BillingBanner } from "@/components/billing";
import * as repo from "@/server/repo";
import { deviceConfig } from "@/server/device";
import { localTools, mcpLinks, thisDevice } from "@/server/devices";
import { folderHints } from "@/server/folder-hints";
import { mcpUrl } from "@/server/launcher";
import { MODE, authState } from "@/server/supabase";
import { nextStep } from "@/server/auth-flow";
import { approvalItems } from "@/server/requests";
import { readPlan } from "@/server/billing";
import { usage } from "@/server/views";
import { dateOnly, todayStr } from "@/lib/dates";
import type { FoundFolder } from "@/lib/types";

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
  const [areas, projects, tasks, waiting, all, plan] = await Promise.all([
    repo.listAreas(), repo.listProjects(), repo.listTasks(), repo.listSessions({ status: ["finished"] }), repo.listDevices(), readPlan(),
  ]);
  // Where "Start on a computer" can send a session: in the desktop app, the other computers.
  const me = MODE === "desktop" ? deviceConfig().deviceId : null;
  const devices = all.filter((d) => d.id !== me);
  const here = MODE === "desktop" ? await thisDevice() : null;
  const executionDevices = [...(here ? [{ ...here, otherSessions: all.find((d) => d.id === here.id)?.otherSessions ?? [] }] : []), ...all.filter((d) => !d.revokedAt && d.id !== here?.id)];
  // Which projects and areas without a folder here have a copy on this computer (desktop app).
  const folders = await folderHints(areas, projects);
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
  // Signed in, after the import's first offer: your projects and areas from other computers whose copy is surely here
  // (their pacedmind.md or their repository, and only one such folder), to link in one click.
  const seen = new Set(MODE === "desktop" ? deviceConfig().linkOfferSeen : []);
  const sure = (list: FoundFolder[] | undefined) =>
    list?.[0] && list[0].how !== "name" && list.filter((f) => f.how === list[0].how).length === 1 ? list[0] : null;
  const linkable: Linkable[] = folders && state && deviceConfig().importOffered ? [
    ...projects.flatMap((p) => { const f = sure(folders.projects[p.id]); return f && !seen.has(`${p.id}>${f.folder}`) ? [{ kind: "project" as const, id: p.id, name: p.name, folder: f.folder, how: f.how }] : []; }),
    ...areas.flatMap((a) => { const f = sure(folders.areas[a.id]); return f && !seen.has(`${a.id}>${f.folder}`) ? [{ kind: "area" as const, id: a.id, name: a.name, folder: f.folder, how: f.how }] : []; }),
  ] : [];
  const paletteTasks = tasks.map((t) => ({
    key: t.key, title: t.title, status: t.status,
    href: t.projectId ? `/project/${t.projectId}?task=${t.key}` : t.areaId ? `/area/${t.areaId}?task=${t.key}` : `/inbox?task=${t.key}`,
  }));
  return (
    <ExecutionProvider devices={executionDevices} hereId={here?.id ?? null} desktop={MODE === "desktop"} folders={folders}>
    <div className="flex h-full flex-col">
      <AppHeader email={user?.email ?? null} />
      {plan?.enforced && <BillingBanner plan={plan} desktop={MODE === "desktop"} />}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar areas={areas} projects={projects} counts={counts} usage={usage(areas, projects, tasks)} desktop={MODE === "desktop"} />
        {/* On a phone the sidebar is a panel over the page, and the page takes the whole width. */}
        <main className="m-2 ml-0 flex min-w-0 flex-1 overflow-hidden rounded-[10px] border border-line bg-panel max-md:m-0 max-md:rounded-none max-md:border-x-0 max-md:border-b-0">{children}</main>
      </div>
      {approvals.length > 0 && <Approvals items={approvals} />}
      <RemoteStart devices={devices} tasks={tasks.map((t) => ({
        id: t.id, key: t.key, title: t.title, needs: t.needs, runsOn: t.deviceId ?? projects.find((p) => p.id === t.projectId)?.deviceId ?? null,
      }))} />
      <QuickAdd areas={areas} projects={projects} />
      <ActivityEditor areas={areas} />
      <CommandPalette tasks={paletteTasks} projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      <Toaster />
      <LiveRefresh />
      {/* The first time PacedMind opens on a computer, it offers to bring the Claude Code and Codex projects there over. */}
      {MODE === "desktop" && !deviceConfig().importOffered && <ImportOffer areas={areas} />}
      {/* Once signed in, it offers (once) to connect the agents here to PacedMind Cloud's MCP server. */}
      {cloudOffer.length > 0 && <CloudConnectOffer agents={cloudOffer} />}
      {/* One card at a time: the agents' connection first. */}
      {!cloudOffer.length && linkable.length > 0 && <LinkOffer items={linkable} areas={areas} />}
    </div>
    </ExecutionProvider>
  );
}
