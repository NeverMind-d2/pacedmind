/*
 * Which Supabase project PacedMind talks to, and how the web app keeps its session cookies. Shared by
 * supabase.ts and proxy.ts, so no "server-only" here; nothing in it is secret.
 */

/**
 * PacedMind's own Supabase project, used unless the environment names another (local development can point
 * at `supabase start`). Both values are public: the publishable key only lets a client talk to the project,
 * and row level security with two-factor sessions decides what anyone can see.
 */
const PACEDMIND_CLOUD = {
  url: "https://pyoynjoyhpolijlvoalu.supabase.co",
  key: "sb_publishable_mV8L9iYZVhdph7SkGIzVHg_2o0osYJr",
};

export function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || PACEDMIND_CLOUD.url,
    key: process.env.SUPABASE_PUBLISHABLE_KEY || PACEDMIND_CLOUD.key,
  };
}

/** The web app's session cookies: HttpOnly, so no script in a page can read the session. */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
