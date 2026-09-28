import assert from "node:assert/strict";
import { mock, test } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attentionOf, attentionWords, checkedIn, toStamp } from "../src/lib/dates";
import { desktopStartText, runtimeEvent, sessionIssue, startupEvent } from "../src/lib/session-health";
import { codexObservation, readCodexRuntime } from "../src/server/codex-runtime";

const stamp = (seconds: number) => `2026-09-28T12:00:${String(seconds).padStart(2, "0")}`;
const event = (kind: string, seconds: number) => ({ kind, text: kind === "resumed" ? "Reopened in a terminal" : "", at: stamp(seconds) });
const cli = "11111111-1111-4111-a111-111111111111";

test("capacity, account limits and conversation locks stay distinct", () => {
  assert.equal(sessionIssue("server_overloaded", ""), "capacity");
  assert.equal(sessionIssue("overloaded_error", ""), "capacity");
  assert.equal(sessionIssue("overloaded", ""), "capacity");
  assert.equal(sessionIssue(null, "Selected model is at capacity. Please try a different model."), "capacity");
  assert.equal(sessionIssue("rate_limit", ""), "limit");
  assert.equal(sessionIssue("billing_error", ""), "limit");
  assert.equal(sessionIssue(null, "This conversation is open in another app"), "locked");
  assert.equal(sessionIssue("api_error", "secret/path/token"), "error");
});

test("startup reminder covers both agents, once per attempt, and a reopen resets check-in", () => {
  const start = [event("started", 0)];
  for (const agent of ["claude", "codex"] as const) {
    assert.equal(startupEvent(agent, stamp(0), start, Date.parse(stamp(0)) + 89_000), null);
    assert.equal(startupEvent(agent, stamp(0), start, Date.parse(stamp(0)) + 91_000)?.kind, "setup");
    assert.equal(startupEvent(agent, stamp(0), [...start, event("picked_up", 5)], Date.parse(stamp(0)) + 91_000), null);
    assert.equal(startupEvent(agent, stamp(0), [...start, event("capacity", 5)], Date.parse(stamp(0)) + 91_000), null);
    assert.equal(startupEvent(agent, stamp(0), [...start, event("setup", 5), event("working", 6)], Date.parse(stamp(0)) + 91_000), null);
  }
  assert.equal(checkedIn([...start, event("picked_up", 5), event("resumed", 10)]), false);
  assert.equal(checkedIn([...start, event("picked_up", 5), event("resumed", 10), event("picked_up", 15)]), true);
  assert.equal(checkedIn([...start, event("picked_up", 5), { ...event("resumed", 10), text: "Opened in the Codex app" }]), true);
  for (const agent of ["claude", "codex"] as const) assert.match(desktopStartText(agent), /press Enter or select Send/);
});

test("Codex reads structured terminal failures and recovery, never quoted error messages", () => {
  const record = (payload: object, seconds: number) => ({ type: "event_msg", timestamp: stamp(seconds), payload });
  const failure = record({ type: "task_complete", error: { message: "Selected model is at capacity.", codex_error_info: "server_overloaded" } }, 10);
  assert.equal(codexObservation([failure], cli)?.kind, "capacity");
  assert.equal(codexObservation([{ type: "response_item", timestamp: stamp(10), payload: { type: "message", role: "user", content: "Selected model is at capacity." } }], cli), null);
  assert.equal(codexObservation([failure, record({ type: "task_started" }, 20)], cli)?.kind, "working");
  assert.equal(codexObservation([failure, record({ type: "task_complete", error: null }, 25)], cli)?.kind, "waiting");
  assert.equal(codexObservation([record({ type: "task_complete", error: {}, thread_id: "other-thread" }, 25)], cli), null);
});

test("specific failures replace generic waits, but cannot override newer work or another launch", () => {
  const observation = { at: Date.parse(stamp(10)), kind: "capacity" as const };
  assert.equal(runtimeEvent("codex", stamp(0), [event("started", 0), event("waiting", 11)], observation)?.kind, "capacity");
  assert.equal(runtimeEvent("codex", stamp(0), [event("setup", 30)], observation)?.kind, "capacity");
  assert.equal(runtimeEvent("codex", stamp(0), [event("working", 20), event("setup", 30)], observation), null);
  for (const kind of ["resumed", "changes_requested", "working", "picked_up", "capacity"]) {
    assert.equal(runtimeEvent("codex", stamp(0), [event(kind, 20)], observation), null);
  }
  const resumed = runtimeEvent("codex", stamp(0), [event("capacity", 10)], { at: Date.parse(stamp(20)), kind: "working" });
  assert.equal(resumed?.kind, "working");
  assert.equal(attentionOf([event("capacity", 10), { kind: "connected" }])?.kind, "capacity");
  assert.equal(attentionOf([event("capacity", 10), { kind: "working" }]), null);
  assert.equal(attentionWords("send_prompt"), "Send the first message");
});

