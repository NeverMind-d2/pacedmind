import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAuthState } from "./supabase";

/*
 * A fresh two-factor code for actions that weaken the account or reach a computer from afar. Verifying it
 * gives the session a new "second factor just now" timestamp (the amr claim), which the database checks
 * for requests to start sessions and for deleting the account (private.recent_mfa).
 */

const CODE = /^\d{6}$/;

export function explainAuthError(message: string): string {
  if (/invalid totp|invalid code|expired|challenge/i.test(message)) return "That code didn't work. Codes change every 30 seconds; enter the current one.";
  if (/rate limit|too many|over_request/i.test(message)) return "Too many tries in a short time. Wait a few minutes and try again.";
  if (/insufficient_aal|aal2/i.test(message)) return "Enter your two-factor code first.";
  return message;
}

/**
 * What to say when the database refused a step-up anyway: the code came from an authenticator added after
 * this sign-in, which doesn't count (supabase/migrations: private.recent_mfa).
 */
export const STEP_UP_REFUSED =
  "That needs a code from an authenticator you had before this sign-in. If you added one just now, sign out and in again, then try again.";

export const refusedStepUp = (message: string) => /row-level security|two-factor code first/i.test(message);

/**
 * Verifies `code` against the given authenticator, or against each of the account's (oldest first: the one
 * that counts for a step-up is one the account had before this sign-in) until one takes it. Returns why
 * not, or null.
 */
export async function verifyCode(db: SupabaseClient, code: string, factorId?: string | null): Promise<string | null> {
  const digits = code.replace(/\s+/g, "");
  if (!CODE.test(digits)) return "Enter the 6-digit code from your authenticator app.";
  const state = await readAuthState();
  const totp = (state?.factors.filter((f) => f.factor_type === "totp") ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const candidates = factorId ? totp.filter((f) => f.id === factorId) : totp;
  if (!candidates.length) return "Set up an authenticator app first.";
  let problem = "That code didn't work.";
  for (const factor of candidates) {
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
    if (!error) return null;
    problem = explainAuthError(error.message);
    if (/too many/i.test(problem)) break;
  }
  return problem;
}
