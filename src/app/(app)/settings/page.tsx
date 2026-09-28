import { SettingsView, type McpSettings } from "@/components/views/settings";
import * as repo from "@/server/repo";
import { legacySummary } from "@/server/account";
import { mcpLinks, thisDevice } from "@/server/devices";
import { mcpUrl } from "@/server/launcher";
import { deviceConfig, projectServers } from "@/server/device";
import { folderExtras, serverChoices } from "@/server/extras";
import { encryptedAtRest } from "@/server/secure-file";
import { MODE, authState } from "@/server/supabase";
import { cloudMcpUrl } from "@/server/supabase-config";
import type { DeviceSettings, ProjectAgentsView } from "@/lib/types";

export default async function SettingsPage() {
  const [settings, projects, areas, sessions, state, devices, legacy, me] = await Promise.all([
    repo.getSettings(), repo.listProjects(), repo.listAreas(), repo.listSessions(), authState(), repo.listDevices(),
    MODE === "desktop" ? legacySummary() : null, MODE === "desktop" ? thisDevice() : null,
  ]);
  const d = MODE === "desktop" ? deviceConfig() : null;
  const device: DeviceSettings | null = d && {
    name: d.name, terminal: d.terminal, claudeCommand: d.claudeCommand, codexCommand: d.codexCommand, remoteStart: d.remoteStart,
    trustFolders: d.trustFolders, remoteAnswers: !!d.remoteAnswers, deviceId: d.deviceId, encrypted: encryptedAtRest(), importOffered: d.importOffered,
  };
  // What agents get in each project's folder here, and the MCP servers its sessions get: this computer's to decide.
  const agents: Record<string, ProjectAgentsView> | null = d && Object.fromEntries(projects.map((p) => [p.id, {
    extras: p.folder ? folderExtras(p.folder) : null, choices: serverChoices(p.folder), servers: projectServers(p.id),
  }]));
  // The browsers where notifications are on (web push), with an account; the web app can turn them on for itself.
  // And the agents allowed on PacedMind Cloud's MCP server.
  const [pushDevices, connected] = state
    ? await Promise.all([repo.listPushSubscriptions().catch(() => []), repo.listConnectedAgents().catch(() => [])])
    : [null, null];
  // Your own agents use PacedMind Cloud's MCP server once there's an account; this computer's without one.
  const mcp: McpSettings = {
    url: state ? cloudMcpUrl() : mcpUrl(),
    cloud: !!state,
    local: d ? { url: mcpUrl(), token: d.ownerToken } : null,
    agents: connected,
    links: d ? mcpLinks(mcpUrl(), !!state) : null,
  };
  // This computer first, with what it found of the agents itself; then the other computers signed in. Without
  // an account, there is only this one (and it has no id in any account yet).
  const signedIn = devices.filter((x) => !x.revokedAt);
  const here = me && (me.id || !state) ? [me] : [];
  return (
    <SettingsView
      settings={settings}
      projects={projects}
      areas={areas}
      account={state && {
        email: state.user.email ?? null,
        factors: state.factors.filter((f) => f.factor_type === "totp").map((f, i) => ({
          id: f.id, name: f.friendly_name?.replace(/\s·.*$/, "") || `Authenticator ${i + 1}`, added: f.created_at.slice(0, 10),
        })),
        backupCodes: state.hasRecoveryCodes,
      }}
      devices={[...here, ...signedIn.filter((x) => x.id !== me?.id)]}
      thisDeviceId={here.length ? me!.id : null}
      device={device}
      mcp={mcp}
      legacy={state ? legacy : null}
      sessionsCount={sessions.length}
      platform={process.platform}
      agents={agents}
      push={pushDevices && { web: MODE === "web", devices: pushDevices.map((p) => ({ endpoint: p.endpoint, label: p.label, createdAt: p.createdAt })) }}
    />
  );
}
