import "server-only";
import type { AuthState } from "./supabase";

/*
 * Where someone who is signing in goes next. Every account uses two-factor authentication: after the
 * password comes a code from an authenticator app, and an account without one sets it up first. The
 * database enforces the same (it answers only two-factor sessions), so these steps are about getting there,
 * not about protecting data.
 */

export type AuthStep = "/login" | "/login/setup" | "/login/verify";

export function nextStep(state: AuthState | null): AuthStep | null {
  if (!state) return "/login";
  if (!state.factors.some((f) => f.factor_type === "totp")) return "/login/setup";
  if (state.aal !== "aal2") return "/login/verify";
  return null;
}

/**
 * Pages sign-in may continue to: where an email link pointed, or the page approving an agent's sign-in (the hosted
 * app), which sends you to sign in first. Anything else goes to Today.
 */
const CONTINUE_TO = new Set(["/today", "/login/new-password"]);
const CONSENT = /^\/oauth\/consent\?authorization_id=[A-Za-z0-9_-]{1,200}$/;

export const safeNext = (next: string | null | undefined): string => (next && (CONTINUE_TO.has(next) || CONSENT.test(next)) ? next : "/today");

/** A sign-in step, keeping where to continue afterwards when that isn't Today. */
export const withNext = (step: AuthStep, next: string | null | undefined): string => {
  const to = safeNext(next);
  return to === "/today" ? step : `${step}?next=${encodeURIComponent(to)}`;
};

/*
 * The desktop app finishes email links (sign-up confirmation, password reset) in whichever browser opens
 * them, while you continue in the app's window. The link's destination waits here for the window.
 */
const g = globalThis as unknown as { __pacedmindAfterSignIn?: { next: string; at: number } };

export function rememberNext(next: string) {
  g.__pacedmindAfterSignIn = { next: safeNext(next), at: Date.now() };
}

/** Where to go once signed in with two factors: where an email link pointed (within 30 minutes), else Today. */
export function takeNext(): string {
  const saved = g.__pacedmindAfterSignIn;
  g.__pacedmindAfterSignIn = undefined;
  return saved && Date.now() - saved.at < 30 * 60_000 ? saved.next : "/today";
}
