import zlib from "node:zlib";
import { authorizeHook } from "@/server/auth";
import { recordUsage } from "@/server/usage-metrics";

const SESSION_ID = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Claude Code's exports are a few kilobytes; Codex's carry all its metrics, some hundreds. A longer one is left unread. */
const MAX_BODY = 2 * 1024 * 1024;

/**
 * An agent's usage metrics for a session (OTLP over HTTP, as JSON; usage-metrics.ts), sent every half minute and when
 * it exits by the Claude Code or Codex the session runs, with that session's token (launcher.ts). `?cli=`: the Claude
 * Code conversation whose settings file named this route. It always answers as a collector that took the export (an empty
 * ExportMetricsServiceResponse), whatever happens: an error would only make the agent send it again, and a token that
 * doesn't work (any more) learns nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const taken = () => Response.json({});
  const { id } = await ctx.params;
  const cli = new URL(req.url).searchParams.get("cli");
  if (!SESSION_ID.test(id) || (cli && !UUID.test(cli))) return new Response(null, { status: 400 });
  const who = await authorizeHook(req);
  if (!who || who.kind !== "session") return taken();
  // Only JSON is read (the launcher asks for http/json); protobuf goes unread.
  if (!/json/i.test(req.headers.get("content-type") ?? "")) return taken();
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return taken();
  try {
    let bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > MAX_BODY) return taken();
    if (/gzip/i.test(req.headers.get("content-encoding") ?? "")) bytes = zlib.gunzipSync(bytes, { maxOutputLength: MAX_BODY });
    await recordUsage(who.sessionId, cli, JSON.parse(bytes.toString("utf8")));
  } catch (e) {
    if (!(e instanceof SyntaxError) && !(e instanceof RangeError)) console.error("[organizer] session usage", e);
  }
  return taken();
}
