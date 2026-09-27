# Contributing to PacedMind

Thank you for helping with PacedMind. Bug reports, fixes, documentation and ideas are all welcome.

- **Bugs and ideas:** open an issue. For a bug, say what you did, what you expected and what happened instead, and on which system (Windows or macOS, and which version).
- **Security problems:** don't open an issue. Report them privately, as [SECURITY.md](SECURITY.md) describes.
- **Bigger changes:** open an issue first, so we can agree on the approach before you spend time on it.

## The Contributor License Agreement

Before your first pull request can be merged, you accept the [Contributor License Agreement](CLA.md), once, by commenting on the pull request:

> I have read the CLA Document and I hereby sign the CLA

You keep the copyright in your work. The agreement lets PacedMind include it and license it under the AGPL and under other terms, such as a commercial license. The **CLA** check on the pull request says who still has to sign.

## Set up

You need [Node.js](https://nodejs.org/) 22.13 or later and Git. The desktop app runs on Windows and macOS.

```bash
npm install
npm run dev
```

`npm run dev` serves the app at http://127.0.0.1:4320. It prints an unlock link once: open it in your browser, because only a window that has that key may use the app. Without an account it keeps its data in `data/organizer.db`, which it creates with sample data on its first start (**Settings → Data** resets it). It never touches an installed PacedMind's data.

Signing in there uses PacedMind Cloud unless `.env.local` names another Supabase project (see `.env.example`). To work on the Cloud parts, run a local Supabase stack instead (it needs Docker):

```bash
npx supabase start      # prints the local URL and publishable key for .env.local
npx supabase db reset   # applies supabase/migrations
```

`npm run desktop` builds the desktop app and installs it for your user. It replaces an installed PacedMind and keeps its data; see [Build from the source code](https://pacedmind.com/docs/getting-started/install#build-from-the-source-code).

The website (`site/`) and the documentation (`docs/`) are separate projects with their own dependencies; their READMEs say how to run them.

## How the code is organized

[AGENTS.md](AGENTS.md) is the map: the architecture, and the rules the code follows. It's written for coding agents (`CLAUDE.md` points to it), and it's just as useful to people. A few of its rules:

- Every data function exists in both stores: this computer's own SQLite database and the account's Supabase project.
- Every Server Action starts with `guardAction()`.
- Nothing from the cloud decides what runs on a computer.
- A new or renamed MCP tool also changes the skills, the settings page, the tools that sessions may use, and the documentation.

[SECURITY.md](SECURITY.md) explains the security design. Read it before you change sign-in, the launcher, MCP or the database schema.

## Before you open a pull request

```bash
npm run typecheck
npm run lint
npm run build
```

CI runs the same checks for every pull request, and builds `site/` and `docs/` too.

- **Database changes:** add a migration to `supabase/migrations/`, the same change to the local store (`src/server/store/local-db.ts`, with a line in `migrate()` for older databases), and checks to `supabase/tests/security.sql`. Run that file in your local stack's SQL editor: every line should match its `(want …)`.
- **Changes people see:** update the pages in `docs/content/docs/` that describe them ([docs/AGENTS.md](docs/AGENTS.md) has the conventions), and add screenshots to the pull request.
- **Code, icons or images from elsewhere** need a license that allows it, and an entry in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Keep a pull request to one change, and say how you checked it.
