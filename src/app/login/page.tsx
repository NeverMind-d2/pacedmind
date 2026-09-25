import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MODE, authState } from "@/server/supabase";
import { nextStep } from "@/server/auth-flow";
import { AuthShell } from "./shell";
import { LoginForm } from "./forms";

export const metadata: Metadata = { title: "Sign in · PacedMind" };

export default async function LoginPage(props: PageProps<"/login">) {
  await connection();
  const state = await authState();
  if (state) redirect(nextStep(state) ?? "/today");
  const sp = await props.searchParams;
  return (
    <AuthShell note={MODE === "desktop"
      ? "Sign in to PacedMind Cloud to use your tasks on all your computers."
      : "Sign in to plan your week and follow your agent sessions."}>
      <LoginForm initialError={typeof sp.error === "string" ? sp.error.slice(0, 300) : null} />
      {MODE === "desktop" && (
        <p className="text-center text-[12.5px] text-mut">
          <Link href="/today" className="font-medium text-fg2 hover:text-strong">Continue without an account</Link>. Your data stays on this computer.
        </p>
      )}
    </AuthShell>
  );
}
