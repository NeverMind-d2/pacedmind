import * as repo from "@/server/repo";
import { pictureHash } from "@/server/store/shared";

/**
 * An area's own picture (area-picture.ts), for its mark wherever the area shows. Only the app's own window may ask
 * (proxy.ts), and the store answers for the data in use, so an area of another account is never found. The mark asks
 * with `?v=` and the picture's hash (Area.picture), so the browser may keep what that address gives.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Signed out, or without the second factor, there is nothing to show.
  const picture = /^[A-Za-z0-9-]{1,100}$/.test(id) ? await repo.areaPicture(id).catch(() => null) : null;
  if (!picture) return new Response("Not found", { status: 404 });
  const data = Buffer.from(picture, "base64");
  const current = new URL(req.url).searchParams.get("v") === pictureHash(picture);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(data.length),
      "Cache-Control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
