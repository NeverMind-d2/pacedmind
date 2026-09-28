import { MODE } from "@/server/supabase";
import { supabaseConfig } from "@/server/supabase-config";

/*
 * Supabase Auth's OAuth 2.1 server metadata (RFC 8414), passed on here for MCP clients that look for it on the MCP
 * server's own address instead of following /.well-known/oauth-protected-resource. Its endpoints stay Supabase's.
 */

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" };

const g = globalThis as unknown as { __pacedmindAuthServer?: { at: number; body: unknown } };

export async function GET() {
  if (MODE !== "web") return new Response("Not found", { status: 404 });
  if (!g.__pacedmindAuthServer || Date.now() - g.__pacedmindAuthServer.at > 3_600_000) {
    // Where RFC 8414 puts it for the issuer .../auth/v1, else where Auth itself answers (a local stack's gateway).
    const { url } = supabaseConfig();
    let res: Response | null = null;
    for (const at of [`${url}/.well-known/oauth-authorization-server/auth/v1`, `${url}/auth/v1/.well-known/oauth-authorization-server`]) {
      res = await fetch(at, { cache: "no-store" }).catch(() => null);
      if (res?.ok) break;
    }
    if (!res?.ok) return new Response("Sign-in isn't available right now.", { status: 502, headers: CORS });
    g.__pacedmindAuthServer = { at: Date.now(), body: await res.json() };
  }
  return Response.json(g.__pacedmindAuthServer.body, { headers: { ...CORS, "Cache-Control": "public, max-age=3600" } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
