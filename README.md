# PacedMind

A personal planner in the style of Linear: tasks, time blocks, one calendar and timeline for everything, and deadlines. It also coordinates Claude Code and Codex sessions: start a session from a task, keep talking to the agent in its own terminal, and see here when the agent says it's finished.

## Desktop app (Windows)

```bash
npm install
npm run desktop
```

This builds the app, installs it to `%LOCALAPPDATA%\Programs\Organizer`, adds **PacedMind** to the Start Menu and the desktop, and starts it. Run the same command again after changing the code: it closes the running app, replaces it and starts the new version.

- Sign in with your PacedMind account on first start. Every account uses two-factor sign-in: the first time you set up an authenticator app, and every sign-in asks for its code. Your data lives in your account, so it's kept when you reinstall. Data from before accounts (`%APPDATA%\Organizer\data\organizer.db`) can be imported once from **Settings → Data**.
- Closing the window keeps PacedMind running in the tray, so agents can still report back. It shows a notification when a session finishes, and when a session asked for elsewhere waits for you to allow it. Quit from the tray icon's menu, which also has **Start with Windows**.
- The app serves itself at http://127.0.0.1:4319. Only this computer can reach it, and only the app's own window can use it. Its sign-in, tokens and settings for this computer are encrypted with a key from Windows' data protection.
- To uninstall, run `Organizer.exe --uninstall` from the install folder (removes the shortcuts and the login item), then delete the folder. Delete `%APPDATA%\Organizer` to remove your data as well.

## Development

```bash
npm run dev
```

The data lives in Supabase, in PacedMind's own project unless `.env.local` names another (see `.env.example`). For a local stack:

```bash
npx supabase start
npx supabase db reset
```

`start` needs Docker and prints the local URL and publishable key; `db reset` applies `supabase/migrations`. The dev server prints an unlock link when it starts: open it once in your browser (only the app's own window may use it otherwise). Then create an account, set up two-factor sign-in, and load sample data from **Settings → Data** if you like. Press **C** anywhere to add a task.

The hosted web version is the same app with `ORGANIZER_MODE=web` and `ORGANIZER_PUBLIC_ORIGIN`: every browser signs in on its own, it never starts agents, and asking a computer to start a session takes a fresh two-factor code.

## Security

PacedMind starts agents that work on your computer, so it's built to make that hard to abuse: two-factor sign-in the database itself insists on, nothing in the cloud that decides what runs on a computer, a key only the app's window holds, and a token per session that can only report on its own task. [SECURITY.md](SECURITY.md) has the details, the settings the Supabase project needs, and what's left to you.

## Website

The public home page is in `site/`, a separate static Next.js project with its own dependencies. See [site/README.md](site/README.md), including how to keep the Cloud price in step with Spotify.

## Agents and MCP

The MCP server runs at `http://127.0.0.1:4319/api/mcp` in the desktop app (`4320` for the dev server) and needs a token.

- Sessions started from PacedMind (the **Start in Claude Code** button on a task) are connected automatically, each with its own token that works only for that session's task and stops working when its terminal closes. PacedMind opens a Windows Terminal tab in the project's folder with Claude Code, the task and the MCP config.
- To use PacedMind from Claude Code sessions you start yourself, click **Connect** in **Settings → Connect your agents**. It registers the MCP server as `organizer` for all your projects with this computer's token, without showing it; `npm run connect -- --remove` undoes it. The `claude mcp add …` command in Settings does the same by hand.
- For Codex, copy the `config.toml` snippet from Settings.
- When an agent asks over MCP to start a session, PacedMind shows the request and a notification; nothing opens until you allow it.

Set each project's folder in **Settings → Projects on this computer**. Folders, the agent commands and the **Flow** switches belong to each computer, not to your account. Flows only start sessions on their own when the project's **Flow** switch is on, on that computer.

The MCP tools cover the whole app:
- areas and projects;
- tasks, with descriptions, sub-tasks, priorities, due and planned dates, and labels;
- calendar events, and moving plans between days;
- the agenda with its auto-planned focus blocks, and work hours;
- agent flows and sessions.

Dates can be written as `YYYY-MM-DD` or as phrases like "friday 10:00". In sessions started from PacedMind, agents can read, add tasks, update their own task and report on it, and nothing else. From your own Claude Code or Codex, deleting things, moving calendar events and starting sessions ask in the agent's terminal first, and starting a session also waits for you in PacedMind.

### Skills

`skills/` holds agent skills that teach Claude Code and Codex how to use these tools well:

- `pacedmind`: the basics.
- `pacedmind-planning`: plan a day or week, move things.
- `pacedmind-projects`: break a project down, set up agent flows.
- `pacedmind-review`: Inbox triage, the weekly review.
- `pacedmind-agent-session`: the start_task / finish_task protocol for agents working on a task.

```bash
npm run skills
```

This installs them in `~/.claude/skills` and, when Codex is installed, in `~/.codex/skills`. Run it again after changing them. `npm run skills -- --remove` uninstalls them.

## Views

Today, Inbox, Upcoming, Calendar (month and week with auto-planned time blocks), Timeline, Projects, Roadmap and Flow (two views of one plan), Sessions, Settings. Pages refresh on their own when an agent changes something.

Switch between dark and light mode beside Settings in the sidebar, or in **Settings → Appearance**. The choice is remembered on this device and also updates the Windows title-bar controls.

## Brand assets

The refined wordmark (with continuous m and n curves) and solid connected **pd** emblem are saved in `public/brand/`. The compact 112px header logo, beside the back/forward controls, unfolds from pd into pacedmind on initial load (with a reduced-motion fallback). On Windows the header replaces the native title text, keeps native minimize/maximize/close controls and supports dragging the window. The loading screen uses the same header; the emblem is used for the Windows executable, tray, notifications and favicon. Run `npm run icons` to regenerate the emblem's SVG and icon exports.

The existing `Organizer` installation directory, executable name, data directory and MCP identifiers are intentionally retained so upgrades preserve integrations and data. The app and shortcuts display **PacedMind**.
