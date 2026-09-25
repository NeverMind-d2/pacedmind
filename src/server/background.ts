import "server-only";
import { tick, watchStatuses } from "./flow";
import { syncDevice } from "./requests";
import { MODE, NotSignedIn, authState } from "./supabase";

/** Background work of the desktop app's server (and `npm run dev`), started once from src/instrumentation.ts. */
export function startBackground() {
  const g = globalThis as unknown as { __organizerTick?: NodeJS.Timeout; __organizerSync?: NodeJS.Timeout };
  if (MODE !== "desktop" || g.__organizerTick) return;

  // Started by the desktop app: stop when the app goes away, even if it crashed and could not stop us.
  if (process.env.ORGANIZER_EXIT_WITH_PARENT === "1") {
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("error", () => process.exit(0));
    process.stdin.resume();
  }

  /** Runs `work` for the signed-in account; does nothing until someone finished signing in with 2FA. */
  const every = (ms: number, name: string, work: () => Promise<unknown>) => {
    let busy = false;
    return setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        if ((await authState())?.aal === "aal2") await work();
      } catch (e) {
        // Signed out halfway (e.g. from another device): the next round simply waits for a sign-in.
        if (!(e instanceof NotSignedIn)) console.error(`[organizer] ${name} failed`, e);
      } finally {
        busy = false;
      }
    }, ms);
  };
  // This computer in the account (registration, sign-out from elsewhere, requests to start sessions), and
  // flows reacting to tasks finished elsewhere.
  g.__organizerSync = every(5_000, "account sync", async () => {
    await syncDevice();
    await watchStatuses();
  });
  // Connections "at a set time" start their sessions.
  g.__organizerTick = every(60_000, "flow tick", tick);
}
