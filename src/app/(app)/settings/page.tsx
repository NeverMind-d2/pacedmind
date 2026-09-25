import { SettingsView } from "@/components/views/settings";
import * as repo from "@/server/repo";
import { legacySummary } from "@/server/account";
import { mcpUrl } from "@/server/launcher";
import { deviceConfig } from "@/server/device";
import { encryptedAtRest } from "@/server/secure-file";
import { MODE, authState } from "@/server/supabase";
import type { DeviceSettings } from "@/lib/types";

export default async function SettingsPage() {
  const [settings, projects, areas, sessions, state, devices, legacy] = await Promise.all([
    repo.getSettings(), repo.listProjects(), repo.listAreas(), repo.listSessions(), authState(), repo.listDevices(),
    MODE === "desktop" ? legacySummary() : null,
  ]);
  const d = MODE === "desktop" ? deviceConfig() : null;
  const device: DeviceSettings | null = d && {
    name: d.name, terminal: d.terminal, claudeCommand: d.claudeCommand, codexCommand: d.codexCommand, remoteStart: d.remoteStart,
    deviceId: d.deviceId, encrypted: encryptedAtRest(),
  };
  return (
    <SettingsView
      settings={settings}
      projects={projects}
      areas={areas}
      account={{
        email: state?.user.email ?? null,
        factors: (state?.factors ?? []).filter((f) => f.factor_type === "totp").map((f, i) => ({
          id: f.id, name: f.friendly_name?.replace(/\s·.*$/, "") || `Authenticator ${i + 1}`, added: f.created_at.slice(0, 10),
        })),
        backupCodes: state?.hasRecoveryCodes ?? false,
      }}
      devices={devices.filter((x) => !x.revokedAt)}
      device={device}
      mcp={d ? { url: mcpUrl(), token: d.ownerToken } : null}
      legacy={legacy}
      sessionsCount={sessions.length}
    />
  );
}
