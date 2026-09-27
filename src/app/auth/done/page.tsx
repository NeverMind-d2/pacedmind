import type { Metadata } from "next";
import { AuthShell } from "@/app/login/shell";

export const metadata: Metadata = { title: "PacedMind" };

/**
 * Where an email link ends when the desktop app finished it: the browser that opened the link can't see the
 * app (only its own window can), so this page sends you back there.
 */
export default async function DonePage(props: PageProps<"/auth/done">) {
  const sp = await props.searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 300) : null;
  // A sign-up link that confirmed the email but couldn't sign in here (callback/route.ts).
  const confirmed = sp.confirmed === "1";
  return (
    <AuthShell note={error ? "That didn't work." : confirmed ? "Email confirmed." : "Done."}>
      <div className="rounded-xl border border-line bg-panel p-6 text-[13px] leading-relaxed text-fg3">
        {error
          ? <p>{error}</p>
          : <p>{confirmed ? "Go back to the PacedMind app and sign in there." : "Go back to the PacedMind app to continue."} You can close this tab.</p>}
      </div>
    </AuthShell>
  );
}
