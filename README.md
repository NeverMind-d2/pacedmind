# Organizer

A personal planner in the style of Linear: tasks, time blocks, one calendar and timeline for everything, and deadlines. It also coordinates Claude Code and Codex sessions: start a session from a task, keep talking to the agent in its own terminal, and see here when the agent says it's finished.

## Start

```bash
npm install
npm run dev
```

Open http://127.0.0.1:4319. The first start creates `data/organizer.db` with sample data. Press **C** anywhere to add a task.

## Agents and MCP

The MCP server runs with the app at `http://127.0.0.1:4319/api/mcp` and needs the access token shown in **Settings → MCP server**.

- Sessions started from Organizer (the **Start in Claude Code** button on a task) are connected automatically. Organizer opens a Windows Terminal tab in the project's folder with Claude Code, the task and the MCP config.
- To use Organizer from sessions you start yourself, copy the `claude mcp add …` command or the Codex `config.toml` snippet from Settings.

Set each project's folder in **Settings → Projects and folders**. Flows only start sessions on their own when the project's **Flow** switch is on.

## Views

Today, Inbox, Upcoming, Calendar (month and week with auto-planned time blocks), Timeline, Roadmap and Flow (two views of one plan), Sessions, Settings.
