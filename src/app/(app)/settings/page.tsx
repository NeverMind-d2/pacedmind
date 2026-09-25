import { SettingsView } from "@/components/views/settings";
import * as repo from "@/server/repo";
import { legacySummary } from "@/server/account";
import { thisDevice } from "@/server/devices";
import { mcpUrl } from "@/server/launcher";
import { deviceConfig } from "@/server/device";
import { encryptedAtRest } from "@/server/secure-file";
import { MODE, authState } from "@/server/supabase";
import type { DeviceSettings } from "@/lib/types";

export default async function SettingsPage() {
  const [settings, projects, areas, sessions, state, devices, legacy, me] = await Promise.all([
    repo.getSettings(), repo.listProjects(), repo.listAreas(), repo.listSessions(), authState(), repo.listDevices(),
    MODE === "desktop" ? legacySummary() : null, MODE === "desktop" ? thisDevice() : null,
  ]);
  const d = MODE === "desktop" ? deviceConfig() : null;
  const device: DeviceSettings | null = d && {
    name: d.name, terminal: d.terminal, claudeCommand: d.claudeCommand, codexCommand: d.codexCommand, remoteStart: d.remoteStart,
    deviceId: d.deviceId, encrypted: encryptedAtRest(), importOffered: d.importOffered,
  };
  // This computer first, with what it found of the agents itself; then the other computers signed in.
  const signedIn = devices.filter((x) => !x.revokedAt);
  const here = me?.id ? [me] : [];
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
      devices={[...here, ...signedIn.filter((x) => x.id !== me?.id)]}
      thisDeviceId={me?.id || null}
      device={device}
      mcp={d ? { url: mcpUrl(), token: d.ownerToken } : null}
      legacy={legacy}
      sessionsCount={sessions.length}
      platform={process.platform}
    />
  );
}
