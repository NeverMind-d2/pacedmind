# PacedMind

A personal planner in the style of Linear: tasks, time blocks, one calendar and timeline for everything, and deadlines. It also coordinates Claude Code and Codex sessions: start a session from a task, keep talking to the agent in its own terminal, and see here when the agent says it's finished.

## Desktop app (Windows)

```bash
npm install
npm run desktop
```

This builds the app, installs it to `%LOCALAPPDATA%\Programs\Organizer`, adds **PacedMind** to the Start Menu and the desktop, and starts it. Run the same command again after changing the code: it closes the running app, replaces it and starts the new version.

- Your data lives in `%APPDATA%\Organizer\data` and is kept when you reinstall. The first start has just the default areas.
- Closing the window keeps PacedMind running in the tray, so agents can still report back. It shows a notification when a session finishes. Quit from the tray icon's menu, which also has **Start with Windows**.
- The app serves itself at http://127.0.0.1:4319. Only this computer can reach it.
- To uninstall, run `Organizer.exe --uninstall` from the install folder (removes the shortcuts and the login item), then delete the folder. Delete `%APPDATA%\Organizer` to remove your data as well.

## Development

```bash
npm run dev
```

Open http://127.0.0.1:4320. The dev server uses its own database, `data/organizer.db`, created with sample data on first start, so it never touches the app's data. Press **C** anywhere to add a task.

## Agents and MCP

The MCP server runs at `http://127.0.0.1:4319/api/mcp` in the desktop app (`4320` for the dev server) and needs the access token shown in **Settings → MCP server**.

- Sessions started from PacedMind (the **Start in Claude Code** button on a task) are connected automatically. PacedMind opens a Windows Terminal tab in the project's folder with Claude Code, the task and the MCP config.
- To use PacedMind from Claude Code sessions you start yourself, run `npm run connect` once. It registers the MCP server as `organizer` for all your projects, using the app's token; `npm run connect -- --remove` undoes it. The `claude mcp add …` command in Settings does the same by hand.
- For Codex, copy the `config.toml` snippet from Settings.

Set each project's folder in **Settings → Projects and folders**. Flows only start sessions on their own when the project's **Flow** switch is on.

The MCP tools cover the whole app:
- areas and projects;
- tasks, with descriptions, sub-tasks, priorities, due and planned dates, and labels;
- calendar events, and moving plans between days;
- the agenda with its auto-planned focus blocks, and work hours;
- agent flows and sessions.

Dates can be written as `YYYY-MM-DD` or as phrases like "friday 10:00". In sessions started from PacedMind, agents can read, add and update tasks without asking. Deleting things, moving calendar events and starting sessions ask in the agent's terminal first.

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
