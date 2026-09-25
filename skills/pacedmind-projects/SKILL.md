---
name: pacedmind-projects
description: Set up and structure projects in PacedMind - create the project, break the work into well-described tasks with sub-tasks and estimates, order the roadmap, set target dates and dependencies between projects, and wire agent flows so Claude Code or Codex sessions work through tasks in sequence. Use this skill whenever the user starts something new ("I want to build...", "new project", "help me plan X"), asks for a breakdown, roadmap or milestones, or wants agents to work through a project, even if they don't mention PacedMind.
---

# Projects in PacedMind

The tools come from the PacedMind MCP server, `organizer` (in Claude Code: `mcp__organizer__<tool>`).

## Set up a project

1. Call `get_overview` to see the areas and existing projects. If a matching project already exists, extend it rather than creating a duplicate.
2. Call `create_project` in the right area, and propose a target date if the user hasn't given one. For code projects:
   - set `folder` to the repository's absolute path, so agent sessions start in the right place;
   - set `agent` to claude or codex.
3. If the project has to wait for another one, set `starts_after`.

## Break the work down

Aim for tasks of roughly 30 minutes to one day of work. Bigger ones hide uncertainty, so split them. Much smaller ones work better as sub-tasks.

- Order the tasks the way they'll be done, and let each one leave the project in a working state.
- Give each task:
  - a verb-first title;
  - a description with the context and a clear definition of done;
  - sub-tasks for its steps;
  - an estimate.
- Create them all in one `create_tasks` call. Only set `planned` or `due` where the user has dates in mind; otherwise leave scheduling to planning.
- Tasks without a planned day, a due date or urgent/high priority stay off the auto-planner's focus blocks. If the user wants to start soon, give the first one or two tasks a planned day so they show up on the calendar.
- Set the roadmap order with `reorder_tasks`.
- Show the user the breakdown (keys and titles) and adjust it before building more on top.

A task description an agent can act on:

    Add CSV export to the reports page.
    Why: finance wants monthly exports for their spreadsheet.
    Done when: a "Download CSV" button on /reports downloads the rows for the current filters, with the
    same columns as the table and dates as YYYY-MM-DD, and an empty report gives a header-only file.

## Automate it with agent flows

A flow runs a project's tasks as agent sessions, one after another. Use it for work an agent can do on its own, such as code, writing or research. Don't use it for the user's own tasks.

1. Mark who does what: set `agent` to claude or codex for agent work, and to `human` for tasks only the user can do (calls, purchases, decisions, reviews). Human tasks stay in the project and on its roadmap but never in the flow. Use `update_task` or `create_tasks`.
2. Connect the tasks in order with `connect_tasks` from → to. Choose the mode by how much the user wants to check in between:
   - **auto**: the next task starts as soon as the previous agent reports finished. Fastest, with the least oversight.
   - **manual**: the next task starts only after the user reviews the previous one and marks it done. The safe choice for anything risky.
   - **same_session**: the same agent continues in the same terminal and keeps its context. Good for closely related steps.
   - **at_time**: waits until a set time, for example to run overnight.
3. Check the result with `get_flow`.
4. Nothing starts on its own until the project's flow is on. Only the user can switch it on, in PacedMind's Flows page on the computer where the sessions run, because it starts agents there unattended. Tell them the flow is ready when it is.

The user starts the first task of a flow with the Start button in PacedMind. If the user asks you to, `start_session` sends the request; they allow it in PacedMind.

## Keep projects healthy

- `get_project` shows the tasks by status and the next ready task. `list_projects` shows progress and target dates.
- If a target date is at risk, tell the user early and offer options: cut scope, move the date (`update_project` with `target_date`), or plan more time.
- When a project is finished, mark the remaining tasks done or canceled rather than deleting the project, unless the user wants it gone.
