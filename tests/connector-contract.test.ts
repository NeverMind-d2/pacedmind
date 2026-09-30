import assert from "node:assert/strict";
import { test } from "node:test";
import { toolMetadata } from "../src/server/mcp/metadata";
import { GET as challenge } from "../src/app/.well-known/openai-apps-challenge/route";

test("domain proof is opt-in, exact plain text, and absent on a desktop server", async () => {
  const oldMode = process.env.ORGANIZER_MODE;
  const oldToken = process.env.ORGANIZER_OPENAI_APPS_CHALLENGE;
  try {
    process.env.ORGANIZER_MODE = "web";
    delete process.env.ORGANIZER_OPENAI_APPS_CHALLENGE;
    assert.equal(challenge().status, 404);
    process.env.ORGANIZER_OPENAI_APPS_CHALLENGE = "public-challenge-123";
    const response = challenge();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "public-challenge-123");
    process.env.ORGANIZER_OPENAI_APPS_CHALLENGE = "one\ntwo";
    assert.equal(challenge().status, 404);
    process.env.ORGANIZER_OPENAI_APPS_CHALLENGE = "public-challenge-123";
    process.env.ORGANIZER_MODE = "desktop";
    assert.equal(challenge().status, 404);
  } finally {
    if (oldMode === undefined) delete process.env.ORGANIZER_MODE;
    else process.env.ORGANIZER_MODE = oldMode;
    if (oldToken === undefined) delete process.env.ORGANIZER_OPENAI_APPS_CHALLENGE;
    else process.env.ORGANIZER_OPENAI_APPS_CHALLENGE = oldToken;
  }
});

test("the hosted wire tool list preserves OAuth and honest effect annotations", async () => {
  process.env.ORGANIZER_MODE = "web";
  const { createMcpHandler } = await import("mcp-handler");
  const { registerTools } = await import("../src/server/mcp");
  const { runAs } = await import("../src/server/mcp/principal");
  const handler = createMcpHandler(registerTools);
  const listRequest = () => new Request("https://app.pacedmind.test/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "tools/list" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} },
    } }),
  });
  const response = await runAs({ kind: "owner" }, () => handler(listRequest()));
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.equal(body.error, undefined);
  const tools = body.result.tools as Array<{
    name: string; annotations: ReturnType<typeof toolMetadata>["annotations"];
    _meta: { securitySchemes: unknown };
    securitySchemes: unknown;
    inputSchema: { type: string; properties: Record<string, unknown> };
  }>;
  assert.ok(tools.length >= 40);
  for (const tool of tools) {
    assert.ok(tool.annotations.title);
    assert.deepEqual(tool._meta.securitySchemes, [{ type: "oauth2", scopes: [] }]);
    assert.deepEqual(tool.securitySchemes, tool._meta.securitySchemes);
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(typeof tool.annotations.readOnlyHint, "boolean");
    assert.equal(typeof tool.annotations.destructiveHint, "boolean");
    assert.equal(typeof tool.annotations.openWorldHint, "boolean");
  }
  const named = (name: string) => tools.find((tool) => tool.name === name)!;
  assert.equal(named("get_overview").annotations.readOnlyHint, true);
  assert.equal(named("create_task").annotations.destructiveHint, false);
  for (const name of ["update_task", "update_preferences", "delete_task", "update_event"]) {
    assert.equal(named(name).annotations.destructiveHint, true, name);
    assert.equal(named(name).annotations.idempotentHint, false, name);
  }
  assert.equal(named("start_session").annotations.openWorldHint, true);
  assert.equal(named("set_folder").annotations.openWorldHint, true);
  assert.ok(named("create_task").inputSchema.properties.title);
  assert.equal(tools.some((tool) => tool.name === "attach_image" || tool.name === "ask_user"), false);
  assert.equal(toolMetadata("Read", "read", false)._meta, undefined, "desktop tokens must not advertise OAuth");
  const sessionResponse = await runAs({ kind: "session", sessionId: "test-session", taskId: 1 }, () => handler(listRequest()));
  const sessionTools = (await sessionResponse.json()).result.tools as typeof tools;
  assert.ok(sessionTools.some((tool) => tool.name === "update_task"));
  for (const name of ["delete_task", "start_session", "set_folder", "update_preferences", "create_project"]) {
    assert.equal(sessionTools.some((tool) => tool.name === name), false, `session must not advertise ${name}`);
  }
});
