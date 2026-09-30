import "server-only";
import { deviceConfig, deviceFor, type DeviceConfig } from "./device";
import { MODE, NotSignedIn, authState } from "./supabase";
import { canUsePlanner } from "@/lib/auth-access";

/*
 * Whose data this server works with. Signed in to PacedMind Cloud, the account's, in Supabase (the hosted
 * web app always). Otherwise the desktop app works with this computer's own data, the free One device
 * plan, in a SQLite file next to its settings. Signing in switches over; signing out switches back.
 */

/** Whether the account's data is in use: someone is signed in (maybe still entering their code), or this is the web app. */
export async function usesCloud(): Promise<boolean> {
  return MODE === "web" || (await authState()) !== null;
}

/**
 * This computer's settings for the data in use, for starting sessions and answering agents: the signed-in
 * account's after its required sign-in steps, or this computer's own without an account.
 */
export async function activeDevice(): Promise<DeviceConfig> {
  const state = await authState();
  if (!state) {
    if (MODE === "web") throw new NotSignedIn();
    return deviceConfig();
  }
  if (!state.clientId && !canUsePlanner(state)) throw new NotSignedIn("Finish signing in with your two-factor code first.");
  return deviceFor(state.user.id);
}
