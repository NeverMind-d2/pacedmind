import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPage, List, Mail } from "@/components/legal";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata("/refunds", {
  title: "Refunds and cancelling",
  description: "How to cancel PacedMind Cloud, and when we refund a payment.",
});

export default function Refunds() {
  return (
    <LegalPage title="Refunds and cancelling">
      <p>
        PacedMind Cloud starts with 7 days free, without a card, so you can try it before paying anything. After that, these are the rules.
      </p>

      <H2>Cancelling</H2>
      <p>
        Cancel at any time in PacedMind: Settings → Plan → <strong>Manage billing</strong>. Cloud keeps working until the end of the month or
        year you paid for, and then doesn&rsquo;t renew. Your data stays in your account, read-only, until you delete it or move it to your computer.
      </p>

      <H2>Refunds within 14 days</H2>
      <List items={[
        "Your first payment: if you ask within 14 days of it, we refund it in full, and your subscription ends.",
        "A yearly renewal: if you ask within 14 days of it, we refund it in full, and your subscription ends.",
        "This also covers the right of withdrawal consumers in the European Union have: you don't need to give a reason.",
      ]} />
      <p>
        To ask, write to <Mail /> from your account&rsquo;s email, or say which account it is. We refund to the card or payment method you paid
        with, within 14 days of your message; your bank may take a few more days to show it.
      </p>

      <H2>Other payments</H2>
      <p>
        Monthly renewals, and payments more than 14 days old, aren&rsquo;t refunded: cancelling stops the next one, and Cloud works until the end of
        the period you paid for. If something went wrong on our side, such as a double charge or Cloud not working, write to us and we&rsquo;ll make it right.
      </p>

      <H2>Switching between monthly and yearly</H2>
      <p>
        Switching to yearly charges the year less what&rsquo;s left of your month. Switching to monthly turns what&rsquo;s left of your year into credit,
        which pays your next months first.
      </p>

      <p>
        The rest of the subscription&rsquo;s rules are in the <Link href="/terms" className="underline underline-offset-2 hover:text-ink">terms of service</Link>.
      </p>
    </LegalPage>
  );
}
