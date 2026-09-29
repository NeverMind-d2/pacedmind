import fs from "node:fs";
import path from "node:path";
import * as repo from "@/server/repo";
import { authorizeHook } from "@/server/auth";
import { dataDir, revokeSessionTokens } from "@/server/device";
import { forgetSessionFiles } from "@/server/launcher";
import { nowStamp } from "@/lib/dates";

/**
 * Called by the SessionEnd hook when the agent's terminal session closes, with that session's token. The
 * sessions of that terminal are closed and their tokens stop working. The answer has no body: Claude Code reads an
 * http hook's answer as instructions for itself.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const done = (status = 204) => new Response(null, { status });
  const who = await authorizeHook(req);
  if (!who) return done(401);
  const { id } = await ctx.params;
  const first = await repo.getSession(id);
  if (!first) return done(404);
  // The hook names the Claude Code conversation it belongs to. After a request for changes the session goes on in
  // a new branch of the conversation, and a terminal still open on the old one says nothing about it when it closes.
  const cli = new URL(req.url).searchParams.get("cli");
  if (cli && first.cliSessionId && cli !== first.cliSessionId) return done();
  // A hook without a conversation comes from a terminal opened before conversations had their own settings files.
  // When the current conversation has one, the session was reopened since, and that old terminal isn't it.
  if (!cli && first.cliSessionId) {
    const own = path.join(/* turbopackIgnore: true */ dataDir(), "sessions", first.id, `settings-${first.cliSessionId}.json`);
    if (fs.existsSync(own)) return done();
  }

  if (who.kind === "session" && who.sessionId !== first.id) return done(401);

  if (first.status === "starting" || first.status === "running") {
    await repo.updateSession(first.id, { status: "closed", endedAt: nowStamp() });
    await repo.addSessionEvent(first.id, "closed", "Terminal closed before the agent finished");
  } else if (!first.endedAt) {
    await repo.updateSession(first.id, { endedAt: nowStamp() });
    await repo.addSessionEvent(first.id, "closed", "Terminal closed");
  }
  revokeSessionTokens([first.id]);
  forgetSessionFiles([first.id]);
  return done();
}
