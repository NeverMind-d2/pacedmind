import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerHooks } from "node:module";

// Run the actual server helpers with Node's TypeScript support, in an isolated data folder.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  let url;
  if (specifier.startsWith("@/")) url = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url);
  else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !path.extname(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (fs.existsSync(candidate)) url = candidate;
  }
  return next(url?.href ?? specifier, context);
} });

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pacedmind-workspace-test-"));
process.env.ORGANIZER_DB = path.join(temp, "data", "organizer.db");
delete process.env.ORGANIZER_DATA_KEY;
const device = await import("../src/server/device.ts");
const { plannedFolder, resolveFolder } = await import("../src/server/task-folder.ts");
const folder = (name) => { const f = path.join(temp, name); fs.mkdirSync(f); return f; };
const area = folder("area"), project = folder("project"), own = folder("task"), nextArea = folder("next-area");
const task = { key: "DEV-1", areaId: "dev", projectId: "app", folder: null };

try {
  assert.equal(device.setAreaFolder("dev", area), null);
  assert.equal(plannedFolder(task), area);
  assert.equal(resolveFolder(task).folder, area);
  assert.equal(plannedFolder({ ...task, key: "DEV-2", projectId: null }), area, "area tasks share one workspace");
  assert.equal(fs.existsSync(path.join(temp, "data", "workspaces")), false, "no per-task scratch projects created");
  assert.equal(device.setProjectFolder("app", project), null);
  assert.equal(plannedFolder(task), project);
  assert.equal(plannedFolder({ ...task, folder: own }), own);
  assert.equal(device.setProjectFolder("app", null), null);
  assert.equal(plannedFolder(task), area, "clearing the project restores area inheritance");

  device.setFlowArmed("app", true, { edges: ["1>2:auto"], after: null, areaId: "dev" });
  device.setFlowArmed("unrelated", true);
  assert.equal(device.setAreaFolder("dev", area, ["app"]), null);
  assert.equal(device.flowArmed("app"), true, "saving an unchanged workspace keeps the flow");
  assert.ok(device.setAreaFolder("dev", path.join(temp, "missing"), ["app"]));
  assert.equal(device.flowArmed("app"), true, "invalid folder does not change state");
  assert.equal(device.setAreaFolder("dev", nextArea, ["app"]), null);
  assert.equal(device.flowArmed("app"), false, "a workspace change pauses the affected flow");
  assert.equal(device.confirmedFlow("app"), null);
  assert.equal(device.flowArmed("unrelated"), true);
  assert.equal(plannedFolder(task), nextArea);

  globalThis.__pacedmindDevice = undefined;
  assert.equal(device.areaFolder("dev"), nextArea, "workspace persists across reloads");
  const remoteArea = "86be959f-595a-45ea-95e6-36f44691f3c7";
  device.setAreaFolder(remoteArea, own);
  device.forgetAll("local", ["app"], ["dev"]);
  assert.equal(device.areaFolder("dev"), null);
  assert.equal(device.areaFolder(remoteArea), own, "local reset preserves Cloud workspace mappings");
  device.forgetArea(remoteArea);
  assert.equal(device.areaFolder(remoteArea), null);

  const scratch = path.join(temp, "data", "workspaces", "dev-1");
  assert.equal(resolveFolder(task).folder, scratch);
  assert.equal(fs.statSync(scratch).isDirectory(), true);
  assert.equal(plannedFolder({ ...task, key: "../../escape" }), null);
  assert.ok(resolveFolder({ ...task, key: "../../escape" }).error);
  device.setAreaFolder("dev", area);
  fs.rmdirSync(area);
  assert.ok(resolveFolder(task).error, "a removed configured folder fails, without silently changing workspaces");
  assert.ok(resolveFolder({ ...task, folder: path.join(temp, "missing-own") }).error, "invalid explicit folder never falls back");
  device.deviceFor("account-one");
  device.deviceFor("account-two");
  assert.equal(device.areaFolder("dev"), null, "workspace mappings do not leak across accounts");
  console.log("Workspace checks passed: inheritance, shared folders, validation, flows, persistence, reset and account isolation.");
} finally {
  const resolved = path.resolve(temp);
  const base = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== base || !path.basename(resolved).startsWith("pacedmind-workspace-test-")) throw Error("Unexpected test cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
}
