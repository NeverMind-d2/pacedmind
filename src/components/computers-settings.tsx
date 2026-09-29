import { ComputersView, type ComputerSession } from "@/components/views/computers";
import { thisDevice } from "@/server/devices";
import { mcpUrl } from "@/server/launcher";
import * as repo from "@/server/repo";
import { MODE, authState } from "@/server/supabase";
import { LIVE_STATUSES } from "@/lib/types";

/** The server's clock for the page's first render ("last seen", online); the view keeps it ticking. */
const clock = () => Date.now();

/**
 * The account's computers, or without an account this one: what each found of Claude Code and Codex, and its
 * sessions; renaming, the default computer and signing one out. Each computer reported these itself; what runs
 * on it is still decided there (device.ts).
 */
export async function ComputersSettings() {
  const [state, all, me, tasks, sessions] = await Promise.all([
    authState(), repo.listDevices(), MODE === "desktop" ? thisDevice() : null,
    repo.listTasks(), repo.listSessions({ status: [...LIVE_STATUSES, "finished"] }),
  ]);
  const account = MODE === "web" || !!state;
  // This computer first (only the desktop app has one; signed in, once it joined the account's list, which takes
  // seconds), then the default, then the others as the account lists them: a steady order while dots come and go.
  const here = me && (me.id || !account) && !me.revokedAt ? me : null;
  const others = all.filter((d) => !d.revokedAt && d.id !== here?.id);
  const devices = [...(here ? [here] : []), ...others.filter((d) => d.isDefault), ...others.filter((d) => !d.isDefault)];

  const taskOf = new Map(tasks.map((t) => [t.id, t]));
  const briefs = await repo.reportBriefs(sessions.filter((s) => s.status === "finished").map((s) => s.id));
  const items: ComputerSession[] = sessions.map((s) => ({
    id: s.id, status: s.status, agent: s.agent, surface: s.surface, deviceId: s.deviceId,
    key: taskOf.get(s.taskId)?.key ?? null, title: taskOf.get(s.taskId)?.title ?? null,
    startedAt: s.startedAt, finishedAt: s.finishedAt, outcome: briefs.get(s.id)?.outcome ?? null,
  }));

  return (
    <ComputersView
      devices={devices}
      hereId={here ? here.id : null}
      account={account}
      registering={!!me && !me.id && account}
      sessions={items}
      mcpUrl={MODE === "desktop" ? mcpUrl() : null}
      now={clock()}
    />
  );
}
