import "server-only";
import * as repo from "./repo";
import { deviceFor, principalFor, revokeSessionTokens, type Principal } from "./device";
import { MODE, authState } from "./supabase";

/*
 * Who may use MCP. Agents reach it only in the desktop app, where their terminals run, and only with a
 * token: the owner token (Settings, for Claude Code and Codex you start yourself) or the token of one
 * session PacedMind started, which works for that session's tools until its terminal closes. They use the
 * signed-in account's data once it passed its second factor, or without an account this computer's own.
 */

const bearer = (req: Request) => {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
};

/** Who the request acts for, or the response that refuses it. */
export async function authorizeMcp(req: Request): Promise<Principal | Response> {
  if (MODE !== "desktop") return new Response("Not found", { status: 404 });
  // Browsers send Origin with every cross-origin and every POST request; MCP clients (Claude Code, Codex)
  // don't. Refusing it keeps web pages out even if one learned a token.
  if (req.headers.get("origin")) return new Response("Forbidden", { status: 403 });
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
  return who;
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
