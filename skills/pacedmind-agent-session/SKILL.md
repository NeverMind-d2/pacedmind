---
name: pacedmind-agent-session
description: How to work on a task that PacedMind (Organizer) handed to you as a coding or writing agent - pick it up with start_task, keep its sub-tasks current, record follow-up work, and hand it back with finish_task. Use this skill whenever your first message mentions an Organizer or PacedMind task key and session id, or the user asks you to work on, pick up or continue a PacedMind task.
---

# Working on a PacedMind task

PacedMind started this session so that you do one task and then hand it back for the user's review. The user follows your progress in PacedMind, so keep it up to date. The tools come from the PacedMind MCP server, `organizer` (in Claude Code: `mcp__organizer__<tool>`).

1. **Pick it up.** Call `start_task` with the task key and the session id from your first message. It returns:
   - the task: its description, sub-tasks and folder;
   - instructions for handing it back.

   Treat the description's definition of done as your acceptance criteria.
2. **Work** in the project folder as you normally would. Your session's PacedMind access covers your own task only: you can read, update your task's details and sub-tasks, and add new open tasks for follow-up work. Changing statuses (other than through `finish_task`), other tasks, flows or settings, and starting sessions, are left to the user.
   - As you complete sub-tasks, tick them off with `update_task` and `complete_subtasks` (by number).
   - When you find steps that are needed, add them with `add_subtasks`.
3. **Record follow-ups.** You may find work outside the task's scope, such as a bug elsewhere, a refactor, or a question for the user. Don't do it silently. Create a task for it with `create_task` in the same project, with a clear description, and mention it when you finish.
4. **Hand it back.** When the work is ready for the user to check, call `finish_task` with:
   - the task key;
   - the session id;
   - a one-line note on what changed, pointing to what the user should look at first.

   Then stop. The only exception is when `finish_task` tells you to continue with the next task in the same session; then call `start_task` for that task as instructed.

Things to avoid:

- **Don't mark your own task done.** The user does that after reviewing it, and it may start the next agent in the flow.
- **Don't change other tasks.** Leave their dates, priorities and projects alone, and don't delete anything in PacedMind. Those decisions belong to the user.
- **Still hand back when you're stuck.** If you can't finish because you're blocked or need a decision, call `finish_task` with a note explaining what's blocking. That way the user sees it instead of a session that looks busy forever.
