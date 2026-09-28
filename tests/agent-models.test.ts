import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readAgentCatalog } from "../src/server/agent-models";
import { catalogFromAgent, checkedModelSelection, modelCatalogOf, modelFlags, modelSelectionProblem, type ModelSelection } from "../src/lib/agent-models";

const selected: ModelSelection = { agent: "codex", model: "account-only-model", effort: "high", speed: "priority" };
const catalog = catalogFromAgent("codex", { data: [
  { model: selected.model, displayName: "Account model", supportedReasoningEfforts: [{ reasoningEffort: "high" }], serviceTiers: [{ id: "priority", name: "Fast" }] },
  { model: "hidden-model", hidden: true },
] });

test("catalog uses reported account capabilities and omits hidden models", () => {
  assert.equal(catalog.available, true);
  assert.deepEqual(catalog.models, [{ id: selected.model, name: "Account model", efforts: ["high"], speeds: [{ id: "priority", name: "Fast" }] }]);
  assert.equal(modelSelectionProblem(selected, "codex", "terminal", catalog), null);
});

test("changing account, model capabilities, agent or surface cannot silently fall back", () => {
  assert.match(modelSelectionProblem(selected, "codex", "terminal", { ...catalog, models: [] })!, /no longer available/);
  assert.match(modelSelectionProblem(selected, "claude", "terminal", catalog)!, /another agent/);
  assert.match(modelSelectionProblem(selected, "codex", "desktop", catalog)!, /terminal/);
  assert.match(modelSelectionProblem(selected, "codex", "terminal")!, /Couldn't check/);
  assert.match(modelSelectionProblem({ ...selected, effort: "ultra" }, "codex", "terminal", catalog)!, /thinking/);
  assert.match(modelSelectionProblem({ ...selected, speed: "unknown" }, "codex", "terminal", catalog)!, /speed/);
  assert.equal(modelSelectionProblem(null, "claude", "cloud"), null);
});

test("older agents do not gain invented effort levels or speed entitlements", () => {
  const old = catalogFromAgent("claude", { models: [{ value: "custom-model", supportsEffort: true, supportsFastMode: true }] });
  assert.deepEqual(old.models[0].efforts, []);
  assert.deepEqual(old.models[0].speeds, []);
  const claude = (reason: unknown) => catalogFromAgent("claude", { fast_mode_state: "on", fast_mode_disabled_reason: reason, models: [
    { value: "custom-model", supportsEffort: true, supportedEffortLevels: ["low", "max"], supportsFastMode: true },
  ] });
  assert.deepEqual(claude(null).models[0].speeds.map((s) => s.id), ["standard", "fast"]);
  assert.deepEqual(claude(undefined).models[0].speeds.map((s) => s.id), ["standard", "fast"]);
  assert.deepEqual(claude("not entitled").models[0].speeds, []);
});

test("shell and TOML metacharacters are rejected even in a reported catalog", () => {
  for (const bad of ['x;echo', 'x"', 'x%PATH%', 'x$(whoami)', 'x`whoami`', "x\ny", "--help", "x=true", "x&y", "x y"]) {
    for (const key of ["model", "effort", "speed"]) assert.throws(() => modelFlags({ ...selected, [key]: bad }));
    assert.equal(catalogFromAgent("codex", { data: [{ model: bad }] }).models.length, 0);
  }
  assert.throws(() => checkedModelSelection({ agent: "codex", model: "valid", effort: {} }));
  assert.equal(modelCatalogOf({ models: [] }), undefined);
});

test("launch flags carry the explicit selection and leave default values alone", () => {
  assert.equal(modelFlags(null), "");
  assert.equal(modelFlags(selected), " -c model=account-only-model -c model_reasoning_effort=high -c service_tier=priority");
  assert.equal(modelFlags({ agent: "claude", model: "opus", effort: "max", speed: "fast" }), " --model opus --effort max");
  assert.equal(modelFlags({ ...selected, effort: null, speed: null }), " -c model=account-only-model");
});

test("metadata handshake handles pagination and startup noise, without exporting account identity", async () => {
  const command = `"${process.execPath}" "${fileURLToPath(new URL("./fixtures/model-agent.mjs", import.meta.url))}"`;
  const codex = await readAgentCatalog("codex", command);
  assert.deepEqual(codex.models.map((m) => m.id), ["first-account-model", "second-account-model"]);
  const claude = await readAgentCatalog("claude", command);
  assert.equal(claude.models[0].id, "account-opus");
  assert.deepEqual(claude.models[0].speeds.map((s) => s.id), ["standard", "fast"]);
  assert.ok(!JSON.stringify(claude).includes("do-not-export"));
  assert.equal((await readAgentCatalog("codex", null)).available, false);
});

test("SQLite creates, edits and clears model settings, including on a pre-existing database", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pacedmind-model-test-"));
  process.env.ORGANIZER_DB = path.join(dir, "organizer.db");
  process.env.ORGANIZER_SEED = "empty";
  const source = fs.readFileSync(new URL("../src/server/store/local-db.ts", import.meta.url), "utf8");
  const schema = source.match(/const SCHEMA = `([\s\S]*?)`;/)![1].replace(", model_settings TEXT", "");
  const old = new DatabaseSync(process.env.ORGANIZER_DB);
  old.exec(schema);
  old.prepare("INSERT INTO meta (key, value) VALUES ('seeded', 'test')").run();
  old.close();
  const local = await import("../src/server/store/local");
  const { db } = await import("../src/server/store/local-db");
  try {
    const task = await local.createTask({ title: "Model persistence", agent: "codex", modelSettings: selected });
    assert.deepEqual(task.modelSettings, selected);
    await local.updateTask(task.id, { modelSettings: { ...selected, effort: null } });
    assert.equal((await local.getTask(task.id))?.modelSettings?.effort, null);
    await local.updateTask(task.id, { modelSettings: null });
    assert.equal((await local.getTask(task.id))?.modelSettings, null);
    // The normal open migrated the pre-existing schema before the writes above.
    assert.ok(db().prepare("PRAGMA table_info(tasks)").all().some((c) => c.name === "model_settings"));
    await local.updateTask(task.id, { modelSettings: selected });
    assert.deepEqual((await local.getTask(task.id))?.modelSettings, selected);
  } finally {
    db().close();
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith("pacedmind-model-test-"));
    fs.rmSync(target, { recursive: true, force: true });
  }
});
