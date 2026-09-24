import { NextResponse, type NextRequest } from "next/server";

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Only answers requests addressed to this computer. The server listens on 127.0.0.1, but a web page
 * could still point its own domain at 127.0.0.1 (DNS rebinding) and read your data or start sessions.
 */
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL.has(host)) return new NextResponse("Organizer only answers on 127.0.0.1", { status: 403 });
  return NextResponse.next();
}
