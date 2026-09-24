import { createMcpHandler } from "mcp-handler";
import { authorized } from "@/server/auth";
import { SERVER_INSTRUCTIONS, registerTools } from "@/server/mcp";

// The tools live in src/server/mcp: planning.ts (areas, projects, tasks), calendar.ts (events, agenda,
// work hours) and agents.ts (flows, sessions and the start_task / finish_task protocol).
const handler = createMcpHandler(registerTools, {
  serverInfo: { name: "organizer", version: "0.2.0" },
  instructions: SERVER_INSTRUCTIONS,
});

async function guarded(req: Request): Promise<Response> {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });
  return handler(req);
}

export { guarded as GET, guarded as POST, guarded as DELETE };
