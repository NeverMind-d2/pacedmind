import "server-only";
import * as repo from "./repo";
import { deviceFor, principalFor, revokeSessionTokens, type Principal } from "./device";
import { MODE, authState, readAuthState, runAsAgent, supabase } from "./supabase";
import { cloudOrigin } from "./supabase-config";

/*
 * Who may use MCP.
 *
 * In the desktop app, agents on this computer, with a token: the owner token (Settings, for Claude Code and Codex
 * you start yourself) or the token of one session PacedMind started, which works for that session's tools until its
 * terminal closes. They use the signed-in account's data once it passed its second factor, or without an account
 * this computer's own.
 *
 * In the hosted app (PacedMind Cloud's MCP server), agents signed in to the account with OAuth: Supabase Auth issues
 * their tokens, and the database answers one only once you approved that very sign-in on the consent page from a
 * two-factor session (supabase/migrations/*_agent_logins.sql). They act as you, like the owner token, without the
 * computers: they can't start sessions or answer for you.
 */

const bearer = (req: Request) => {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
};

/** Who an MCP request acts for: a principal, and in the hosted app the agent's own token its queries run with. */
export type McpCaller = { who: Principal; agentToken?: string };

/** The hosted MCP server's metadata (RFC 9728), which tells an agent where to sign in. */
export const resourceMetadataUrl = () => `${cloudOrigin()}/.well-known/oauth-protected-resource/api/mcp`;

/** A 401 that starts an MCP client's OAuth sign-in (MCP authorization, RFC 9728). */
function signInFirst(error?: string, description?: string): Response {
  const parts = [`resource_metadata="${resourceMetadataUrl()}"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return new Response(description ?? "Sign in to PacedMind first.", {
    status: 401,
    headers: { "WWW-Authenticate": `Bearer ${parts.join(", ")}`, "Content-Type": "text/plain; charset=utf-8" },
  });
}

// Agent sign-ins this server saw approved, so it claims each once (the database checks every query anyway).
const g = globalThis as unknown as { __pacedmindAgentLogins?: Map<string, number> };
const claimed = (g.__pacedmindAgentLogins ??= new Map());

/** An agent's OAuth token for the hosted MCP server: valid, an agent's (not a browser's), and approved. */
async function authorizeAgent(token: string): Promise<McpCaller | Response> {
  if (!token) return signInFirst();
  return runAsAgent(token, async () => {
    const state = await readAuthState().catch(() => null);
    if (!state) return signInFirst("invalid_token", "That sign-in has ended. Sign in to PacedMind again.");
    if (!state.clientId || !state.sessionId) {
      return signInFirst("invalid_token", "Agents sign in to PacedMind with their own sign-in, not a browser's.");
    }
    const seen = claimed.get(state.sessionId);
    if (!seen || seen < Date.now()) {
      const db = await supabase();
      const { data, error } = await db.rpc("claim_agent_login");
      if (error || data !== true) {
        return signInFirst("invalid_token", "PacedMind didn't approve this sign-in. Connect the agent again and allow it on the page that opens.");
      }
      if (claimed.size > 10_000) claimed.clear();
      claimed.set(state.sessionId, Date.now() + 10 * 60_000);
    }
    return { who: { kind: "owner" }, agentToken: token };
  });
}

/** Who the request acts for, or the response that refuses it. */
export async function authorizeMcp(req: Request): Promise<McpCaller | Response> {
  // Browsers send Origin with every cross-origin and every POST request; MCP clients (Claude Code, Codex)
  // don't. Refusing it keeps web pages out even if one learned a token.
  if (req.headers.get("origin")) return new Response("Forbidden", { status: 403 });
  if (MODE === "web") return authorizeAgent(bearer(req));
  const state = await authState();
  if (state && state.aal !== "aal2") {
    return new Response("PacedMind is signing in. Enter your two-factor code in the desktop app first.", { status: 503 });
  }
  if (state) deviceFor(state.user.id);
  const who = principalFor(bearer(req));
  if (!who) return new Response("Unauthorized", { status: 401 });
  if (who.kind === "session") {
    const s = await repo.getSession(who.sessionId);
    if (!s || s.endedAt || s.status === "closed" || s.status === "failed") {
      revokeSessionTokens([who.sessionId]);
      return new Response("This session has ended, so its token no longer works.", { status: 401 });
    }
  }
  return { who };
}

/**
 * Who calls a session's SessionEnd hook: its own token (which moves along a "same session" chain) or yours.
 * The route checks that the token belongs to that terminal's chain.
 */
export async function authorizeHook(req: Request): Promise<Principal | null> {
  if (MODE !== "desktop" || req.headers.get("origin")) return null;
  const state = await authState();
  if (state && state.aal !== "aal2") return null;
  if (state) deviceFor(state.user.id);
  return principalFor(bearer(req));
}
