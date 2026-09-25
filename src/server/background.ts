import "server-only";
import { checkCodexCloud } from "./cloud";
import { checkThisDevice } from "./devices";
import { tick } from "./flow";
import { launchQueued, mcpUrl } from "./launcher";

const CHECK_EVERY = 30 * 60_000;

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

  // Which agents this computer has; again now and then, since tools get installed and updated.
  const check = () => checkThisDevice(mcpUrl()).catch((e) => console.error("[organizer] device check failed", e));
  setTimeout(check, 3_000);
  setInterval(check, CHECK_EVERY);

  g.__organizerTick = setInterval(() => {
    try {
      tick();
      launchQueued();
    } catch (e) {
      console.error("[organizer] flow tick failed", e);
    }
    // Codex cloud tasks don't report back; asking Codex tells which are ready.
    checkCodexCloud().catch((e) => console.error("[organizer] Codex cloud check failed", e));
  }, 60_000);
}
