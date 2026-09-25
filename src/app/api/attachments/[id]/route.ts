import fs from "node:fs";
import { attachmentPath } from "@/server/attachments";
import * as repo from "@/server/repo";

/**
 * An image an agent attached, for the task panel and the Sessions screen. Like the pages, it needs no token:
 * the server only listens on 127.0.0.1 and proxy.ts turns away other hosts. Ids are random, so a URL never
 * points at a different image later and the browser may keep it.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const found = /^[0-9a-f]{16}$/.test(id) ? repo.attachmentFile(id) : null;
  if (!found) return new Response("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = fs.readFileSync(attachmentPath(found.file));
  } catch {
    return new Response("Not found", { status: 404 });
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
