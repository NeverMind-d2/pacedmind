import { test } from "node:test";
import assert from "node:assert/strict";
import { isNativeCompanion, nativeSignInLink } from "../src/lib/native-client";

test("native marker is a separate user-agent token", () => {
  assert.equal(isNativeCompanion("Mozilla/5.0 PacedMindNative/1.0"), true);
  assert.equal(isNativeCompanion("Mozilla/5.0 OtherPacedMindNative/1.0"), false);
  assert.equal(isNativeCompanion(null), false);
});

test("browser handoff carries only the authorization code and validated destination", () => {
  const link = new URL(nativeSignInLink(new URLSearchParams("code=pkce-code&via=google&access_token=secret&refresh_token=secret"), "/today"));
  assert.equal(link.protocol, "pacedmind:");
  assert.equal(link.host, "auth");
  assert.equal(link.pathname, "/callback");
  assert.deepEqual([...link.searchParams.keys()], ["code", "next", "via"]);
  assert.equal(link.searchParams.get("code"), "pkce-code");
  assert.equal(link.searchParams.has("native"), false);
});

test("malformed and expired codes produce bounded fixed errors", () => {
  for (const value of ["", "code=%3Cscript%3E", `code=${"a".repeat(2049)}`]) {
    const link = new URL(nativeSignInLink(new URLSearchParams(value), "/today"));
    assert.equal(link.searchParams.get("error"), "invalid");
    assert.equal(link.searchParams.has("code"), false);
  }
  assert.equal(new URL(nativeSignInLink(new URLSearchParams("error=access_denied"), "/today")).searchParams.get("error"), "cancelled");
  assert.equal(new URL(nativeSignInLink(new URLSearchParams("error_code=otp_expired"), "/today")).searchParams.get("error"), "expired");
});
