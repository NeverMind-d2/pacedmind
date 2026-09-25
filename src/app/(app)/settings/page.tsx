import { SettingsView } from "@/components/views/settings";
import * as repo from "@/server/repo";
import { dbPath } from "@/server/db";
import { thisDevice } from "@/server/devices";
import { mcpUrl } from "@/server/launcher";

export default async function SettingsPage() {
  const me = thisDevice();
  return (
    <SettingsView
      settings={repo.getSettings()}
      projects={repo.listProjects()}
      areas={repo.listAreas()}
      devices={[me, ...repo.listDevices().filter((d) => d.id !== me.id)]}
      thisDeviceId={me.id}
      mcpUrl={mcpUrl()}
      dbFile={dbPath()}
      sessionsCount={repo.listSessions().length}
    />
  );
}
