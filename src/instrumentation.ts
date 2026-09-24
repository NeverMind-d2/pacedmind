export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as unknown as { __organizerTick?: NodeJS.Timeout };
  if (g.__organizerTick) return;
  const { tick } = await import("./server/flow");
  g.__organizerTick = setInterval(() => {
    try {
      tick();
    } catch (e) {
      console.error("[organizer] flow tick failed", e);
    }
  }, 60_000);
}
