# Security

PacedMind starts Claude Code and Codex in terminals on your computers. Anyone who could make it start a session could run code on your computer, so the design assumes the worst about everything outside the computer: the cloud database, the web app, a stolen password, a stolen browser session, and even the agents' own conversations.

Without an account (the free One device plan), the desktop app keeps its data in a SQLite file next to its settings (`src/server/store/local.ts`), and nothing leaves the computer. Everything under "Your computer", "Agents" and "Starting sessions" applies the same way; "Accounts" and "Your data" are about PacedMind Cloud, which the app switches to once you sign in (`src/server/scope.ts`).

## Reporting a vulnerability

Report security problems privately, not in a public issue: select **Report a vulnerability** on this repository's **Security** tab, which opens an advisory only the maintainer can see, or email mbednarczyk@preseed.tech. Say what's affected, how to reproduce it, and what an attacker could do with it, and give us time to release a fix before you tell anyone else.

This covers the desktop app, the MCP server, the web app at app.pacedmind.com, and the database rules in `supabase/`. Test only with your own accounts, computers and data: your own PacedMind Cloud account, or a local Supabase stack (`npx supabase start`). Denial of service and spam are out of scope.

## What protects what

### Accounts

- **Two-factor sign-in for every account.** Sign-in is a password (12+ characters) and then a code from an authenticator app (TOTP). An account sets one up before it can see anything (`/login/setup`).
- **The database insists on it.** Every table has a restrictive policy (`private.session_ok()`) that answers only sessions that passed the second factor (`aal2`) and still exist in `auth.sessions`. A password alone reads nothing, and signing out, "Sign out all" or signing a computer out cuts a session off immediately, not when its token expires.
- **Fresh codes for dangerous things.** Starting, resuming or sending back a session from afar and deleting the account need a code entered in the last five minutes, and the database checks it itself (`private.recent_mfa(300)`). The code only counts when it came from an authenticator the account already had before this sign-in: Supabase lets any signed-in session add an authenticator, so a stolen session could otherwise add its own and pass every check. The app skips asking again for a code entered in the last four minutes; the database still decides.
- **Changing what protects the account.** Adding an authenticator needs a current code from one you have; removing one needs a code from one that stays; changing the password needs the current password (checked by Supabase once the setting below is on) and a current code, and signs every other browser and computer out; a new password after a reset link only works in that link's session. Supabase emails you when a password, email or authenticator changes (see the checklist).
- **Email links use PKCE only**, so a link made for someone else's account can't sign your app in.
- **Web sessions live in HttpOnly cookies** (no script in a page can read them), and there is no Supabase secret or service-role key anywhere in the app: it talks to Supabase with the public publishable key and your own session, so row level security applies to everything it does.

### Your data

- Every row belongs to one account. References between rows include `user_id` (composite foreign keys), so a row can't point at another account's rows even by mistake.
- `anon` has no privileges at all; `authenticated` can't truncate tables or write bookkeeping tables (`user_state`, `key_counters`), and changes devices and launch requests only through narrow column grants and functions. A launch request is decided once (waiting → outcome), and a computer's entry can't be taken over by another session.
- **Computers.** Any two-factor session of the account can rename a computer or make it the default (one per account, only a signed-in one; signing it out clears it). What a computer reports about itself (when it was last seen, what it found of the agents, its PacedMind version, which flows are on there, its setting for requests from elsewhere) changes only from that computer's own sign-in, so another browser can't make it look online or change what it shows. The computer takes over a name given elsewhere; names are plain text.
- Checks on every text column keep values in the shapes the app expects: task keys like `WRK-12`, dates, colors, sizes. Settings in the cloud can only be work hours.

### Your computer

