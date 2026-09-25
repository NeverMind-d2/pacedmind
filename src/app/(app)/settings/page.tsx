import { SettingsView } from "@/components/views/settings";
import * as repo from "@/server/repo";
import { dbPath } from "@/server/db";
import { mcpUrl } from "@/server/launcher";

export default async function SettingsPage() {
  return (
    <SettingsView
      settings={repo.getSettings()}
      projects={repo.listProjects()}
      areas={repo.listAreas()}
      mcpUrl={mcpUrl()}
      dbFile={dbPath()}
      sessionsCount={repo.listSessions().length}
      platform={process.platform}
    />
  );
}
