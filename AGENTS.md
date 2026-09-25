<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Organizer

The user-facing brand is **PacedMind**. Keep the `Organizer` install/data paths, Windows app ID,
MCP identifier, and environment variables for compatibility. Brand assets are in `public/brand/`;
the original approved PNG stays unchanged as an archive. `src/lib/brand-geometry.json` defines
the active wordmark's crop and animation bounds; `npm run icons` exports the solid connected-pd emblem and icons.

A personal, Linear-style planner (tasks, time blocks, calendar, deadlines) that also coordinates Claude Code and Codex sessions. Organizer only tracks state: the user talks to agents in their own terminals, and agents report back over MCP.

## Run

- Data lives in Supabase (Postgres + Auth), PacedMind's project `pyoynjoyhpolijlvoalu`; there is no local database any more. The schema, row level security, triggers and functions are in `supabase/migrations/` (applied through the Supabase MCP or `npx supabase db push`); `supabase/tests/security.sql` checks the rules and rolls itself back. Read `SECURITY.md` before touching auth, the launcher, MCP or the schema.
- Every account uses two-factor sign-in (TOTP). The database answers only sessions that passed it and still exist (`private.session_ok()` in a restrictive policy on every table), so nothing is readable with a password alone or after a sign-out or revoked device.
- `npm run dev` serves the app and the MCP server at http://127.0.0.1:4320 (bound to localhost only), against PacedMind's project unless `.env.local` names another (see `.env.example`; `npx supabase start` runs a local stack). Only the app's own window may use it (`src/server/ui-key.ts`): open the unlock link the server prints once. Its session, device settings and tokens are plain files in `data/`, for development only.
- `npm run desktop` builds the Electron app and installs it for the user (`scripts/build-desktop.mjs`). The app runs `.next/standalone/server.js` with Electron's own Node on port 4319 and hands it two keys: a window key made each run (a cookie in its window, a header from its main process) and a data key kept in the OS keychain (`safeStorage`), which encrypts `session.json` and `device.json` in `%APPDATA%\Organizer\data`. The old SQLite file there can be imported once from Settings → Data.
- Two modes (`MODE` in `src/server/supabase.ts`). `desktop` (the default; the desktop app and `npm run dev`): one signed-in account per server, whose session every part of the server uses (pages, MCP calls from agents, session hooks, the background loop); it opens agent terminals and serves MCP. `web` (`ORGANIZER_MODE=web` and `ORGANIZER_PUBLIC_ORIGIN`, the hosted app): a session per browser in HttpOnly cookies; no terminals and no MCP. "Start session" there asks a computer (a `launch_requests` row, which the database only accepts with a two-factor code from the last five minutes), and that desktop app refuses it, asks you, or starts it, as its own setting says.
- `npm run typecheck` generates route types and runs `tsc`. `npm run icons` redraws the icons.

## Layout

