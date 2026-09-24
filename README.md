# Organizer

A personal planner in the style of Linear: tasks, time blocks, one calendar and timeline for everything, and deadlines. It also coordinates Claude Code and Codex sessions: start a session from a task, keep talking to the agent in its own terminal, and see here when the agent says it's finished.

## Desktop app (Windows)

```bash
npm install
npm run desktop
```

This builds the app, installs it to `%LOCALAPPDATA%\Programs\Organizer`, adds **Organizer** to the Start Menu and the desktop, and starts it. Run the same command again after changing the code: it closes the running app, replaces it and starts the new version.

- Your data lives in `%APPDATA%\Organizer\data` and is kept when you reinstall. The first start has just the default areas.
- Closing the window keeps Organizer running in the tray, so agents can still report back. It shows a notification when a session finishes. Quit from the tray icon's menu, which also has **Start with Windows**.
- The app serves itself at http://127.0.0.1:4319. Only this computer can reach it.
- To uninstall, run `Organizer.exe --uninstall` from the install folder (removes the shortcuts and the login item), then delete the folder. Delete `%APPDATA%\Organizer` to remove your data as well.

## Development

```bash
npm run dev
```

Open http://127.0.0.1:4320. The dev server uses its own database, `data/organizer.db`, created with sample data on first start, so it never touches the app's data. Press **C** anywhere to add a task.

## Agents and MCP

The MCP server runs at `http://127.0.0.1:4319/api/mcp` in the desktop app (`4320` for the dev server) and needs the access token shown in **Settings → MCP server**.

- Sessions started from Organizer (the **Start in Claude Code** button on a task) are connected automatically. Organizer opens a Windows Terminal tab in the project's folder with Claude Code, the task and the MCP config.
- To use Organizer from sessions you start yourself, copy the `claude mcp add …` command or the Codex `config.toml` snippet from Settings.

Set each project's folder in **Settings → Projects and folders**. Flows only start sessions on their own when the project's **Flow** switch is on.

## Views

Today, Inbox, Upcoming, Calendar (month and week with auto-planned time blocks), Timeline, Projects, Roadmap and Flow (two views of one plan), Sessions, Settings. Pages refresh on their own when an agent changes something.
