import { SessionsView } from "@/components/views/sessions";
import { sessionList } from "@/server/session-list";
import { nowStamp } from "@/lib/dates";

export default async function SessionsPage(props: PageProps<"/sessions">) {
  const sp = await props.searchParams;
  const { groups, initialId, startable } = await sessionList(typeof sp.s === "string" ? sp.s : null);
  return <SessionsView groups={groups} initialId={initialId} startable={startable} now={nowStamp()} />;
}
