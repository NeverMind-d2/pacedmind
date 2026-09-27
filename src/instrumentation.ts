export async function register() {
  // Node-only code lives in its own module, so the Edge build never sees it.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackground } = await import("./server/background");
    startBackground();
    // `npm run dev` has no desktop window to hold the key (src/server/ui-key.ts): open this link once.
    const { startedByApp, uiKey } = await import("./server/ui-key");
    if (!startedByApp() && process.env.ORGANIZER_MODE !== "web") {
      console.log(`\n  PacedMind: open http://127.0.0.1:${process.env.PORT || 4320}/unlock?key=${uiKey()} once in your browser.\n`);
    }
  }
}