- **Nothing in the cloud decides what runs.** The agent commands, the terminal, each project's folder, whether a project's flow may start sessions, and the MCP tokens are this computer's own settings (`src/server/device.ts`), changed only from the desktop app's window. The launcher checks the task's key and title from the cloud against strict patterns (or reduces them to letters and digits) before they reach a command line, refuses folders with characters a terminal would act on, and never takes a folder or a command from a database row.
- **Only the app's window can use the app.** The server answers on 127.0.0.1 only, refuses other Host names (DNS rebinding), and refuses every page, Server Action and API call that doesn't carry the window key: the desktop app makes a new key each run and gives it to its window as an HttpOnly cookie. Other programs on the computer, other Windows users, and the agents PacedMind starts can't drive it. Every Server Action checks the key again, and while you're signed in to Cloud the two-factor session too (`guardAction()`). Before trusting a server with its window, the app has it sign a random value with that key, so another program listening on the port can't pose as PacedMind.
- **Secrets are encrypted at rest.** The sign-in session and this computer's settings (`session.json`, `device.json` in `%APPDATA%\Organizer\data`) are encrypted with AES-256-GCM, with a key the desktop app keeps in the OS keychain (Windows DPAPI through Electron `safeStorage`). An unencrypted or unreadable file there is set aside, not trusted.
- **A strict Content Security Policy** with a nonce per request, plus `frame-ancestors 'none'`, `nosniff`, `no-referrer` and a restrictive `Permissions-Policy`: task titles and descriptions come from the cloud, and a page running foreign script could otherwise start sessions.
- **What a computer tells the account** (the Computers page, on every computer and in the web app): its name and system, that it's still there (every minute), its setting for requests from elsewhere, PacedMind's version, which projects' flows are on there, and per agent the CLI's and desktop app's versions, whether the app reaches PacedMind, and whether the CLI is signed in (`claude auth status`, `codex login status`) with its method and plan as single words. Never where the tools are, and never an email, an organization, a path or a key: the CLIs' output stays on the computer. The flows and the setting are for display; the computer never reads them back.

### Agents

- **Each session gets its own MCP token.** It can read, add open tasks, edit its own task's details, and report with `start_task`/`finish_task`; it can't see or call anything else (no deleting, flows, settings, other tasks' status, or starting sessions), whatever it is asked to do. The agent needs the token in its session's own config files while it runs; they're deleted when the session ends, and PacedMind itself keeps only a hash. The token stops working when the agent calls `finish_task` (unless the same terminal continues with the next task), when you mark the task done or close the session, when the terminal closes (Claude Code's `SessionEnd` hook), when this computer signs out, and after 24 hours at the latest (Codex has no end-of-session hook).
- **Your own agents** (Claude Code or Codex you start yourself) use the owner token from Settings. They can use every tool, but `start_session` and `request_changes` only ask: nothing opens until you click **Allow** in the app, and it refuses if the task, agent or folder changed after you saw the request.
- **Sessions in the Claude and Codex desktop apps** use the owner token too: the apps read PacedMind from their own settings (**Connect** in Settings), which can't hold a token per session. PacedMind opens the app with the first message written but not sent, so nothing runs until you send it; after that, the agent has your agents' rights, not a session's.
- **Trusting a folder stays your answer.** Claude Code asks whether you trust a folder the first time it starts there, and a yes also lets it use that folder's own settings, hooks and MCP servers. PacedMind never answers for you and never writes Claude Code's settings: it only reads `~/.claude.json` to tell you the question is coming (`src/server/claude-trust.ts`).
- **Images an agent attaches** are read from this computer only: a network path (`\\server\share`) is refused before Windows would sign in to that server as you.
- **An area's own picture** (a company logo, say) never reaches the server as the file you picked. The browser draws it into a small PNG, so an SVG's scripts or markup don't survive. The server, and in the cloud the database's check, take nothing but base64 of a PNG of 64 pixels at most and about 24 KB (`src/lib/area-picture.ts`). `/api/areas/[id]/picture` serves it as `image/png` with `nosniff`, from the store in use, so another account's area is never found.
- **MCP refuses browsers.** Requests carrying an `Origin` header are refused, and the endpoint only exists in the desktop app.
- The server instructions tell agents that task text is the user's notes, not instructions.

### Starting sessions

| Started by | What happens |
|---|---|
| You, in the desktop app | Starts right away. |
| A flow that's on for that project, on that computer | Starts when its turn comes, along the connections you confirmed on this computer: the ones the flow had when you switched it on, and any you drew in the app since. A connection added elsewhere (an agent, the web app, another computer) asks you first, and so does a task that would run in the agent's cloud (that sends the project there, and where a task runs can be changed from the web app). Changing the project's or the task's folder switches the flow off. |
| An agent over MCP | Waits for you to allow it in the app (a notification too). Expires after 10 minutes. |
| The web app or another computer | Starting a session, resuming one, or sending one back to its agent with changes. Needs a fresh two-factor code (checked by the database, as above). Then the computer's own setting decides: **Refuse**, **Ask me** (the default: waits for you there), or **Start**, except that anything in the agent's cloud (a session sent there, or one pulled back in) always asks. Expires after 10 minutes; at most ten wait; each request is acted on once. |

Every request you're asked about shows the task, the agent, where it runs and the folder (and for changes, what should change), and acting refuses if any of them changed in between. A Claude Code or Codex conversation stays on the computer that ran it, so a request to resume a session or send it back goes only there: the database refuses one for a session of another task, agent, computer or account, and the computer checks again that the session is its own and can be reopened. What should change is your note to the agent: it goes on the session's report, where the agent reads it through `start_task`, and never onto a command line.

