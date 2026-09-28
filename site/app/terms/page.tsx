import type { Metadata } from "next";
import Link from "next/link";
import { H2, LegalPage, List, Mail, Operator } from "@/components/legal";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = pageMetadata("/terms", {
  title: "Terms of Service",
  description: "The terms for using PacedMind and for PacedMind Cloud's subscription.",
});

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms cover the PacedMind desktop app, the web app at app.pacedmind.com and the PacedMind Cloud subscription
        (together, &ldquo;PacedMind&rdquo;). They are the rules for providing services electronically that Polish law asks
        for. By creating an account or subscribing, you accept them.
      </p>

      <H2>Who runs PacedMind</H2>
      <Operator />

      <H2>What PacedMind is</H2>
      <List items={[
        <>The <strong>One device</strong> plan: the desktop app for Windows and macOS, free, without an account. Your plans stay on your computer, and we receive none of them.</>,
        <><strong>PacedMind Cloud</strong>: an account whose tasks, plans and sessions are kept on our servers, so they are on all your computers and in the web app, and you can start agent sessions on your other computers. Cloud is a subscription, after 7 days free.</>,
        <>PacedMind starts Claude Code and Codex, which you install and sign in to yourself, on your own computers. What those agents do, and what they send to their makers, falls under your agreements with Anthropic and OpenAI, not these terms.</>,
      ]} />
      <p>
        PacedMind&rsquo;s source code is open under the GNU AGPL, which governs the code (<a href={SITE.license} className="underline underline-offset-2 hover:text-ink">the license</a>).
        These terms govern the service we run. The PacedMind name and logo are trademarks and aren&rsquo;t covered by the license.
      </p>

      <H2>What you need</H2>
      <p>
        A computer with a current version of Windows or macOS for the desktop app, a current web browser for the web app,
        an internet connection for Cloud, an email address, and an authenticator app for two-factor sign-in.
      </p>

      <H2>Your account</H2>
      <List items={[
        "You create an account with your email address and a password, and sign in with a code from an authenticator app every time.",
        "An account is for one person. Keep your password and authenticator to yourself; you're responsible for what's done with your account.",
        "Tell us straight away if you think someone else got into your account.",
        <>You can delete your account in Settings at any time, which deletes everything in it. While a subscription would renew, cancel it first (Settings → Plan → <strong>Manage billing</strong>).</>,
      ]} />

      <H2>The Cloud subscription</H2>
      <List items={[
        "A new account has Cloud free for 7 days, without a card. Nothing is charged unless you subscribe.",
        <>You subscribe in Settings → Plan, monthly or yearly. The price depends on your country, is shown before you pay, and includes VAT where it applies (<Link href="/#pricing" className="underline underline-offset-2 hover:text-ink">pricing</Link>). A year costs ten months&rsquo; worth.</>,
        "Subscribing during the trial keeps the rest of it: the first payment comes when the trial ends.",
        "The subscription renews automatically at the end of each month or year until you cancel it. We charge the card or payment method you gave at the start of each period.",
        "Switching between monthly and yearly takes effect at once: to yearly, you pay the year less what's left of the month; to monthly, what's left of the year becomes credit for the next payments.",
        <>You can cancel at any time in Settings → Plan → <strong>Manage billing</strong>. Cloud then keeps working until the end of the period you paid for, and doesn&rsquo;t renew.</>,
        "If a payment fails, the payment provider tries the card again for a while and Cloud keeps working. If it can't be paid, the subscription ends.",
        "We may change prices. A new price applies from your next renewal after we tell you by email, at least 30 days ahead, and you can cancel before then.",
      ]} />

      <H2>When Cloud ends</H2>
      <p>
        After the trial, or when a subscription ends, your account becomes read-only: you can still see and delete everything in it,
        and move it to your computer from the desktop app (Settings → Data → <strong>Move to this computer</strong>), but not change it.
        Subscribing again makes it writable at once. Your data stays in your account until you delete it.
      </p>

      <H2>Payments</H2>
      <p>
        Stripe sells the subscription to you as the merchant of record: it takes the payment, charges and pays the VAT, and sends the
        receipts and invoices, which are also in <strong>Manage billing</strong>. You enter your card on Stripe&rsquo;s page; we never see
        or store it. A business can give its VAT ID when subscribing. These terms still govern PacedMind and Cloud themselves, and our
        refund promise below.
      </p>

      <H2>Right of withdrawal and refunds</H2>
      <p>
        If you live in the European Union, you can withdraw from the subscription within 14 days of subscribing without giving a reason,
        and we go further: we refund your first payment in full if you ask within 14 days of it, and a yearly renewal if you ask within 14 days of that renewal.
        The details are in our <Link href="/refunds" className="underline underline-offset-2 hover:text-ink">refund policy</Link>.
      </p>

      <H2>Using PacedMind fairly</H2>
      <List items={[
        "Don't use PacedMind for anything illegal, and don't store unlawful content in it.",
        "Don't try to get into other people's accounts or data, get around the limits of your plan, or disrupt the service.",
        "Don't resell access to PacedMind Cloud. (Running your own copy of the open-source code is yours to do under its license.)",
      ]} />
      <p>If you break these rules seriously, we can suspend or close your account, after telling you why when the law allows it.</p>

      <H2>Availability and changes</H2>
      <p>
        We work to keep Cloud running and your data safe, but can&rsquo;t promise it will never be unavailable, for example during maintenance.
        We may change or improve PacedMind. If we ever stop offering Cloud, we&rsquo;ll tell you at least 60 days ahead, refund the unused part
        of a paid period, and you&rsquo;ll be able to move your data to your computer.
      </p>

      <H2>Liability</H2>
      <p>
        We are responsible for providing PacedMind as these terms describe. Apart from harm we cause on purpose or by gross negligence,
        our liability to a business customer is limited to what it paid us in the 12 months before the claim. If you are a consumer, nothing
        here limits the rights the law gives you.
      </p>

      <H2>Complaints</H2>
      <p>
        If something doesn&rsquo;t work as it should, write to <Mail /> with your account&rsquo;s email and what happened. We answer within 14 days.
        A consumer can also turn to a municipal or district consumer ombudsman (miejski or powiatowy rzecznik konsumentów) or another
        out-of-court body, and to the courts.
      </p>

      <H2>Changes to these terms</H2>
      <p>
        We may update these terms, for example when the law or PacedMind changes. We&rsquo;ll email you at least 14 days before a change that
        affects your subscription takes effect. If you don&rsquo;t agree, you can cancel before then.
      </p>

      <H2>Law</H2>
      <p>
        Polish law applies. If you are a consumer, you also keep the protection of the law of the country you live in, and you can go to
        court there.
      </p>
    </LegalPage>
  );
}
