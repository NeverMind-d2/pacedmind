import { MODE } from "@/server/supabase";
import { cloudMcpUrl, supabaseConfig } from "@/server/supabase-config";

/*
 * PacedMind Cloud's MCP server as an OAuth protected resource (RFC 9728), at /.well-known/oauth-protected-resource
 * and /.well-known/oauth-protected-resource/api/mcp: an agent that gets a 401 from /api/mcp reads here where to sign
 * in (Supabase Auth's OAuth 2.1 server) and registers itself there. Public and the same for everyone; only the hosted
 * app has it (the desktop app's MCP server takes its own tokens).
 */

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

export function GET() {
  if (MODE !== "web") return new Response("Not found", { status: 404 });
  return Response.json({
    resource: cloudMcpUrl(),
    authorization_servers: [`${supabaseConfig().url}/auth/v1`],
    bearer_methods_supported: ["header"],
    resource_name: "PacedMind",
    resource_documentation: "https://pacedmind.com/docs/mcp",
  }, { headers: { ...CORS, "Cache-Control": "public, max-age=3600" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
