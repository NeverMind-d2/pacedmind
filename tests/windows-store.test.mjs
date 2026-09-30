import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stageWindowsStoreInstaller, windowsExecutables, windowsSigningConfig } from "../scripts/windows-store.mjs";

test("store builds reject missing and malformed signing identities", () => {
  assert.throws(() => windowsSigningConfig({}));
  assert.throws(() => windowsSigningConfig({ PACEDMIND_WINDOWS_CERT_SHA1: "invalid" }));
  assert.equal(windowsSigningConfig({ PACEDMIND_WINDOWS_CERT_SHA1: "a".repeat(40) }).certificate.length, 40);
});

test("collects nested Windows executables and makes content-addressed submission artifacts", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pacedmind-store-test-"));
  try {
    fs.mkdirSync(path.join(folder, "resources"));
    fs.writeFileSync(path.join(folder, "resources", "notes.txt"), "not an executable");
    const installer = path.join(folder, "PacedMind.exe");
    fs.writeFileSync(installer, "fixture, not a signed PE");
    assert.deepEqual(windowsExecutables(folder), [installer]);
    const first = stageWindowsStoreInstaller(installer, "0.1.0");
    const manifest = JSON.parse(fs.readFileSync(`${first}.json`, "utf8"));
    assert.equal(manifest.appId, "Organizer.Desktop");
    assert.equal(manifest.silentInstall, "/S");
    assert.equal(manifest.installerUrl, null);
    fs.writeFileSync(installer, "second fixture");
    const second = stageWindowsStoreInstaller(installer, "0.1.0");
    assert.notEqual(first, second);
    assert.equal(fs.readFileSync(first, "utf8"), "fixture, not a signed PE");
    assert.throws(() => stageWindowsStoreInstaller(installer, "../escape"));
  } finally {
    // This exact mkdtemp child of the OS temp directory belongs to this test.
    const resolved = path.resolve(folder);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("pacedmind-store-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
