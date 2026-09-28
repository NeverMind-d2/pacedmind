import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ComputersSettings } from "@/components/computers-settings";
import {
  AccountSettings, AppearanceSettings, ComputerSettings, DataSettings, McpSettings, NotificationSettings, PlanSettings,
  PlanningSettings, ProjectSettings, SecuritySettings, SessionSettings, SettingsContent, type AccountView,
} from "@/components/views/settings";
import * as repo from "@/server/repo";
import { legacySummary } from "@/server/account";
import { readPlan } from "@/server/billing";
import { mcpLinks, thisDevice } from "@/server/devices";
import { mcpUrl } from "@/server/launcher";
import { deviceConfig, projectServers } from "@/server/device";
import { folderExtras, serverChoices } from "@/server/extras";
import { encryptedAtRest } from "@/server/secure-file";
import { MODE, authState } from "@/server/supabase";
import { cloudMcpUrl } from "@/server/supabase-config";
import { settingsMenu, type SettingsSection } from "@/lib/settings-menu";
import type { DeviceSettings, ProjectAgentsView } from "@/lib/types";

type Auth = NonNullable<Awaited<ReturnType<typeof authState>>>;

function accountView(state: Auth): AccountView {
  return {
    email: state.user.email ?? null,
    factors: state.factors.filter((f) => f.factor_type === "totp").map((f, i) => ({
      id: f.id, name: f.friendly_name?.replace(/\s·.*$/, "") || `Authenticator ${i + 1}`, added: f.created_at.slice(0, 10),
    })),
    backupCodes: state.hasRecoveryCodes,
  };
}

/** This computer's own settings, for the desktop app's pages. */
function deviceSettings(): DeviceSettings {
  const d = deviceConfig();
  return {
    name: d.name, terminal: d.terminal, claudeCommand: d.claudeCommand, codexCommand: d.codexCommand, remoteStart: d.remoteStart,
    trustFolders: d.trustFolders, remoteAnswers: !!d.remoteAnswers, deviceId: d.deviceId, encrypted: encryptedAtRest(), importOffered: d.importOffered,
  };
}

/** A Settings page, reading only what it shows. The menu (settingsMenu) says which pages there are here. */
export default async function SettingsSectionPage(props: PageProps<"/settings/[section]">) {
  const { section } = await props.params;
  const [state, plan] = await Promise.all([authState(), readPlan()]);
  const desktop = MODE === "desktop";
  const page = settingsMenu({ account: !!state, plan: !!plan?.enforced, desktop }).flatMap((g) => g.pages).find((p) => p.id === section);
  // Not a page here (signed out since, or the web app): the menu opens its first.
  if (!page) redirect("/settings");
  return <SettingsContent title={page.label} hint={page.hint}>{await body(page.id, state, desktop)}</SettingsContent>;
}

async function body(section: SettingsSection, state: Auth | null, desktop: boolean): Promise<ReactNode> {
  switch (section) {
    case "account": {
      if (!state) return <AccountSettings account={null} devices={[]} thisDeviceId={null} />;
      const [all, me] = await Promise.all([repo.listDevices(), desktop ? thisDevice() : null]);
      // This computer first, once it joined the account's list; then the other computers signed in.
      const here = me?.id ? [me] : [];
      const devices = [...here, ...all.filter((x) => !x.revokedAt && x.id !== me?.id)];
      return <AccountSettings account={accountView(state)} devices={devices} thisDeviceId={here.length ? me!.id : null} />;
    }
    case "plan": {
      const plan = await readPlan();
      return plan && <PlanSettings plan={plan} />;
    }
    case "security":
      return state && <SecuritySettings account={accountView(state)} />;
    case "computers":
      return <ComputersSettings />;
    case "data": {
      const [legacy, sessions] = await Promise.all([state && desktop ? legacySummary() : null, repo.listSessions()]);
      return <DataSettings account={!!state} desktop={desktop} legacy={legacy} sessionsCount={sessions.length} />;
    }
    case "appearance":
      return <AppearanceSettings />;
    case "notifications": {
      // The browsers where notifications are on (web push); the web app can turn them on for itself.
      const subscriptions = await repo.listPushSubscriptions().catch(() => []);
      return <NotificationSettings push={{ web: MODE === "web", devices: subscriptions.map((p) => ({ endpoint: p.endpoint, label: p.label, createdAt: p.createdAt })) }} />;
    }
    case "planning":
      return <PlanningSettings settings={await repo.getSettings()} />;
    case "computer":
      return <ComputerSettings device={deviceSettings()} account={!!state} found={await thisDevice()} />;
    case "sessions":
      return <SessionSettings device={desktop ? deviceSettings() : null} account={!!state} platform={process.platform} />;
    case "projects": {
      const [projects, areas] = await Promise.all([repo.listProjects(), repo.listAreas()]);
      // What agents get in each project's folder here, and the MCP servers its sessions get: this computer's to decide.
      const agents: Record<string, ProjectAgentsView> | null = desktop ? Object.fromEntries(projects.map((p) => {
        const folder = p.folder ?? areas.find((a) => a.id === p.areaId)?.folder ?? null;
        return [p.id, { extras: folder ? folderExtras(folder) : null, choices: serverChoices(folder), servers: projectServers(p.id) }];
      })) : null;
      return <ProjectSettings projects={projects} areas={areas} desktop={desktop} agents={agents} platform={process.platform} />;
    }
    case "mcp": {
      // Your own agents use PacedMind Cloud's MCP server once there's an account; this computer's without one. And the
      // agents allowed on PacedMind Cloud's server.
      const connected = state ? await repo.listConnectedAgents().catch(() => []) : null;
      const d = desktop ? deviceConfig() : null;
      return <McpSettings mcp={{
        url: state ? cloudMcpUrl() : mcpUrl(),
        cloud: !!state,
        local: d ? { url: mcpUrl(), token: d.ownerToken } : null,
        agents: connected,
        links: d ? mcpLinks(mcpUrl(), !!state) : null,
      }} />;
    }
  }
}
