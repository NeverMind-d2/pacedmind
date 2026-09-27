import "server-only";
import { cookies, headers } from "next/headers";
import { MODE } from "./supabase";
import { UI_COOKIE, UI_HEADER, isUiKey } from "./ui-key";

/**
 * For Server Actions and routes that change what runs on this computer: only the desktop app's own window
 * (or its main process) may call them. proxy.ts already refuses everything else; checking again here keeps
 * a gap in the proxy's matcher from becoming a way in.
 */
export async function requireDesktopWindow() {
  if (MODE !== "desktop") return;
  const [jar, h] = await Promise.all([cookies(), headers()]);
  if (!isUiKey(jar.get(UI_COOKIE)?.value ?? h.get(UI_HEADER))) throw new Error("Only PacedMind's own window can do that.");
}
