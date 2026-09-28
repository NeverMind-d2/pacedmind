import type { Metadata } from "next";
import { H2, LegalPage, List, Mail, Operator } from "@/components/legal";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";

export const metadata: Metadata = pageMetadata("/privacy", {
  title: "Privacy Policy",
  description: "What PacedMind keeps about you, why, where, for how long, and your rights.",
});

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains what personal data PacedMind keeps, why, where and for how long, and the rights the GDPR gives you.
        PacedMind&rsquo;s code is open (<a href={SITE.source} className="underline underline-offset-2 hover:text-ink">GitHub</a>), so you
        can check what it does.
      </p>

      <H2>Who is responsible</H2>
      <p>The controller of your data is:</p>
      <Operator />

      <H2>Without an account</H2>
      <p>
        The desktop app without an account (the One device plan) keeps everything on your computer. We receive none of your plans,
        tasks or sessions. When you download the app, our server sees the request like any web server does (below).
      </p>

      <H2>What we keep with an account</H2>
      <List items={[
        <><strong>Your account:</strong> your email address, your password (only as a hash, which can&rsquo;t be turned back into it), your authenticators, and your sign-ins (times, devices, IP addresses).</>,
        <><strong>What you put in PacedMind:</strong> areas, projects, tasks, events, settings, and the agent sessions PacedMind starts with their reports. This can include anything you write in them.</>,
        <><strong>Your computers:</strong> each computer&rsquo;s name and system, when it was last online, PacedMind&rsquo;s version, and which agent tools it has (names and versions only, never paths, keys or accounts), and short summaries of the Claude Code and Codex sessions on it: a title, the folder&rsquo;s name and times, never the conversation.</>,
        <><strong>Notifications:</strong> for browsers where you turn them on, the push service&rsquo;s address and keys.</>,
        <><strong>Your subscription:</strong> your trial&rsquo;s end, and from the payment provider your customer and subscription ids, status, country, price and period. Your card never reaches us.</>,
      ]} />
      <p>Images agents attach to their reports stay on the computer that saved them.</p>

      <H2>Why, and on what legal basis</H2>
      <List items={[
        <>To provide PacedMind Cloud to you: the contract with you (GDPR art. 6(1)(b)).</>,
        <>To keep accounts and the service secure, prevent abuse and handle complaints: our legitimate interest (art. 6(1)(f)).</>,
        <>To keep invoices and payment records: the law (art. 6(1)(c)), under Polish tax and accounting rules.</>,
        <>To email you about your account, your subscription and changes to these policies. We send no marketing without asking.</>,
      ]} />

      <H2>Who processes it for us</H2>
      <List items={[
        <><strong>Supabase</strong> hosts the Cloud database and sign-in, in the EU (Ireland), and sends sign-in emails.</>,
        <><strong>OVHcloud</strong> hosts the web app, this website and the downloads, in the EU (France).</>,
        <><strong>Stripe</strong> takes payments and keeps your payment details, as a controller of its own for part of them (<a href="https://stripe.com/privacy" className="underline underline-offset-2 hover:text-ink">Stripe&rsquo;s privacy policy</a>). Stripe may process data in the United States under the EU&rsquo;s standard contractual clauses and the EU–US Data Privacy Framework.</>,
        <><strong>Browser push services</strong> (Google, Mozilla, Apple, Microsoft) carry the notifications you turn on.</>,
      ]} />
      <p>We don&rsquo;t sell your data or share it with anyone else, except when the law requires it.</p>

      <H2>This website</H2>
      <p>
        pacedmind.com and its docs use no cookies. We count visits with Umami, running on our own server, which keeps no personal data and
        no identifier that follows you. Our web server doesn&rsquo;t log visits; the system&rsquo;s own logs, which can hold an IP address
        when something fails, are kept for up to 30 days. The web app uses only the cookies it needs to keep you signed in.
      </p>

      <H2>How long we keep it</H2>
      <List items={[
        "Your account and everything in it: until you delete the account, which deletes it at once.",
        "Invoices and payment records: 5 years from the end of the year they're from, as Polish tax law requires.",
        "System logs: up to 30 days. Backups of the database, which our host keeps: up to 7 days after a deletion.",
      ]} />

      <H2>Security</H2>
      <p>
        Every account signs in with two factors. The database lets each account see only its own data, and only from a session that passed
        both factors. Connections are encrypted, and the desktop app encrypts its sign-in on your computer.
      </p>

      <H2>Your rights</H2>
      <p>
        You can ask us for a copy of your data, to correct it, to delete it, to restrict it, to receive it in a portable form, or object to
        processing based on our legitimate interest. Much of this you can do yourself: the desktop app moves your data to your computer, and
        deleting the account deletes it. Otherwise write to <Mail />; we answer within a month. You can also complain to the Polish data
        protection authority, the Prezes Urzędu Ochrony Danych Osobowych (uodo.gov.pl), or the one where you live.
      </p>

      <H2>Changes</H2>
      <p>We&rsquo;ll post any change here, and email you before a change that matters takes effect.</p>
    </LegalPage>
  );
}
