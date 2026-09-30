/** The web page has no native message bridge. A redirect cannot grant native capabilities. */
function validateOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PACEDMIND_MOBILE_ORIGIN must be an HTTPS origin without a path, credentials or query.");
  }
  return url.origin;
}

function navigationDecision(value, origin) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return "block";
    if (url.protocol !== "https:") return "block";
    return url.origin === origin ? "internal" : "external";
  } catch {
    return "block";
  }
}

/** Share only planner paths; never auth callbacks, query strings, tokens or account settings. */
function shareableUrl(value, origin) {
  if (navigationDecision(value, origin) !== "internal") return null;
  const url = new URL(value);
  if (!/^\/(today|inbox|upcoming|calendar|timeline|projects|roadmap|sessions|project|area)(\/|$)/.test(url.pathname)) return null;
  return `${origin}${url.pathname}`;
}

/** A PKCE authorization code only: the verifier and session cookies stay in this app's WebView. */
function nativeCallbackUrl(value, origin) {
  try {
    const url = new URL(value);
    if (url.protocol !== "pacedmind:" || url.hostname !== "auth" || url.pathname !== "/callback" || url.port || url.username || url.password || url.hash) return null;
    const allowed = new Set(["code", "next", "via", "error"]);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) return null;
    const errors = { cancelled: "Signing in was cancelled. Try again.", expired: "That sign-in link has expired. Start again from PacedMind.", invalid: "That sign-in link is incomplete. Try again." };
    const error = url.searchParams.get("error");
    if (error) return errors[error] && !url.searchParams.has("code") ? `${origin}/login?error=${encodeURIComponent(errors[error])}` : null;
    const code = url.searchParams.get("code");
    if (!code || !/^[A-Za-z0-9_-]{1,2048}$/.test(code)) return null;
    const target = new URL("/auth/callback", origin);
    target.searchParams.set("code", code);
    const next = url.searchParams.get("next");
    // The hosted callback checks its full destination allowlist again.
    if (next && (["/today", "/settings/account", "/settings/security", "/login/new-password"].includes(next)
      || /^\/oauth\/consent\?authorization_id=[A-Za-z0-9_-]{1,200}$/.test(next))) target.searchParams.set("next", next);
    if (url.searchParams.get("via") === "google") target.searchParams.set("via", "google");
    return target.href;
  } catch {
    return null;
  }
}

module.exports = { validateOrigin, navigationDecision, shareableUrl, nativeCallbackUrl };
