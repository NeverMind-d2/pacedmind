import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPage, Mail } from "@/components/legal";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/delete-account", {
  title: "Delete your PacedMind account",
  description: "Delete your PacedMind Cloud account and planner data from a browser, without installing the app.",
});

export default function DeleteAccount() {
  return (
    <LegalPage title="Delete your PacedMind account">
      <p>You can delete your PacedMind Cloud account from a browser. You do not need to install the app.</p>
      <p>
        <a href="https://app.pacedmind.com/login?next=%2Fsettings%2Faccount"
          className="underline underline-offset-2 hover:text-ink">Sign in to delete your account</a>
      </p>

      <H2>Steps</H2>
      <ol className="list-decimal space-y-3 pl-6">
        <li>Sign in to the PacedMind account you want to delete and open <strong>Settings → Account</strong>.</li>
        <li>If your subscription is set to renew, cancel it first in <strong>Settings → Plan → Manage billing</strong>, then return to Account.</li>
        <li>Under <strong>Delete account</strong>, type your account&rsquo;s email address to confirm which account to delete.</li>
        <li>
          With two-factor sign-in enabled, enter a current authenticator code. Without it, enter your current password,
          or select <strong>Confirm by email instead</strong>, open the email link in the same browser and return to
          Delete account within five minutes, leaving the password blank. This email option also works if you signed in with Google and have no password.
        </li>
        <li>Select <strong>Delete account</strong> and confirm the permanent deletion.</li>
      </ol>

      <H2>What is deleted</H2>
      <p>
        Deleting the account removes its Cloud account and planner data: areas, projects, tasks, calendar, preferences,
        session reports and computer registrations. You are signed out, and connected agents lose access. Deletion cannot be undone.
        Data kept only on your computer, including the free One device planner, is separate from your Cloud account.
      </p>
      <p>
        The <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">Privacy Policy</Link> explains
        retention for database backups, system logs, invoices and payment records. Data already sent to a connected
        service such as ChatGPT or Claude is managed through that service&rsquo;s controls.
      </p>

      <H2>If you cannot sign in</H2>
      <p>
        Use <strong>Forgot your password?</strong> on the sign-in page, or contact <Mail /> from your account&rsquo;s email
        address and ask to delete your PacedMind account. We may need to verify ownership before handling the request.
      </p>
    </LegalPage>
  );
}
