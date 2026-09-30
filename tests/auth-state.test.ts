import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { canUsePlanner } from "../src/lib/auth-access";
import { computerAccessProblem } from "../src/server/computer-access";
import { activeDevice, usesCloud } from "../src/server/scope";
import { MODE, NotSignedIn, readAuthState } from "../src/server/supabase";

const actor = "11111111-1111-4111-8111-111111111111";
const token = `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: "session", aal: "aal1" })).toString("base64url")}.signature`;
const stored = { access_token: token, user: { id: actor, factors: [] } };
const liveUser = { id: actor, factors: [] } as unknown as User;
const globalClient = globalThis as unknown as { __pacedmindDesktop?: SupabaseClient };

async function usingClient(
  setup: { session?: typeof stored | null; sessionError?: Error; user?: User | null; userError?: Error },
  check: () => Promise<void>,
) {
  assert.equal(MODE, "desktop", "These regression tests exercise the desktop's Cloud/local store boundary.");
  const previous = globalClient.__pacedmindDesktop;
  globalClient.__pacedmindDesktop = {
    auth: {
      getSession: async () => ({ data: { session: setup.session === undefined ? stored : setup.session }, error: setup.sessionError ?? null }),
      getUser: async (jwt: string) => {
        assert.equal(jwt, setup.session?.access_token ?? token, "Get the live user for the same token whose claims are being read.");
        return { data: { user: setup.user === undefined ? liveUser : setup.user }, error: setup.userError ?? null };
      },
    },
  } as unknown as SupabaseClient;
  try {
    await check();
  } finally {
    globalClient.__pacedmindDesktop = previous;
  }
}

test("a genuine absent desktop session retains the no-account mode", async () => {
  await usingClient({ session: null }, async () => {
    assert.equal(await readAuthState(), null);
    assert.equal(await usesCloud(), false);
    assert.equal(await computerAccessProblem(), null);
  });
});

test("refresh and live-user failures cannot switch a Cloud account into local computer access", async () => {
  for (const setup of [
    { session: null, sessionError: new Error("temporary refresh failure") },
    { user: null, userError: new Error("Auth unavailable") },
    { user: null, userError: new Error("revoked session") },
    { user: null },
  ]) {
    await usingClient(setup, async () => {
      for (const operation of [readAuthState, usesCloud, activeDevice, computerAccessProblem]) {
        await assert.rejects(operation, NotSignedIn);
      }
    });
  }
});

test("the live factor list closes access after enrollment on another device", async () => {
  const verified = { id: "factor", factor_type: "totp", status: "verified" };
  await usingClient({ user: { ...liveUser, factors: [verified] } as User }, async () => {
    const state = await readAuthState();
    assert.equal(state?.user.id, actor);
    assert.equal(state?.mfaEnabled, true);
    assert.equal(state?.factors.length, 1);
    assert.equal(canUsePlanner(state), false);
  });
});

test("unreadable claims and a user/token identity mismatch fail closed", async () => {
  for (const access_token of ["invalid", `header.${Buffer.from(JSON.stringify({ sub: actor })).toString("base64url")}.signature`]) {
    await usingClient({ session: { ...stored, access_token } }, async () => {
      await assert.rejects(readAuthState, NotSignedIn);
    });
  }
  await usingClient({ user: { ...liveUser, id: "another-account" } }, async () => {
    await assert.rejects(readAuthState, NotSignedIn);
  });
});
