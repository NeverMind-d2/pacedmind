# PacedMind MCP tools

Every tool the `organizer` MCP server offers, grouped by purpose. The tool descriptions and parameter schemas the client shows you have the details. Tools marked (read) never change anything.

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
- `create_project`: name and area, plus optional color, start_date, target_date, folder, agent, starts_after and flow_on.
- `update_project`: any of the above, including moving the project to another area (its tasks move with it). `color: "area"` makes it follow the area's color. Pass null to clear a field. Switching `flow_on` on starts the sessions of tasks that are already ready.
- `delete_project`: its tasks stay in the area. Ask first.
- `reorder_tasks`: the roadmap order of a project's tasks.

## Tasks

- `list_tasks` (read): filters for project, area (`"inbox"` for no area), status list, priority list, label, search words, due_from/due_to, planned_from/planned_to, overdue, unscheduled, include_done and limit.
- `get_task` (read): everything about one task, including its numbered Done when items and sub-tasks, flow connections, the latest session and the latest report an agent handed back.
- `create_task`: title, project or area, description, done_when, status, priority, due, planned, estimate_minutes, labels, subtasks and agent.
  - `done_when` lists what must be true when the task is finished, one checkable outcome per item. Agents answer each item when they hand the task back.
  - `agent` is who does the task: `claude`, `codex`, or `human` when only the user can do it. Tasks that are the user's (`human`) stay out of flows, can't start agent sessions, and the auto-planner puts them in the user's time. Left out, the task gets the project's default agent.
- `create_tasks`: up to 50 tasks at once in one project or area.
- `update_task`:
  - title, description (replace or `append_to_description`), done_when (replaces the list), status, priority, due, planned and estimate;
  - labels (replace, add or remove);
  - move to a project or area;
  - agent (`human` also takes the task out of its flow);
  - where its agent sessions run (`runs_in`: `terminal`, `desktop` for the agent's desktop app, or `cloud`) and its own `folder`, when it shouldn't work in the project's folder (null goes back to the project's);
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

- `get_flow` (read): a project's flow sessions, which agent runs each and where (a terminal or the desktop app on which computer, or the cloud), what starts after what and how, whether the flow is on, and the next ready task.
- `connect_tasks`: from → to, with mode auto, manual, same_session or at_time (plus `at`). It adds the tasks to the flow if needed. Call it again to change the mode.
- `disconnect_tasks`: removes a connection.
- `add_to_flow`: puts a task on the flow canvas, under the rest of the flow.
- `remove_from_flow`: takes a task and its connections off the canvas. The task itself stays.

## Agent sessions

- `list_sessions` (read): filter by `waiting` (finished and needing review), `running` or `all`, and by project or task. Sessions that handed back show their summary and how many Done when items were met, images and questions.
- `start_session`: starts Claude Code or Codex working on the task, where the task says or where `where` says: `terminal`, `desktop` (the Claude or Codex app opens with the first message written; the user sends it) or `cloud` (Claude Code on the web, Codex cloud). Cloud sessions can't call PacedMind's tools, so the user marks them finished; PacedMind notices finished Codex cloud tasks by itself. Only when the user asks.
- `close_session`: marks a stuck or abandoned session closed, and the task goes back to todo.
- `request_changes`: sends work an agent handed back in a terminal to it again, with what the user wants changed. The session reopens in a new terminal: Claude Code continues its conversation, Codex starts a new one. The task goes back to in_progress. Sessions in the desktop apps or the cloud take changes where they run. Only when the user asks.

## Protocol for agents working on a task

- `get_next_task` (read): the next ready task in a project.
- `start_task`: "I'm working on this task." Returns the changes the user asked for (if they sent the last hand-back back), the task with its Done when list, the last report if there is one, and hand-back instructions.
- `attach_image`: adds a screenshot or other image (a PNG, JPEG, GIF or WebP file path, up to 20 MB) to the task while the agent works. It becomes part of the next report.
- `finish_task`: "Ready for review," with a report:
  - `summary` (required): what changed and what to look at first;
  - `criteria`: a verdict (`met`, `partly`, `not_met`) and note for each Done when item. Required when the task has Done when items, unless the outcome is blocked;
  - `images`, `verify` (how to check it), `questions`, `details` (Markdown), `links` and `follow_ups`;
  - `outcome`: `done`, `partial` or `blocked`. After partial or blocked, flows wait for the user.

  It may hand you the next task in the same session.
