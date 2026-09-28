import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MODE, authState } from "@/server/supabase";
import { googleSignIn, nextStep, safeNext, withNext } from "@/server/auth-flow";
import { Button } from "@/components/ui";
import { continueWithoutAccountAction } from "../auth/actions";
import { AuthShell } from "./shell";
import { LoginForm } from "./forms";

export const metadata: Metadata = { title: "Sign in · PacedMind" };

/**
 * Signing in. The desktop app opens here until you choose: an account (PacedMind Cloud), or this computer's
 * own data without one. It comes back here after signing out.
 */
export default async function LoginPage(props: PageProps<"/login">) {
  await connection();
  const state = await authState();
  const sp = await props.searchParams;
  // The hosted app: where to continue once signed in (approving an agent's sign-in), if it's a page sign-in may go to.
  const next = MODE === "web" && typeof sp.next === "string" && safeNext(sp.next) !== "/today" ? safeNext(sp.next) : null;
  if (state) {
    const step = nextStep(state);
    redirect(step ? withNext(step, next) : next ?? "/today");
  }
  return (
    <AuthShell note={next ? "Sign in to PacedMind to connect your agent."
      : MODE === "desktop"
        ? "Sign in to PacedMind Cloud to use your tasks on all your computers, or use PacedMind on this computer without an account."
        : "Sign in to plan your week and follow your agent sessions."}>
      <LoginForm initialError={typeof sp.error === "string" ? sp.error.slice(0, 300) : null} confirmed={sp.confirmed === "1"} create={sp.create === "1"} next={next}
        google={await googleSignIn()} />
      {MODE === "desktop" && (
        <form action={continueWithoutAccountAction} className="flex flex-col gap-4">
          <div className="flex items-center gap-3 text-[12px] text-mut2" aria-hidden>
            <span className="h-px flex-1 bg-line2" />or<span className="h-px flex-1 bg-line2" />
          </div>
          <Button type="submit" className="h-9 justify-center text-[13px]">Continue without an account</Button>
          <p className="text-balance text-center text-[12px] leading-relaxed text-mut2">
            Your tasks stay on this computer. You can sign in later from the top of the window.
          </p>
        </form>
      )}
    </AuthShell>
  );
}
