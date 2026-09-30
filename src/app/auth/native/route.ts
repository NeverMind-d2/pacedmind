import { NextResponse, type NextRequest } from "next/server";
import { nativeSignInLink } from "@/lib/native-client";
import { safeNext } from "@/server/auth-flow";
import { MODE } from "@/server/supabase";

/** Explicit user gesture opens the native app. No token exchange, scripts, analytics or external assets here. */
export function GET(request: NextRequest) {
  if (MODE !== "web") return new NextResponse(null, { status: 404 });
  const params = request.nextUrl.searchParams;
  const link = nativeSignInLink(params, safeNext(params.get("next")));
  const escaped = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new NextResponse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Return to PacedMind</title></head>
<body style="font:16px system-ui,sans-serif;background:#111;color:#eee;margin:0;min-height:100vh;display:grid;place-items:center">
<main style="max-width:420px;padding:24px;text-align:center"><h1>Return to PacedMind</h1>
<p style="line-height:1.6">Continue in the PacedMind app where you started signing in.</p>
<a href="${escaped}" rel="noreferrer" style="display:inline-block;margin:16px;padding:14px 24px;border-radius:8px;background:#eee;color:#111;text-decoration:none">Open PacedMind</a>
<p style="font-size:14px;color:#aaa;line-height:1.6">If the app does not open, return to it and start signing in again. This link can only finish the sign-in that the app started.</p></main></body></html>`, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  } });
}
