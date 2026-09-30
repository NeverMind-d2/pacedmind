import { readPatch } from "@/server/diff";
import { MODE, authState } from "@/server/supabase";

/**
 * A report's full diff, for the task panel and the Sessions screen. Only the app's own window may ask (proxy.ts). The
 * file stays on the computer the session ran on (diff.ts); elsewhere, and in the web app, there's none. Signed in
 * without the second factor, there's nothing either. Ids are random, so the browser may keep what it got.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // A failed identity lookup must not be mistaken for the unrestricted local-data mode.
  let state;
  try {
    state = MODE === "desktop" ? await authState() : null;
  } catch {
    return new Response("Couldn't verify sign-in", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const text = MODE === "desktop" && (!state || state.aal === "aal2") ? readPatch(id) : null;
  if (text === null) return new Response("Not on this computer", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(text, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
