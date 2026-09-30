/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { nativeCallbackUrl, validateOrigin, navigationDecision, shareableUrl } = require("../navigation.cjs");
const origin = "https://app.pacedmind.com";

test("builds accept only a credential-free HTTPS origin", () => {
  assert.equal(validateOrigin(`${origin}/`), origin);
  for (const value of ["http://app.pacedmind.com", "https://me:secret@app.pacedmind.com", `${origin}/login`, `${origin}?token=secret`]) {
    assert.throws(() => validateOrigin(value));
  }
});

test("navigation cannot escape into native schemes or another origin's WebView", () => {
  assert.equal(navigationDecision(`${origin}/today`, origin), "internal");
  for (const value of ["https://app.pacedmind.com.evil.example/today", "https://elsewhere.example", "https://app.pacedmind.com:444/today"]) {
    assert.equal(navigationDecision(value, origin), "external");
  }
  for (const value of ["javascript:alert(1)", "file:///secret", "intent://anything", "data:text/html,hi", "http://app.pacedmind.com", "https://app.pacedmind.com@evil.example", "//evil.example"]) {
    assert.equal(navigationDecision(value, origin), "block");
  }
});

test("sharing never exports authentication URLs, queries or fragments", () => {
  assert.equal(shareableUrl(`${origin}/today?task=P-1#token`, origin), `${origin}/today`);
  for (const value of [`${origin}/auth/callback?code=secret`, `${origin}/login`, `${origin}/settings/security`, "https://evil.example/today", `${origin}/today-elsewhere`]) {
    assert.equal(shareableUrl(value, origin), null);
  }
});

test("native sign-in returns only a PKCE code to the configured origin", () => {
  const result = new URL(nativeCallbackUrl("pacedmind://auth/callback?code=one-time-code&next=%2Flogin%2Fnew-password&via=google", origin));
  assert.equal(result.origin, origin);
  assert.equal(result.pathname, "/auth/callback");
  assert.equal(result.searchParams.get("code"), "one-time-code");
  assert.equal(result.searchParams.get("next"), "/login/new-password");
  assert.equal(result.searchParams.has("native"), false);
  assert.equal(result.searchParams.get("via"), "google");
  assert.ok(nativeCallbackUrl("pacedmind://auth/callback?error=cancelled", origin).startsWith(`${origin}/login?error=`));
  assert.equal(new URL(nativeCallbackUrl("pacedmind://auth/callback?code=valid&next=https://evil.example", origin)).searchParams.has("next"), false);
  for (const value of [
    "pacedmind://evil/callback?code=valid", "pacedmind://auth/elsewhere?code=valid", "pacedmind://auth:99/callback?code=valid",
    "pacedmind://attacker@auth/callback?code=valid", "pacedmind://auth/callback?code=a&code=b",
    "pacedmind://auth/callback?access_token=secret", "pacedmind://auth/callback?code=valid&refresh_token=secret",
    "pacedmind://auth/callback?code=valid&native=1", "pacedmind://auth/callback?code=valid#token", "pacedmind://auth/callback?error=madeup",
  ]) assert.equal(nativeCallbackUrl(value, origin), null);
});
