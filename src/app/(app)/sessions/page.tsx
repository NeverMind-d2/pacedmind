import { SessionsView } from "@/components/views/sessions";
import { otherSessionGroups, sessionList } from "@/server/session-list";
import { nowStamp } from "@/lib/dates";

export default async function SessionsPage(props: PageProps<"/sessions">) {
  const sp = await props.searchParams;
  const [{ groups, initialId, startable, attachable }, others] = await Promise.all([sessionList(typeof sp.s === "string" ? sp.s : null), otherSessionGroups()]);
  return <SessionsView groups={groups} others={others} initialId={initialId} startable={startable} attachable={attachable} now={nowStamp()} />;
}
