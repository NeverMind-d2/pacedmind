/** The same opt-in MFA rule enforced by private.planner_session_ok() in the database. */
export type SignInAccess = { aal: "aal1" | "aal2"; mfaEnabled: boolean; clientId: string | null };

export function canUsePlanner(state: SignInAccess | null): boolean {
  return !!state && !state.clientId && (state.aal === "aal2" || !state.mfaEnabled);
}

export const COMPUTER_MFA_REQUIRED = "Set up two-factor sign-in in Settings → Security to start sessions or control computers. Your planner and MCP connections are available without it.";
