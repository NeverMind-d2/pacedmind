import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MODE, authState } from "@/server/supabase";
import { nextStep, safeNext, withNext } from "@/server/auth-flow";
import { AuthShell } from "../shell";
import { SetupForm } from "../forms";

export const metadata: Metadata = { title: "Two-factor sign-in · PacedMind" };

/** The first authenticator (required before anything else), or another one (?add=1, after signing in). */
export default async function SetupPage(props: PageProps<"/login/setup">) {
  await connection();
  const state = await authState();
  const step = nextStep(state);
  const sp = await props.searchParams;
  const adding = sp.add === "1";
  // The hosted app: where sign-in continues once the authenticator is set up (approving an agent's sign-in).
  const next = MODE === "web" && typeof sp.next === "string" && safeNext(sp.next) !== "/today" ? safeNext(sp.next) : null;
  if (!state) redirect(withNext("/login", next));
  if (step === "/login/verify") redirect(withNext("/login/verify", next));
  if (step === null && !adding) redirect(next ?? "/today");
  const first = step === "/login/setup";
  return (
    <AuthShell note={first
      ? <>Signed in as {state.user.email}. One more step: PacedMind asks for a code from an authenticator app at every sign-in.</>
      : "A second authenticator keeps you in if you lose the first one."}>
      <SetupForm key={first ? "first" : "another"} first={first} email={state.user.email ?? ""} next={next} />
    </AuthShell>
  );
}
