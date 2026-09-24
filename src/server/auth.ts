import "server-only";
import crypto from "node:crypto";
import { getSettings } from "./repo";

/** Checks the "Authorization: Bearer <token>" header against the local MCP token. */
export function authorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expected = getSettings().mcpToken;
  if (!given || !expected || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
