import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authState } from "@/server/supabase";
import { nextStep } from "@/server/auth-flow";
import { AuthShell } from "../shell";
import { SetupForm } from "../forms";

export const metadata: Metadata = { title: "Two-factor sign-in · PacedMind" };

/** The first authenticator (required before anything else), or another one (?add=1, after signing in). */
export default async function SetupPage(props: PageProps<"/login/setup">) {
  await connection();
  const state = await authState();
  const step = nextStep(state);
  const adding = (await props.searchParams).add === "1";
  if (!state) redirect("/login");
  if (step === "/login/verify") redirect("/login/verify");
  if (step === null && !adding) redirect("/today");
  const first = step === "/login/setup";
  return (
    <AuthShell note={first
      ? <>Signed in as {state.user.email}. One more step: PacedMind asks for a code from an authenticator app at every sign-in.</>
      : "A second authenticator keeps you in if you lose the first one."}>
      <SetupForm key={first ? "first" : "another"} first={first} email={state.user.email ?? ""} />
    </AuthShell>
  );
}
