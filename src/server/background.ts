import "server-only";
import { tick } from "./flow";

/** Background work of the Node.js server, started once from src/instrumentation.ts. */
export function startBackground() {
  const g = globalThis as unknown as { __organizerTick?: NodeJS.Timeout };
  if (g.__organizerTick) return;

  // Started by the desktop app: stop when the app goes away, even if it crashed and could not stop us.
  if (process.env.ORGANIZER_EXIT_WITH_PARENT === "1") {
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("error", () => process.exit(0));
    process.stdin.resume();
  }

  g.__organizerTick = setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.error("[organizer] flow tick failed", e);
    }
  }, 60_000);
}