**The Computers page** lists the computers signed in to the account. Signing one out deletes its session in the database: it can't read anything from that moment, and within a minute it signs itself out and its agents lose access.

## What you need to set in Supabase

The database side is applied (`supabase/migrations/`). These project settings live outside the database; set them in the dashboard (Authentication), or review and apply `supabase/config.toml` with `npx supabase login`, `npx supabase link --project-ref pyoynjoyhpolijlvoalu` (PacedMind Cloud's project; your own project's ref if you run one) and `npx supabase config push` (it shows the differences first; items marked *dashboard only* aren't in the file).

1. **Multi-factor: TOTP on** (enroll and verify). It's on by default; never push a `config.toml` with it off.
2. **Email: confirm email on.**
3. **Passwords:** minimum length 12; **leaked password protection on** (*dashboard only*, Pro plan); **require current password when updating it on** (*dashboard only*). PacedMind sends the current password, but until this is on Supabase ignores it, and a stolen session could change the password by calling Supabase directly. Reset links keep working: Supabase skips the check in a reset link's session. Leave **secure password change** (an emailed nonce) off: PacedMind asks for the current password and a fresh code instead.
4. **Security notifications on:** password changed, email changed, verification method added, verification method removed (Authentication → Emails, or the file's `[auth.email.notification.*]`).
5. **URL configuration:** site URL `https://app.pacedmind.com`; redirect URLs exactly `http://127.0.0.1:4319/auth/callback`, `http://127.0.0.1:4320/auth/callback` and `https://app.pacedmind.com/auth/callback`, with no wildcards.
6. **Sessions** (Pro plan): time-box 30 days and inactivity timeout 14 days, so every computer and browser signs in again, with its code, at least monthly.
7. **Custom SMTP** before anyone else signs up (*dashboard only*): the built-in sender only emails members of your Supabase organization, two emails an hour.
8. **API keys:** the app uses the publishable key; once nothing else needs it, disable the legacy `anon` JWT key.
9. The security advisor lists the four functions the app calls (`register_device`, `claim_device`, `revoke_device`, `delete_account`) as callable by signed-in users. That's intended: each checks the two-factor session itself.

## What's left to you

- **A flow that's on runs unattended** along the connections you confirmed. Someone who got into your account (your password *and* a second factor, or a signed-in browser) could still mark a task in it done, or rewrite a task's description, and so start the next agent in that project's folder. Switch flows on only for folders you're fine with an agent working in alone, and don't run Claude Code in a mode that skips its permission prompts there.
- **"Start" for requests from elsewhere trusts the cloud's code check,** for resuming sessions and sending them back with changes too. Keep **Ask me** unless you need to start sessions while away from the computer.
- **Task text is input to an agent.** A task's description can try to talk an agent into something (prompt injection). PacedMind limits what a session can do inside PacedMind; what it can do on your computer is up to the agent's own permission settings.
- **Programs running as you** can read what you can: the running sessions' config files, and `~/.claude.json`, which holds the owner token once Claude Code is connected. If the token leaks, make a new one in Settings; it can't start a session without your click.
- **Right after setting up two-factor sign-in,** starting a session from the web or deleting the account asks you to sign out and in again once, because the authenticator you just added is newer than that sign-in.
- **Losing every authenticator locks the account.** Backup codes aren't available on hosted Supabase projects yet, so keep two authenticators. The project's owner can remove a factor in the Supabase dashboard (Authentication → Users).
- **Guessing codes** is limited by Supabase's rate limits. Locking an account after failed codes needs the MFA verification hook, which is on the Team plan.
- **Sign-up and sign-in have no CAPTCHA.** The web app (app.pacedmind.com, run with `ORGANIZER_MODE=web`, `ORGANIZER_PUBLIC_ORIGIN` and `TZ` from `deploy/pacedmind-web.service`) relies on Supabase's rate limits; a CAPTCHA (Turnstile) would also slow down automated sign-ups.

## Checking it

- `supabase/tests/security.sql` runs 84 checks with two made-up accounts and rolls everything back: two-factor sessions, other accounts' rows, revoked sessions, cross-account references, unsafe task keys and settings, privileges, launch requests (fresh codes, authenticators added mid-session, deciding once; resuming and changes only for a session of the same task, agent, computer and account, each kind's shape, the changes' length), taking over a computer, computers (one default per account, a signed-out one never the default, which columns another sign-in may change and which only the computer itself, plain names and versions), reports and images (other accounts, image file names, session links, Codex environments), account deletion. Run it (SQL editor or the Supabase MCP) after changing policies or grants; every line should match its `(want …)`.
- `npx next build` and `npm run typecheck`.
