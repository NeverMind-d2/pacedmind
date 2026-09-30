/** Presentation hint from our iOS/Android WebView. Never use a user agent to authorize an action. */
export function isNativeCompanion(userAgent: string | null | undefined): boolean {
  return /(?:^|\s)PacedMindNative\/\d+(?:\.\d+)*(?:\s|$)/.test(userAgent ?? "");
}

/** Authorization codes are short-lived and PKCE-bound, not session/access/refresh tokens. */
export function nativeSignInLink(params: URLSearchParams, next: string): string {
  const target = new URL("pacedmind://auth/callback");
  const code = params.get("code");
  if (code && /^[A-Za-z0-9_-]{1,2048}$/.test(code)) {
    target.searchParams.set("code", code);
    target.searchParams.set("next", next);
    if (params.get("via") === "google") target.searchParams.set("via", "google");
  } else {
    target.searchParams.set("error", params.get("error") === "access_denied" ? "cancelled"
      : params.get("error_code") === "otp_expired" ? "expired" : "invalid");
  }
  return target.href;
}
