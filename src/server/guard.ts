import "server-only";
import { requireAal2 } from "./supabase";
import { requireDesktopWindow } from "./window";

/**
 * The start of every Server Action that reads or changes the account: only from the desktop app's own
 * window (proxy.ts checks it too) and only for an account signed in with its second factor (the database
 * checks that too).
 */
export async function guardAction() {
  await requireDesktopWindow();
  await requireAal2();
}
