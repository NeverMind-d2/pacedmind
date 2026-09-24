<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Organizer

A personal, Linear-style planner (tasks, time blocks, calendar, deadlines) that also coordinates Claude Code and Codex sessions. Organizer only tracks state: the user talks to agents in their own terminals, and agents report back over MCP.

## Run

- `npm run dev` serves the app and the MCP server at http://127.0.0.1:4320 (bound to localhost only). Its data is `data/organizer.db` (SQLite through the built-in `node:sqlite`), created with sample data on first start. Settings → Data can reset it.
- `npm run desktop` builds the Electron app and installs it for the user (`scripts/build-desktop.mjs`). The app runs `.next/standalone/server.js` with Electron's own Node on port 4319, with its data in `%APPDATA%\Organizer\data` (`ORGANIZER_DB`), starting empty (`ORGANIZER_SEED=empty`). Dev and app never share a port or a database.
- `npm run typecheck` generates route types and runs `tsc`. `npm run icons` redraws the icons.

## Layout

- `src/server/` is server-only: `db.ts` (schema and seed), `repo.ts` (all queries), `flow.ts` (which session starts after which), `launcher.ts` (opens a terminal with the agent), `auth.ts` (MCP token check), `views.ts` (view helpers).
- `src/app/api/mcp/route.ts` is the MCP server (`mcp-handler` v2). Tools: list_tasks, get_task, get_next_task, start_task, finish_task, create_task, update_task. Every request needs `Authorization: Bearer <token>` (Settings → MCP server).
- `src/app/api/sessions/[id]/ended` is called by the Claude Code `SessionEnd` hook that the launcher installs per session.
- `src/app/api/state` returns a version that changes on every database write, plus the sessions waiting for the user. Pages poll it to refresh (`live-refresh.tsx`); the desktop app polls it for notifications.
- `src/proxy.ts` rejects requests whose Host isn't 127.0.0.1 or localhost (DNS rebinding).
- `desktop/main.mjs` is the Electron main process: starts the server, window, tray, notifications, `--install`/`--uninstall`/`--quit`/`--hidden`.
- `src/app/actions.ts` holds the Server Actions. Every mutation ends with `refresh()` from `next/cache`, or the page will not re-render.
- `src/lib/` is shared by client and server: types, dates, colors (`colors.ts`), the quick-add parser (`parse.ts`), the auto-planner (`planner.ts`).
- `src/components/` holds the UI kit (`ui.tsx`, `icons.tsx`, `popover.tsx`, `dialog.tsx`), task UI (`task-list`, `task-row`, `task-detail`, `quick-add`) and the area/project menus (`entity-menu.tsx`, used by the sidebar and `/projects`). Views live in `src/components/views/`.

## Conventions

- Next 16: `params` and `searchParams` are Promises, so use `PageProps<"/route">` and await them. Pages under `src/app/(app)` are dynamic (`force-dynamic` in the group layout), because SQLite reads would otherwise be frozen at build time.
- Dates are local strings: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, and timestamps `YYYY-MM-DDTHH:mm:ss`. Use the helpers in `src/lib/dates.ts`.
- Visual rules: near-black neutral palette (tokens in `globals.css`). Color means identity (areas and projects). A project's color is its own or its area's: always use `projectColor(p, areas)`. State is grayscale. The indigo accent is only for today or now, selection, the one primary button, and "session finished, waiting for you". Muted red is only for overdue.
- Agent terminals get the server's environment minus its own variables (`agentEnv()` in `launcher.ts`): no PORT, NODE_ENV, ELECTRON_RUN_AS_NODE or NEXT_*. URLs handed to agents use the port the server actually listens on (`process.env.PORT`).
- Session flow modes on edges: `auto` (starts when the previous task is finished), `manual` (after the user marks it done), `session` (the agent continues in the same terminal), `time` (at `atTime`).
