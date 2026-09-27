import { createMcpHandler } from "mcp-handler";
import { authorizeMcp } from "@/server/auth";
import { SERVER_INSTRUCTIONS, registerTools } from "@/server/mcp";
import { runAs } from "@/server/mcp/principal";

// The tools live in src/server/mcp: planning.ts (areas, projects, tasks), calendar.ts (events, agenda,
// work hours) and agents.ts (flows, sessions and the start_task / finish_task protocol). A new server is
// made for every request, inside runAs, so a session's token only ever sees that session's tools.
const handler = createMcpHandler(registerTools, {
  serverInfo: { name: "organizer", version: "0.3.0" },
  instructions: SERVER_INSTRUCTIONS,
});

async function guarded(req: Request): Promise<Response> {
  const who = await authorizeMcp(req);
  if (who instanceof Response) return who;
  return runAs(who, () => handler(req));
}

export { guarded as GET, guarded as POST, guarded as DELETE };
