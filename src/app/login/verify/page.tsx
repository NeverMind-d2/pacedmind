import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authState } from "@/server/supabase";
import { nextStep, safeNext } from "@/server/auth-flow";
import { AuthShell } from "../shell";
import { VerifyForm } from "../forms";

export const metadata: Metadata = { title: "Two-factor code · PacedMind" };

export default async function VerifyPage(props: PageProps<"/login/verify">) {
  await connection();
  const state = await authState();
  const step = nextStep(state);
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? safeNext(sp.next) : null;
  if (step !== "/login/verify") redirect(step ?? next ?? "/today");
  const factors = state!.factors
    .filter((f) => f.factor_type === "totp")
    .map((f, i) => ({ id: f.id, name: f.friendly_name?.replace(/\s·.*$/, "") || `Authenticator ${i + 1}` }));
  return (
    <AuthShell note={<>Signed in as {state!.user.email}. Enter the code from your authenticator app.</>}>
      <VerifyForm factors={factors} backupCodes={state!.hasRecoveryCodes} next={next} />
    </AuthShell>
  );
}
