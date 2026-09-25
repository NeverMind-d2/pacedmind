import "server-only";
import { usesCloud } from "./scope";
import { requireAal2 } from "./supabase";
import { requireDesktopWindow } from "./window";

/**
 * The start of every Server Action that reads or changes data: only from the desktop app's own window
 * (proxy.ts checks it too), and with an account only once it signed in with its second factor (the database
 * checks that too). Without an account, the desktop app works with this computer's own data.
 */
export async function guardAction() {
  await requireDesktopWindow();
  if (await usesCloud()) await requireAal2();
}
