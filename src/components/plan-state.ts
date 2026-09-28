"use client";

import { READ_ONLY_MESSAGE } from "@/lib/billing";

/*
 * Whether the account's PacedMind Cloud has ended (read-only), as /api/state last said (LiveRefresh). A production
 * build hides the message of an error a Server Action throws, so useAction shows this one instead while it's true.
 */

let readOnly = false;

export function publishPlan(plan: unknown) {
  readOnly = !!plan && typeof plan === "object" && (plan as { writable?: unknown }).writable === false;
}

/** The message for a failed action: the read-only one when that's why. */
export function failedMessage(fallback: string): string {
  return readOnly ? READ_ONLY_MESSAGE : fallback;
}
