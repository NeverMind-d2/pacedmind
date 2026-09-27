import { NextResponse, type NextRequest } from "next/server";
import { MODE, readAuthState, supabase } from "@/server/supabase";
import { nextStep, rememberNext, safeNext } from "@/server/auth-flow";

/**
 * Where links from sign-up and password-reset emails land. Only the PKCE flow: the link carries a one-time
 * code, and only the server that asked for the email holds the matching verifier, so a link made for
 * someone else's account can't sign this app in (no login CSRF).
 *
 * In the desktop app the email may open in any browser; the session still goes to the app, and that browser
 * gets a page that says to go back to the app's window (which has the key; see proxy.ts).
 *
 * Redirects are paths on the address the browser used: a route only knows its own address as localhost and
 * the port it listens on, which behind Caddy (the hosted app) isn't where the browser is.
 */
const go = (path: string) => new NextResponse(null, { status: 307, headers: { Location: path } });

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  // Sign-up links continue to Today; password resets to choosing a new password.
  const reset = next === "/login/new-password";
  const page = MODE === "desktop" ? "/auth/done" : "/login";
  const failed = (message: string) => go(`${page}?error=${encodeURIComponent(message)}`);

  const code = url.searchParams.get("code");
  if (!code) {
    // Opened twice, or too late: Supabase says so before sending the browser here.
    if (url.searchParams.get("error_code") === "otp_expired") {
      return failed(reset
        ? "That link was already used or has expired. Ask for a new one."
        : "That link was already used or has expired. If you opened it before, your email is confirmed and you can sign in.");
    }
    return failed(url.searchParams.get("error_description")?.slice(0, 200) ?? "That link is incomplete.");
  }
  const db = await supabase();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) {
    // Supabase confirmed the email before handing the link over; it only can't sign in here, e.g. in another
    // browser than the one that signed up (the code's verifier stays there, see above).
    if (!reset) return go(`${page}?confirmed=1`);
    return failed(error.code === "pkce_code_verifier_not_found"
      ? "Open the link in the browser where you asked for it, or ask for a new one."
      : "That link has expired or was already used. Ask for a new one.");
  }

  if (MODE === "desktop") {
    rememberNext(next);
    return go("/auth/done");
  }
  const step = nextStep(await readAuthState());
  return go(step ? `${step}?next=${encodeURIComponent(next)}` : next);
}
