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

- `npm run dev` serves the app and the MCP server at http://127.0.0.1:4320 (bound to localhost only). Its data is `data/organizer.db` (SQLite through the built-in `node:sqlite`), created with sample data on first start. Settings → Data can reset it.
- `npm run desktop` builds the Electron app and installs it for the user (`scripts/build-desktop.mjs`). The app runs `.next/standalone/server.js` with Electron's own Node on port 4319, with its data in `%APPDATA%\Organizer\data` (`ORGANIZER_DB`), starting empty (`ORGANIZER_SEED=empty`). Dev and app never share a port or a database.
- `npm run typecheck` generates route types and runs `tsc`. `npm run icons` redraws the icons.

## Layout

- `src/server/` is server-only: `db.ts` (schema and seed), `repo.ts` (all queries), `flow.ts` (which session starts after which), `launcher.ts` (starts a session in a terminal, the agent's desktop app or its cloud), `auth.ts` (MCP token check), `views.ts` (view helpers).
  - `devices.ts`: the computers PacedMind runs on. Each install keeps its id in `device.json` next to the database, looks for the Claude Code and Codex CLIs, their desktop apps and their MCP config at start and every half hour, and can connect them to PacedMind.
  - `import.ts`: finds the folders you work in with Claude Code and Codex (their own session records and configs, read-only) for the first-start import.
  - `cloud.ts`: asks `codex cloud list --json` which Codex cloud tasks are ready. `shell.ts`: the agents' environment, quoting, running commands and opening links.
- `src/app/api/mcp/route.ts` is the MCP server (`mcp-handler` v2). Every request needs `Authorization: Bearer <token>` (Settings → MCP server). The tools live in `src/server/mcp/`:
  - `planning.ts`: overview, areas, projects, tasks;
  - `calendar.ts`: events, agenda, reschedule_day, work hours;
  - `agents.ts`: flows, sessions, and the start_task/finish_task protocol;
  - `common.ts`: the `tool()` helper, lookups by id/name/key, date parsing (`when()`, which also reads phrases like "friday 10:00"), and output formatting;
  - `index.ts`: the server instructions.
  - Tools return plain text; throwing `fail()` returns an error the caller can fix.
- When adding or renaming a tool, also update:
  - `skills/pacedmind/references/tools.md`;
  - `TOOL_GROUPS` in `views/settings.tsx`;
  - `AGENT_ALLOWED_TOOLS` in `src/server/mcp/agent-tools.ts` (tools that launched sessions may use without asking; keep deletes and launches out).
- `skills/` holds the agent skills for these tools; `npm run skills` installs them for Claude Code and Codex.
- `src/server/ops.ts` has the operations shared by Server Actions and MCP tools (task done, close session, flow placement and tidy, loop checks). `src/server/folders.ts` validates project folders before they reach a terminal script.
- `src/app/api/sessions/[id]/ended` is called by the Claude Code `SessionEnd` hook that the launcher installs per session.
- `src/app/api/state` returns a version that changes on every database write, plus the sessions waiting for the user. Pages poll it to refresh (`live-refresh.tsx`); the desktop app polls it for notifications.
- `src/proxy.ts` rejects requests whose Host isn't 127.0.0.1 or localhost (DNS rebinding).
- `desktop/main.mjs` is the Electron main process: starts the server, window, tray, notifications, `--install`/`--uninstall`/`--quit`/`--hidden`.
- `src/app/actions.ts` holds the Server Actions. Every mutation ends with `refresh()` from `next/cache`, or the page will not re-render.
- `src/lib/` is shared by client and server: types, dates, colors (`colors.ts`), the quick-add parser (`parse.ts`), the auto-planner (`planner.ts`).
- `src/components/` holds the UI kit (`ui.tsx`, `icons.tsx`, `popover.tsx`, `dialog.tsx`), task UI (`task-list`, `task-row`, `task-detail`, `quick-add`) and the area/project menus (`entity-menu.tsx`, used by the sidebar and `/projects`). Views live in `src/components/views/`.
- `site/` is the public website, a separate static Next.js project (own `package.json`, `npm run dev` on port 4330, `npm run build` to `site/out`). Its Cloud price per country matches Spotify Premium Individual: `site/prices.json`, checked with `npm run prices`. See `site/README.md`.

## Conventions

- Next 16: `params` and `searchParams` are Promises, so use `PageProps<"/route">` and await them. Pages under `src/app/(app)` are dynamic (`force-dynamic` in the group layout), because SQLite reads would otherwise be frozen at build time.
- Dates are local strings: `YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, and timestamps `YYYY-MM-DDTHH:mm:ss`. Use the helpers in `src/lib/dates.ts`.
- Visual rules: use semantic tokens in `globals.css` for both the near-black dark palette and neutral light palette; avoid fixed neutral colors in components. Color means identity (areas and projects). A project's color is its own or its area's: always use `projectColor(p, areas)`. State is grayscale. The navy accent (`--color-accent*` tokens; never a fixed color, so both themes work) is only for today or now, selection, the one primary button, and "session finished, waiting for you". Muted red is only for overdue.
- Agent terminals get the server's environment minus its own variables (`agentEnv()` in `launcher.ts`): no PORT, NODE_ENV, ELECTRON_RUN_AS_NODE or NEXT_*. URLs handed to agents use the port the server actually listens on (`process.env.PORT`).
- Session flow modes on edges: `auto` (starts when the previous task is finished), `manual` (after the user marks it done), `session` (the agent continues in the same terminal), `time` (at `atTime`).
- Where a session runs is its surface: `terminal` or `desktop` (the Claude or Codex app, opened with `claude://code/new` or `codex://new`, first message written but not sent) on a device, or `cloud` (`claude --cloud` in a terminal, `codex cloud exec` in the background with the project's `codexEnv`). A task's `runIn` null means the terminal when the CLI is there, else the app (`surfaceOf()`). Cloud sessions can't reach the MCP server: the user marks them finished, and Codex cloud tasks are checked by `cloud.ts`. A task can have its own `folder` and `deviceId`; otherwise its project's.
- Dependencies drawn on the Timeline are the same edges (`linkTasksAction`): within one project, never a loop. Your own (`human`) tasks can have them too, but the flow never starts a session for one.
- A task's `agent` (who does it, the `Doer` type) is `claude`, `codex`, `human` or null. `human` tasks are the user's: never in a flow (`keepYoursOutOfFlow` in `ops.ts`), never an agent session, and the auto-planner puts them in the user's time. Null means the project's default agent, else Claude Code; resolve it with `agentOf()` from `src/lib/types.ts`, never `task.agent ?? …`.
- Flow canvas positions are free on a 20 px grid. The geometry and the "Tidy up" layout live in `src/lib/flow-layout.ts`, shared by the canvas and the server; no agent has a column.