test("API, local store and monitor carry failures, setup notices and recovery end to end", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pacedmind-health-test-"));
  const oldHome = process.env.CODEX_HOME;
  process.env.ORGANIZER_DB = path.join(dir, "organizer.db");
  process.env.ORGANIZER_SEED = "empty";
  process.env.CODEX_HOME = path.join(dir, "codex");
  const repo = await import("../src/server/repo");
  const { db } = await import("../src/server/store/local-db");
  const { issueSessionToken, updateDevice } = await import("../src/server/device");
  const { checkSessionHealth } = await import("../src/server/session-health");
  const { POST } = await import("../src/app/api/sessions/[id]/signal/route");
  const { GET } = await import("../src/app/api/state/route");
  try {
    const startedAt = toStamp(new Date(Date.now() - 120_000));
    const task = await repo.createTask({ title: "Capacity fixture", agent: "codex" });
    const s = await repo.createSession({ taskId: task.id, agent: "codex", folder: null, startedAt });
    const records = path.join(process.env.CODEX_HOME, "sessions", "2026", "09", "28");
    fs.mkdirSync(records, { recursive: true });
    const file = path.join(records, `rollout-2026-09-28T12-00-00-${cli}.jsonl`);
    const at = new Date(Date.now() - 10_000).toISOString();
    const write = (rows: object[]) => fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const head = [
      { type: "session_meta", payload: { id: cli, source: "cli" } },
      { timestamp: at, type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: `PacedMind task ${task.key}, session ${s.id}. Call the pacedmind MCP tool start_task` }] } },
    ];
    write([...head, { type: "event_msg", timestamp: at, payload: { type: "task_complete", error: { codex_error_info: "server_overloaded", message: "do-not-export" } } }]);
    const target = { id: s.id, cliSessionId: null, since: Date.parse(startedAt) };
    assert.equal(readCodexRuntime([target]).get(s.id)?.cli, cli);
    await checkSessionHealth();
    assert.equal((await repo.getSession(s.id))?.cliSessionId, cli);
    assert.equal(attentionOf(await repo.sessionEvents(s.id))?.kind, "capacity");
    await checkSessionHealth();
    assert.equal((await repo.sessionEvents(s.id)).filter((e) => e.kind === "capacity").length, 1);
    let state = await (await GET()).json();
    assert.equal(state.attention.find((a: { id: string }) => a.id === s.id)?.kind, "capacity");
    assert.ok(!JSON.stringify(state).includes("do-not-export"));
    const { sessionList } = await import("../src/server/session-list");
    const list = await sessionList(null);
    assert.ok(list.groups.find((g) => g.id === "attention")?.items.some((item) => item.id === s.id));
    assert.ok(!list.groups.find((g) => g.id === "running")?.items.some((item) => item.id === s.id));

    const token = issueSessionToken(s.id, task.id);
    const signal = (id: string, token: string, kind: string, payload: object, query = "") => POST(new Request(`http://127.0.0.1/api/sessions/${id}/signal?kind=${kind}${query}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }), { params: Promise.resolve({ id }) });
    assert.equal((await signal(s.id, "invalid", "prompt", {})).status, 204);
    assert.equal(attentionOf(await repo.sessionEvents(s.id))?.kind, "capacity");
    assert.equal((await signal(s.id, token, "prompt", {})).status, 204);
    await checkSessionHealth();
    assert.equal(attentionOf(await repo.sessionEvents(s.id)), null);
    await checkSessionHealth();
    assert.equal(attentionOf(await repo.sessionEvents(s.id)), null);
    await repo.addSessionEvent(s.id, "picked_up", "Read the task");
    await repo.updateSession(s.id, { status: "running" });
    await checkSessionHealth();
    assert.equal(attentionOf(await repo.sessionEvents(s.id)), null);

    const ct = await repo.createTask({ title: "Claude setup fixture", agent: "claude" });
    const cs = await repo.createSession({ taskId: ct.id, agent: "claude", folder: null, startedAt, cliSessionId: cli });
    const ctok = issueSessionToken(cs.id, ct.id);
    await checkSessionHealth();
    assert.equal(attentionOf(await repo.sessionEvents(cs.id))?.kind, "setup");
    await signal(cs.id, ctok, "failure", { error_type: "overloaded_error", details: "do-not-export" }, `&cli=${cli}`);
    assert.equal(attentionOf(await repo.sessionEvents(cs.id))?.kind, "capacity");
    await signal(cs.id, ctok, "stop", {}, `&cli=${cli}`);
    assert.equal(attentionOf(await repo.sessionEvents(cs.id))?.kind, "capacity");
    await signal(cs.id, ctok, "tool", {}, `&cli=${cli}`);
    assert.equal(attentionOf(await repo.sessionEvents(cs.id)), null);
    await signal(cs.id, ctok, "failure", { error_type: "billing_error" }, "&cli=22222222-2222-4222-a222-222222222222");
    assert.equal(attentionOf(await repo.sessionEvents(cs.id)), null);
    await signal(cs.id, ctok, "failure", { error_type: "billing_error" }, `&cli=${cli}`);
    assert.equal(attentionOf(await repo.sessionEvents(cs.id))?.kind, "limit");
    await signal(cs.id, ctok, "failure", { error: "overloaded", error_details: "do-not-export", last_assistant_message: "API Error: overloaded" }, `&cli=${cli}`);
    assert.equal(attentionOf(await repo.sessionEvents(cs.id))?.kind, "capacity");
    await signal(cs.id, ctok, "failure", { error: "rate_limit", error_details: "do-not-export" }, `&cli=${cli}`);
    assert.equal(attentionOf(await repo.sessionEvents(cs.id))?.kind, "limit");

    for (const agent of ["claude", "codex"] as const) {
      const dt = await repo.createTask({ title: `${agent} app fixture`, agent });
      const ds = await repo.createSession({ taskId: dt.id, agent, folder: null, surface: "desktop" });
      await checkSessionHealth();
      assert.equal(attentionOf(await repo.sessionEvents(ds.id))?.kind, "send_prompt");
      await repo.addSessionEvent(ds.id, "picked_up", "Read the task");
      await repo.updateSession(ds.id, { status: "running" });
      await checkSessionHealth();
      assert.equal(attentionOf(await repo.sessionEvents(ds.id)), null);
    }
    state = await (await GET()).json();
    assert.ok(!JSON.stringify(state).includes("do-not-export"));
    await repo.updateSession(cs.id, { status: "closed" });
    await signal(cs.id, ctok, "failure", { error_type: "overloaded_error" });
    assert.equal((await repo.sessionEvents(cs.id)).filter((e) => e.kind === "capacity").length, 2);

    // Truncated writes, unrelated sources and duplicate kickoffs do not bind an unknown session.
    fs.appendFileSync(file, '{"type":"event_msg"');
    assert.equal(readCodexRuntime([{ ...target, cliSessionId: cli }]).get(s.id)?.observation?.kind, "capacity");
    const other = "22222222-2222-4222-a222-222222222222";
    fs.writeFileSync(path.join(records, `rollout-2026-09-28T12-00-01-${other}.jsonl`), [
      { type: "session_meta", payload: { id: other, source: "cli" } }, head[1],
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    assert.equal(readCodexRuntime([target]).get(s.id)?.cli, "");

    // Exercise the launcher without opening an app or spending model tokens.
    updateDevice({ trustFolders: false });
    const opened: string[][] = [];
    const originalExec = childProcess.execFileSync;
    const execMock = mock.method(childProcess, "execFileSync", ((file: string, args: string[], ...rest: unknown[]) => {
      if (file === "open") { opened.push([file, ...args]); return Buffer.alloc(0); }
      assert.equal(file, "git", "unexpected program during fixture launch");
      return Reflect.apply(originalExec, childProcess, [file, args, ...rest]);
    }) as typeof childProcess.execFileSync);
    const spawnMock = mock.method(childProcess, "spawn", ((file: string, args: string[]) => {
      assert.ok(["open", "xdg-open", "x-terminal-emulator", "wt.exe", "cmd.exe", "rundll32.exe"].includes(file));
      opened.push([file, ...args]);
      return Object.assign(new EventEmitter(), { unref() {} });
    }) as typeof childProcess.spawn);
    syncBuiltinESMExports();
    try {
      const { startSession, resumeSession } = await import("../src/server/launcher");
      for (const agent of ["claude", "codex"] as const) {
        const launchTask = await repo.createTask({ title: `${agent} terminal launch`, agent });
        const launch = await startSession(launchTask.id, { reason: "you", surface: "terminal" });
        assert.equal(launch.ok, true, launch.error ?? "terminal launch");
        assert.equal(launch.session?.status, "starting");
        if (agent === "codex") {
          const resume = await resumeSession(launch.session!.id, undefined, true);
          assert.equal(resume.ok, true, resume.error ?? "resume launch");
          const script = process.platform === "darwin" ? "start.command" : process.platform === "win32" ? "start.cmd" : "start.sh";
          const command = fs.readFileSync(path.join(dir, "sessions", launch.session!.id, script), "utf8");
          assert.ok(!command.includes("resume --last"));
          assert.ok(command.includes(`PacedMind task ${launchTask.key}, session ${launch.session!.id}`));
        }
        const appTask = await repo.createTask({ title: `${agent} desktop launch`, agent });
        const app = await startSession(appTask.id, { reason: "you", surface: "desktop" });
        assert.equal(app.ok, true, app.error ?? "app launch");
        assert.equal(app.session?.status, "starting");
        assert.equal(attentionOf(await repo.sessionEvents(app.session!.id))?.kind, "send_prompt");
      }
      assert.equal(opened.length, 5);
    } finally {
      execMock.mock.restore(); spawnMock.mock.restore(); syncBuiltinESMExports();
    }
  } finally {
    db().close();
    if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
