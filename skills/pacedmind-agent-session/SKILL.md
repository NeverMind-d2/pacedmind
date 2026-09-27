---
name: pacedmind-agent-session
description: How to work on a task that PacedMind (Organizer) handed to you as a coding or writing agent - pick it up with start_task, keep its sub-tasks current, record follow-up work, attach screenshots of the result, and hand it back with a report through finish_task. Use this skill whenever your first message mentions an Organizer or PacedMind task key and session id, or the user asks you to work on, pick up or continue a PacedMind task.
---

# Working on a PacedMind task

PacedMind started this session so that you do one task and then hand it back for the user's review. The user reviews it from your report in PacedMind, often without opening your terminal, so the report has to stand on its own. The tools come from the PacedMind MCP server, `organizer` (in Claude Code: `mcp__organizer__<tool>`).

1. **Pick it up.** Call `start_task` with the task key and the session id from your first message. It returns:
   - the changes the user asked for, if they reviewed your last hand-back and sent it back. They come first;
   - the task: its description, **Done when** list, sub-tasks and folder;
   - the last report, if the task was handed back before;
   - instructions for handing it back.

   The Done when items are your acceptance criteria. Your report answers each one.

   When the user asked for changes, make those changes. Don't start the task over, and don't reopen parts of it that they didn't mention. Then hand it back with a new report: start its summary with what you changed, answer every Done when item again, and attach new screenshots of what changed.
2. **Work** in the project folder as you normally would. Your session's PacedMind access covers your own task only: you can read, update your task's details and sub-tasks, attach images, and add new open tasks for follow-up work. Changing statuses (other than through `finish_task`), where your task runs, other tasks, flows or settings, and starting sessions, are left to the user.
   - As you complete sub-tasks, tick them off with `update_task` and `complete_subtasks` (by number).
   - When you find steps that are needed, add them with `add_subtasks`.
3. **Capture what can be seen.** When your work changes something visible, such as a page, a screen, a document or a chart, take screenshots of the result and attach them. See [Screenshots](#screenshots).
4. **Record follow-ups.** You may find work outside the task's scope, such as a bug elsewhere, a refactor, or a question for the user. Don't do it silently. Create a task for it with `create_task` in the same project, with a clear description and `done_when`, and list its key in your report.
5. **Hand it back.** When the work is ready for the user to check, call `finish_task` with the task key, the session id and a report:
   - `summary`: one or two sentences on what changed and what the user should look at first. Notifications show it.
   - `criteria`: an answer to each Done when item: its number as `item`, a `verdict` (`met`, `partly` or `not_met`) and a `note` on how you checked it or what's missing. Be honest. A `partly` with a clear note is worth more than a `met` the user disproves in a minute.
   - `images`: screenshots of the result, each with a caption.
   - `verify`: steps the user can follow to check the result: the command to run, the page to open, what to look for.
   - `questions`: decisions you need from the user.
   - `details`: anything longer, in Markdown: what you did and why, trade-offs, test results. For research or writing tasks, put the findings themselves here.
   - `links` to pull requests, commits or previews, and `follow_ups` with the keys of tasks you created.
   - `outcome`: `done` when everything asked for is ready, `partial` when only part of it is, `blocked` when you can't go on without the user. After a partial or blocked hand-back, the flow waits for the user instead of starting the next task.

   Then stop. The only exception is when `finish_task` tells you to continue with the next task in the same session; then call `start_task` for that task as instructed.

## Screenshots

`attach_image` (while you work) and the `images` of `finish_task` take the path of an image file on this computer: PNG, JPEG, GIF or WebP, up to 20 MB. PacedMind keeps its own copy. Save the files in the system temp folder, or delete them afterwards, so they don't end up in a commit.

Ways to take them:

- Your browser tools, if they can save a screenshot to a file, for example Playwright's `browser_take_screenshot` with a filename.
- For a web page, with no setup, Edge (or Chrome, with the same flags) in headless mode:

      "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --hide-scrollbars --window-size=1440,900 --virtual-time-budget=3000 --screenshot="C:\absolute\path\settings.png" http://localhost:3000/settings

  `--virtual-time-budget` gives the page three seconds to load its data. A taller `--window-size` shows more of a long page.
- `npx playwright screenshot --full-page <url> <file.png>` when Playwright is installed.

Show the result the way the user will see it: the page or screen that changed, at a normal window size, with realistic data. One or two good screenshots beat ten similar ones. For visual changes, a before and an after (take the before first) with captions that say which is which work well.

## Things to avoid

- **Don't mark your own task done.** The user does that after reviewing it, and it may start the next agent in the flow.
- **Don't change other tasks.** Leave their dates, priorities and projects alone, and don't delete anything in PacedMind. Those decisions belong to the user.
- **Still hand back when you're stuck.** If you can't finish because you're blocked or need a decision, call `finish_task` with outcome `blocked`, a summary of what's blocking, and the decision you need in `questions`. That way the user sees it instead of a session that looks busy forever.
