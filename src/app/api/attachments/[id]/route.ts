import fs from "node:fs";
import { attachmentPath } from "@/server/attachments";
import * as repo from "@/server/repo";

/** Shown instead of an image that stays on the computer the agent saved it on (and in the web app). */
const ELSEWHERE = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">` +
  `<rect width="480" height="270" rx="8" fill="#80808018"/>` +
  `<text x="240" y="130" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" fill="#808080">Saved on another computer</text>` +
  `<text x="240" y="156" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="#808080">Open PacedMind there to see it</text></svg>`;

/**
 * An image an agent attached, for the task panel and the Sessions screen. Only the app's own window may ask
 * (proxy.ts). The file stays on the computer the agent saved it on; elsewhere this answers with a placeholder.
 * Ids are random, so a URL never points at a different image later and the browser may keep it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = /^[0-9a-f]{16}$/.test(id) ? await repo.attachmentFile(id) : null;
  if (!found) return new Response("Not found", { status: 404 });
  let data: Buffer | null = null;
  if (found.here) {
    try {
      data = fs.readFileSync(attachmentPath(found.file));
    } catch {
      // Deleted by hand, or the data folder moved: say where it isn't.
    }
  }
  if (!data) {
    return new Response(ELSEWHERE, {
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": found.mime,
      "Content-Length": String(data.length),
      "Content-Disposition": `inline; filename="${found.file}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
