import "server-only";
import { usesCloud } from "./scope";
import { requirePlannerAccess } from "./supabase";
import { requireDesktopWindow } from "./window";

/**
 * The start of every Server Action that reads or changes data: only from the desktop app's own window
 * (proxy.ts checks it too), and with an account after its required sign-in steps. MFA is optional until
 * enrolled. Computer control checks its stronger policy separately. Without an account, data stays local.
 */
export async function guardAction() {
  await requireDesktopWindow();
  if (await usesCloud()) await requirePlannerAccess();
}