- `src/server/` is server-only:
  - `supabase.ts` (the clients, `MODE`, `authState`/`readAuthState`, `requireAal2`), `supabase-config.ts` (project URL, publishable key, cookie options), `auth-flow.ts` (the sign-in steps), `step-up.ts` (fresh two-factor codes);
  - `repo.ts` (all queries, async, as the signed-in account; merges this computer's project folders and flow switches into `Project`), `account.ts` (reset, sample data, importing the old local SQLite data);
  - `device.ts` (what this computer decides for itself: agent commands, terminal, project folders, flow switches, the remote-start setting, the owner MCP token and per-session tokens), `secure-file.ts` (encrypted JSON files), `ui-key.ts` and `window.ts` (the window key), `guard.ts` (`guardAction()`, first line of every Server Action);
  - `launcher.ts` (opens a terminal with the agent; treats everything from the cloud as untrusted), `requests.ts` (approvals, launch requests, registering this computer and noticing when it was signed out elsewhere), `flow.ts` (which session starts after which; also reacts to tasks finished elsewhere), `background.ts` (the loop), `auth.ts` (who an MCP request acts for), `connect.ts` (Settings' "Connect" for Claude Code), `views.ts` (view helpers).
- Sign-in: `src/app/login` (sign in, create account, reset password), `/login/setup` (authenticator app, required), `/login/verify` (the code at every sign-in), `/login/new-password`; `src/app/auth/actions.ts` (sign-in and account security); `src/app/auth/callback` (email links, PKCE only) and `/auth/done`. The `(app)` layout sends anyone without a two-factor session to the right step.
- `src/app/api/mcp/route.ts` is the MCP server (`mcp-handler` v2), desktop only. Every request needs `Authorization: Bearer <token>` and no `Origin` header: the owner token (Settings → MCP server) or the token of one session PacedMind started, which only gets `SESSION_TOOLS` (`src/server/mcp/agent-tools.ts`) for its own task and stops working when the session ends. `start_session` only asks: you allow it in the app. The tools live in `src/server/mcp/`:
  - `planning.ts`: overview, areas, projects, tasks;
  - `calendar.ts`: events, agenda, reschedule_day, work hours;
  - `agents.ts`: flows, sessions, and the start_task/finish_task protocol;
  - `common.ts`: the `tool()` helper (which also enforces what sessions may call), lookups by id/name/key, date parsing (`when()`, which also reads phrases like "friday 10:00"), and output formatting; `principal.ts`: who the request acts for;
  - `index.ts`: the server instructions.
  - Tools return plain text; throwing `fail()` returns an error the caller can fix.
- When adding or renaming a tool, also update:
  - `skills/pacedmind/references/tools.md`;
  - `TOOL_GROUPS` in `views/settings.tsx`;
  - `AGENT_ALLOWED_TOOLS` in `src/server/mcp/agent-tools.ts` (all that launched sessions may use, without asking; keep deletes, flows, settings and launches out).
- `skills/` holds the agent skills for these tools; `npm run skills` installs them for Claude Code and Codex.
- `src/server/ops.ts` has the operations shared by Server Actions and MCP tools (task done, close session, flow placement and tidy, loop checks). `src/server/folders.ts` validates project folders before they reach a terminal script.
- `src/app/api/sessions/[id]/ended` is called by the Claude Code `SessionEnd` hook that the launcher installs per session, with that session's token.
- `src/app/api/state` returns a version that changes on every account write, plus the sessions waiting for the user and (desktop) the requests waiting to be allowed. Pages poll it to refresh (`live-refresh.tsx`); the desktop app polls it for notifications. `src/app/api/health` says the server is up, for the desktop app starting it.
- `src/proxy.ts` puts a nonce-based Content Security Policy and hardening headers on every response. In the desktop app it rejects requests whose Host isn't 127.0.0.1 or localhost (DNS rebinding) and any request without the window key, except MCP, session hooks and email links; in the hosted app it refreshes the browser's Supabase session cookie and sends signed-out visitors to `/login`.
- `desktop/main.mjs` is the Electron main process: starts the server with its keys, window, tray, notifications (finished sessions and sessions waiting to be allowed), `--install`/`--uninstall`/`--quit`/`--hidden`.
- `src/app/actions.ts` holds the Server Actions. Every one starts with `guardAction()`, and every mutation ends with `refresh()` from `next/cache`, or the page will not re-render.
- `src/lib/` is shared by client and server: types, dates, colors (`colors.ts`), the quick-add parser (`parse.ts`), the auto-planner (`planner.ts`).
- `src/components/` holds the UI kit (`ui.tsx`, `icons.tsx`, `popover.tsx`, `dialog.tsx`), task UI (`task-list`, `task-row`, `task-detail`, `quick-add`), the area/project menus (`entity-menu.tsx`, used by the sidebar and `/projects`), `approvals.tsx` (sessions waiting for you, desktop) and `remote-start.tsx` (starting a session from the web app). Views live in `src/components/views/`.
- Production: the web app at `https://app.pacedmind.com`, the site at `https://pacedmind.com` with the docs under `/docs`, all on one OVH VPS behind Caddy. `deploy/` has the server setup, the deploy script and the steps (`deploy/README.md`).
- `site/` is the public website, a separate static Next.js project (own `package.json`, `npm run dev` on port 4330, `npm run build` to `site/out`). Its Cloud price per country matches Spotify Premium Individual: `site/prices.json`, checked with `npm run prices`. See `site/README.md`.

## Conventions

- Next 16: `params` and `searchParams` are Promises, so use `PageProps<"/route">` and await them. Pages under `src/app/(app)` are dynamic (`force-dynamic` in the group layout): they read the signed-in account's data on every request.
- Every `repo` function is async, and queries never filter by user: RLS does. A new table needs `user_id uuid not null default auth.uid()`, an "own rows" policy, the restrictive "Two-factor session" policy, references that include `user_id` (composite foreign keys onto `unique (user_id, id)`, so no row can point at another account's rows), checks on its text, no grants to `anon`, and a line in `supabase/tests/security.sql`. Area and project ids are UUIDs; task ids are numbers and task keys (WRK-12) come from a database trigger.
- Nothing from the cloud decides what runs on a computer. Agent commands, the terminal, project folders, flow switches and MCP tokens live in `device.ts`, changed only from the desktop window; the launcher checks task keys and ids against strict patterns before they reach a command line, and never reads a folder or command from a row. No Supabase secret or service-role key goes anywhere in the app.
- Server-side "today" uses the server's time zone. That's the user's own in the desktop app; the hosted app must run with `TZ` set (e.g. `Europe/Warsaw`) until settings carry a time zone per account.
- Dates are local strings: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, and timestamps `YYYY-MM-DDTHH:mm:ss`. Use the helpers in `src/lib/dates.ts`.
- Visual rules: use semantic tokens in `globals.css` for both the near-black dark palette and neutral light palette; avoid fixed neutral colors in components. Color means identity (areas and projects). A project's color is its own or its area's: always use `projectColor(p, areas)`. State is grayscale. The navy accent (`--color-accent*` tokens; never a fixed color, so both themes work) is only for today or now, selection, the one primary button, and "session finished, waiting for you". Muted red is only for overdue.
- Agent terminals get the server's environment minus its own variables (`agentEnv()` in `launcher.ts`): no PORT, NODE_ENV, ELECTRON_RUN_AS_NODE, NEXT_*, ORGANIZER_* (the keys) or SUPABASE_*. URLs handed to agents use the port the server actually listens on (`process.env.PORT`).
- Session flow modes on edges: `auto` (starts when the previous task is finished), `manual` (after the user marks it done), `session` (the agent continues in the same terminal), `time` (at `atTime`). A flow only starts sessions on a computer where its project's flow is switched on (`Project.flowOn`, from `device.ts`); changing the project's folder switches it off.
- Dependencies drawn on the Timeline are the same edges (`linkTasksAction`): within one project, never a loop. Your own (`human`) tasks can have them too, but the flow never starts a session for one.
- A task's `agent` (who does it, the `Doer` type) is `claude`, `codex`, `human` or null. `human` tasks are the user's: never in a flow (`keepYoursOutOfFlow` in `ops.ts`), never an agent session, and the auto-planner puts them in the user's time. Null means the project's default agent, else Claude Code; resolve it with `agentOf()` from `src/lib/types.ts`, never `task.agent ?? …`.
- Flow canvas positions are free on a 20 px grid. The geometry and the "Tidy up" layout live in `src/lib/flow-layout.ts`, shared by the canvas and the server; no agent has a column.
