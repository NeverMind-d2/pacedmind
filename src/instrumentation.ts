export async function register() {
  // Node-only code lives in its own module, so the Edge build never sees it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackground } = await import("./server/background");
    startBackground();
  }
}
