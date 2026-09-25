import "server-only";
import path from "node:path";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type Factor, type SupabaseClient, type User } from "@supabase/supabase-js";
import { dataDir, revokeAllSessionTokens } from "./device";
import { clearApprovals } from "./approval-store";
import { readSecureJson, removeFile, writeSecureJson } from "./secure-file";
import { COOKIE_OPTIONS, supabaseConfig } from "./supabase-config";

/*
 * PacedMind keeps its data in Supabase. The server talks to it as the signed-in account, with the public
 * publishable key and the account's own session, so row level security decides what it can see. There is
 * no database password or secret key anywhere in the app. The database also refuses every read and write
 * from a session that hasn't passed two-factor authentication (supabase/migrations).
 *
 * Two ways to run:
 * - "desktop" (the desktop app, and `npm run dev`): one account per server. Its session lives in an
 *   encrypted file next to the app's data, so everything the server does (the window, MCP calls from agents,
 *   session hooks, the background loop) acts as that account.
 * - "web" (the hosted app, ORGANIZER_MODE=web): every browser has its own session, in HttpOnly cookies. It
 *   never starts agents: sessions it asks for go to a desktop app as requests (launch_requests).
 */
export const MODE: "desktop" | "web" = process.env.ORGANIZER_MODE === "web" ? "web" : "desktop";

const AUTH_OPTIONS = { flowType: "pkce" as const, experimental: { recoveryCodes: true } };

/* ---------- desktop: one account, session in an encrypted file ---------- */

type Store = Record<string, string>;
const sessionFile = () => path.join(dataDir(), "session.json");

const fileStorage = {
  getItem: (key: string) => readSecureJson<Store>(sessionFile())?.[key] ?? null,
  setItem: (key: string, value: string) => writeSecureJson(sessionFile(), { ...(readSecureJson<Store>(sessionFile()) ?? {}), [key]: value }),
  removeItem: (key: string) => {
    const data = readSecureJson<Store>(sessionFile()) ?? {};
    delete data[key];
    if (Object.keys(data).length) writeSecureJson(sessionFile(), data);
    else removeFile(sessionFile());
  },
};

const g = globalThis as unknown as { __pacedmindDesktop?: SupabaseClient };

/** The desktop server's one client. It refreshes its own session, so nothing else may hold that session. */
function desktopClient(): SupabaseClient {
  if (!g.__pacedmindDesktop) {
    const { url, key } = supabaseConfig();
    g.__pacedmindDesktop = createClient(url, key, {
      auth: { ...AUTH_OPTIONS, storage: fileStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    // However the sign-in ends (signing out, a refresh the server refused), the agents lose PacedMind with it.
    g.__pacedmindDesktop.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        revokeAllSessionTokens();
        clearApprovals();
      }
    });
  }
  return g.__pacedmindDesktop;
}

/* ---------- web: every browser has its own session, in HttpOnly cookies ---------- */

const requestClient = cache(async (): Promise<SupabaseClient> => {
  const { url, key } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, key, {
    auth: AUTH_OPTIONS,
    cookieOptions: COOKIE_OPTIONS,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, { ...options, ...COOKIE_OPTIONS });
        } catch {
          // Called while rendering a Server Component, which can't set cookies. The proxy refreshes the session.
        }
      },
    },
  });
});

/** The Supabase client acting as the signed-in account (in the desktop app, the one account). */
export async function supabase(): Promise<SupabaseClient> {
  return MODE === "desktop" ? desktopClient() : requestClient();
}

/* ---------- who is signed in ---------- */

export type Aal = "aal1" | "aal2";

export interface AuthState {
  user: User;
  /** aal2 once a second factor was verified in this session. */
  aal: Aal;
  /** The auth session (the JWT's session_id), which a device registration points at. */
  sessionId: string | null;
  /** Verified authenticator apps (TOTP) and passkeys. */
  factors: Factor[];
  /** Whether backup codes exist for this account. */
  hasRecoveryCodes: boolean;
  /** How this session signed in and when (the JWT's amr claim, newest first). */
  amr: { method: string; timestamp: number }[];
}

/**
 * The signed-in account and how far it got, or null. The web app verifies the session's token (getClaims)
 * and asks Auth for the user (which also notices a revoked session); the desktop app's session is its own
 * encrypted file.
 */
export async function readAuthState(): Promise<AuthState | null> {
  const client = await supabase();
  let user: User | null = null;
  let claims: Record<string, unknown> | null = null;
  if (MODE === "desktop") {
    // getSession refreshes an expired token first.
    const { data } = await client.auth.getSession();
    user = data.session?.user ?? null;
    if (data.session) claims = decodeClaims(data.session.access_token);
  } else {
    const { data } = await client.auth.getClaims();
    if (data?.claims) {
      claims = data.claims as Record<string, unknown>;
      user = (await client.auth.getUser()).data.user ?? null;
    }
  }
  if (!user || !claims) return null;
  const all = user.factors ?? [];
  return {
    user,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    sessionId: typeof claims.session_id === "string" ? claims.session_id : null,
    factors: all.filter((f) => f.status === "verified" && (f.factor_type === "totp" || f.factor_type === "webauthn")),
    hasRecoveryCodes: all.some((f) => f.status === "verified" && (f.factor_type as string) === "recovery_code"),
    amr: Array.isArray(claims.amr) ? (claims.amr as { method: string; timestamp: number }[]) : [],
  };
}

/** readAuthState, once per request. After signing in or verifying a code, call readAuthState itself. */
export const authState = cache(readAuthState);

/** The payload of our own session's access token (desktop only: the token came from our own file). */
function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function currentUser(): Promise<User | null> {
  return (await authState())?.user ?? null;
}

export class NotSignedIn extends Error {
  constructor(message = "Sign in to PacedMind first.") {
    super(message);
  }
}

/** The signed-in account after two-factor authentication; throws NotSignedIn otherwise. */
export async function requireAal2(): Promise<AuthState> {
  const state = await authState();
  if (!state) throw new NotSignedIn();
  if (state.aal !== "aal2") throw new NotSignedIn("Finish signing in with your two-factor code first.");
  return state;
}
