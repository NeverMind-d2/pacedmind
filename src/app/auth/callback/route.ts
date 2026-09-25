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
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNext(url.searchParams.get("next"));
  const failed = (message: string) =>
    NextResponse.redirect(new URL(MODE === "desktop" ? `/auth/done?error=${encodeURIComponent(message)}` : `/login?error=${encodeURIComponent(message)}`, url.origin));

  const code = url.searchParams.get("code");
  if (!code) return failed(url.searchParams.get("error_description")?.slice(0, 200) ?? "That link is incomplete.");
  const db = await supabase();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return failed("That link has expired, was already used, or was opened on another computer. Ask for a new one.");

  if (MODE === "desktop") {
    rememberNext(next);
    return NextResponse.redirect(new URL("/auth/done", url.origin));
  }
  const step = nextStep(await readAuthState());
  const target = new URL(step ?? next, url.origin);
  if (step) target.searchParams.set("next", next);
  return NextResponse.redirect(target);
}
