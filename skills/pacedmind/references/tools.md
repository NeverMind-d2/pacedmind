# PacedMind MCP tools

Every tool the `organizer` MCP server offers, grouped by purpose. The tool descriptions and parameter schemas the client shows you have the details. Tools marked (read) never change anything.

A session that PacedMind started gets a smaller set: the read tools, `create_task`, `update_task` for its own task (not its status, agent or place), `start_task` and `finish_task`. The rest are there for the user's own Claude Code or Codex.

## Orientation

- `get_overview` (read): the current date and time, areas and projects with their ids, the Inbox count, what's overdue, due or planned today, today's calendar, and sessions waiting for review or running. Start here.
- `get_settings` (read): work hours, break and work days, how sessions start, and the MCP address.
- `update_settings`: work hours, break and work days, which the auto-planner uses.

## Areas

- `list_areas` (read): id, key, color and counts.
- `create_area`: a name and an optional color (palette name or hex). The key is made from the name.
- `update_area`: rename or recolor. The key doesn't change.
- `delete_area`: deletes the area and its projects; their tasks go to the Inbox. Ask first.

## Projects

- `list_projects` (read): each project with progress, target date, agent, folder, flow and "starts after". Optional area filter.
- `get_project` (read): the project's tasks in roadmap order, grouped by status, plus the next ready task.
- `create_project`: name and area, plus optional color, start_date, target_date, folder (on this computer), agent and starts_after. Whether its flow starts sessions on its own is switched by the user in PacedMind.
- `update_project`: any of the above, including moving the project to another area (its tasks move with it). `color: "area"` makes it follow the area's color. Pass null to clear a field.
- `delete_project`: its tasks stay in the area. Ask first.
- `reorder_tasks`: the roadmap order of a project's tasks.

## Tasks

- `list_tasks` (read): filters for project, area (`"inbox"` for no area), status list, priority list, label, search words, due_from/due_to, planned_from/planned_to, overdue, unscheduled, include_done and limit.
- `get_task` (read): everything about one task, including numbered sub-tasks, flow connections and the latest session.
- `create_task`: title, project or area, description, status, priority, due, planned, estimate_minutes, labels, subtasks and agent.
  - `agent` is who does the task: `claude`, `codex`, or `human` when only the user can do it. Tasks that are the user's (`human`) stay out of flows, can't start agent sessions, and the auto-planner puts them in the user's time. Left out, the task gets the project's default agent.
- `create_tasks`: up to 50 tasks at once in one project or area.
- `update_task`:
  - title, description (replace or `append_to_description`), status, priority, due, planned and estimate;
  - labels (replace, add or remove);
  - move to a project or area;
  - agent (`human` also takes the task out of its flow);
  - sub-tasks: add, complete, reopen or remove, by number or title.
  - Setting status done may start sessions that wait for the task in a flow.
- `bulk_update_tasks`: the same status, priority, due, planned, `shift_days`, project, area or label change for up to 100 tasks.
- `delete_task`: prefer status canceled when a record is useful. Ask first.

## Calendar and planning

- `list_events` (read): events with their ids for a date range (default: 7 days). Weekly events are expanded.
- `create_event`: title, start with a time, end time or duration, area, weekly.
- `update_event`: rename or change the area, or move the event with `start`, `move_to_date` (same time, another day), `shift_days` or `shift_minutes`. You can also change its length or turn weekly on or off. Moving a weekly event moves the series.
- `delete_event`: removes every occurrence of a weekly event. Ask first.
- `get_agenda` (read): day by day, up to 14 days. Shows events, tasks due and planned, auto-planned focus blocks, free focus time, overdue tasks and what didn't fit.
- `reschedule_day`: moves one day's planned tasks and one-off events to another day. Add `move_deadlines` to move deadlines too. Weekly events stay where they are.

## Agent flows

- `get_flow` (read): a project's flow sessions and which agent runs each, what starts after what and how, whether the flow is on, and the next ready task.
- `connect_tasks`: from → to, with mode auto, manual, same_session or at_time (plus `at`). It adds the tasks to the flow if needed. Call it again to change the mode.
- `disconnect_tasks`: removes a connection.
- `add_to_flow`: puts a task on the flow canvas, under the rest of the flow.
- `remove_from_flow`: takes a task and its connections off the canvas. The task itself stays.

## Agent sessions

- `list_sessions` (read): filter by `waiting` (finished and needing review), `running` or `all`, and by project or task.
- `start_session`: asks to open a terminal with Claude Code or Codex working on the task. Only when the user asks. PacedMind shows the request and the user allows it there; the terminal opens then (the request expires after 10 minutes).
- `close_session`: marks a stuck or abandoned session closed, and the task goes back to todo.

## Protocol for agents working on a task

- `get_next_task` (read): the next ready task in a project.
- `start_task`: "I'm working on this task." Returns the task and hand-back instructions.
- `finish_task`: "Ready for review," with a one-line note. May hand you the next task in the same session.
