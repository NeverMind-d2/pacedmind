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

/**
 * The hosted app, where agents reach PacedMind Cloud's MCP server: in the hosted app itself its own address, else
 * PacedMind Cloud's. ORGANIZER_CLOUD_ORIGIN points a desktop app at another one (a local stack's web app).
 */
export function cloudOrigin(): string {
  return (process.env.ORGANIZER_PUBLIC_ORIGIN || process.env.ORGANIZER_CLOUD_ORIGIN || "https://app.pacedmind.com").replace(/\/+$/, "");
}

/** PacedMind Cloud's MCP server, for agents signed in to an account (OAuth). */
export const cloudMcpUrl = () => `${cloudOrigin()}/api/mcp`;

/** The web app's session cookies: HttpOnly, so no script in a page can read the session. */
export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
