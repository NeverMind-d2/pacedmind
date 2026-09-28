"use server";

import { redirect } from "next/navigation";
import { guardAction } from "@/server/guard";
import { MODE, supabase } from "@/server/supabase";

/*
 * Approving or refusing an agent's sign-in to PacedMind Cloud's MCP server (the hosted app). An approval is the
 * database's (approve_agent_login, from this two-factor session) before it is Supabase's: Supabase would take the
 * consent from any signed-in session and remembers it for next time, so its tokens count only with ours.
 */

type Result = { ok: false; error: string } | { ok: true; message: string };

const REQUEST = /^[A-Za-z0-9_-]{1,200}$/;
const UNSAFE_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:"]);

/** Whether `to` goes back to the authorization's own address (with its code and state added). */
function backToClient(to: string, redirectUri: string): boolean {
  try {
    const a = new URL(to);
    const b = new URL(redirectUri);
    return !UNSAFE_SCHEMES.has(a.protocol) && a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

const explain = (message: string) =>
  /expired|not found|cannot be processed/i.test(message)
    ? "That sign-in request has expired or was already used. Start connecting the agent again."
    : message;

/**
 * Allows the agent's sign-in `id`. `held`: the address Supabase gave when it approved by itself (the agent was
 * allowed before), which the page kept until you chose.
 */
export async function approveAgentAction(id: string, held: string | null): Promise<Result> {
  if (MODE !== "web" || !REQUEST.test(id)) return { ok: false, error: "That sign-in request isn't valid." };
  await guardAction();
  const db = await supabase();
  const { data, error } = await db.rpc("approve_agent_login", { request_id: id });
  if (error) return { ok: false, error: explain(error.message) };
  const redirectUri = (data as { redirect_uri?: unknown } | null)?.redirect_uri;
  if (typeof redirectUri !== "string") return { ok: false, error: "That sign-in request has expired. Start connecting the agent again." };
  let to = held;
  if (!to) {
    const approved = await db.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true });
    if (approved.error || !approved.data) return { ok: false, error: explain(approved.error?.message ?? "PacedMind couldn't approve it.") };
    to = approved.data.redirect_url;
  }
  if (!backToClient(to, redirectUri)) return { ok: false, error: "That agent's address doesn't match its request. Start connecting it again." };
  redirect(to);
}

/** Refuses the agent's sign-in `id`; the agent hears so, unless Supabase already approved it by itself (`held`). */
export async function denyAgentAction(id: string, held: boolean): Promise<Result> {
  if (MODE !== "web" || !REQUEST.test(id)) return { ok: false, error: "That sign-in request isn't valid." };
  await guardAction();
  // Supabase approved it already; without our approval its code gets the agent nowhere, and it expires.
  if (held) return { ok: true, message: "Not connected. You can close this tab." };
  const db = await supabase();
  const denied = await db.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
  if (denied.error || !denied.data) return { ok: true, message: "Not connected. You can close this tab." };
  // The agent's own address, with access_denied: it stops waiting.
  const details = new URL(denied.data.redirect_url);
  if (UNSAFE_SCHEMES.has(details.protocol)) return { ok: true, message: "Not connected. You can close this tab." };
  redirect(denied.data.redirect_url);
}
