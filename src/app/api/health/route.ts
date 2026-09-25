import crypto from "node:crypto";
import { uiKey } from "@/server/ui-key";

export const dynamic = "force-dynamic";

/**
 * Whether PacedMind's server is up; the desktop app asks while starting it. No data, so no key needed. With
 * `proof` (a random value the app made), the answer signs it with the window key, so the app can tell its
 * own server from any other program on the port before trusting it with its window.
 */
export function GET(request: Request) {
  const nonce = new URL(request.url).searchParams.get("proof");
  const proof = nonce && /^[0-9a-f]{32}$/.test(nonce) ? crypto.createHmac("sha256", uiKey()).update(nonce).digest("hex") : undefined;
  return Response.json({ app: "pacedmind", proof }, { headers: { "Cache-Control": "no-store" } });
}
