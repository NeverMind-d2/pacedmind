import { createMcpHandler } from "mcp-handler";
import { authorizeMcp } from "@/server/auth";
import { SERVER_INSTRUCTIONS, registerTools } from "@/server/mcp";
import { runAs } from "@/server/mcp/principal";
import { noteClient } from "@/server/signals";
import { runAsAgent } from "@/server/supabase";

// The tools live in src/server/mcp: planning.ts (areas, projects, tasks), calendar.ts (events, agenda,
// work hours) and agents.ts (dependencies, sessions and the start_task / finish_task protocol). A new server is
// made for every request, inside runAs, so a session's token only ever sees that session's tools.
const handler = createMcpHandler(registerTools, {
  serverInfo: { name: "pacedmind", version: "0.4.0" },
  instructions: SERVER_INSTRUCTIONS,
});

async function guarded(req: Request): Promise<Response> {
  const caller = await authorizeMcp(req);
  if (caller instanceof Response) return caller;
  const { who, agentToken } = caller;
  // In the hosted app, every query of the request runs with the agent's own token (row level security).
  if (agentToken) return runAsAgent(agentToken, () => runAs(who, () => handler(req)));
  // A session's agent says which client it is: in its initialize request, or with every request since MCP 2026-07-28
  // (params._meta). Its session records it (signals.ts keeps that to once per client and version).
  if (who.kind === "session" && req.method === "POST") {
    const body: unknown = await req.clone().json().catch(() => null);
    for (const m of Array.isArray(body) ? body : [body]) {
      const params = m && typeof m === "object" ? (m as { params?: Record<string, unknown> }).params : undefined;
      const meta = params?._meta as Record<string, unknown> | undefined;
      const info = (meta?.["io.modelcontextprotocol/clientInfo"] ?? params?.clientInfo) as { name?: unknown; version?: unknown } | undefined;
      if (info && typeof info === "object") {
        await noteClient(who.sessionId, info.name, info.version).catch(() => {});
        break;
      }
    }
  }
  return runAs(who, () => handler(req));
}

export { guarded as GET, guarded as POST, guarded as DELETE };
