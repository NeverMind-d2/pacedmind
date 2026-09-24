import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAgentTools } from "./agents";
import { registerCalendarTools } from "./calendar";
import { registerPlanningTools } from "./planning";

/** Every tool of the PacedMind MCP server, registered in the order clients list them. */
export function registerTools(server: McpServer) {
  registerPlanningTools(server);
  registerCalendarTools(server);
  registerAgentTools(server);
}

/** Sent to every client on connect; the skills in skills/ go into more detail. */
export const SERVER_INSTRUCTIONS = `PacedMind is the user's personal planner. Areas (like Work or Personal) hold projects; a task lives in a project, in an area, or in the Inbox. The calendar has fixed events, and an auto-planner fills free work time with focus blocks. Agent sessions (Claude Code or Codex) work on tasks and report back.

- Call get_overview first: it gives the current date and time and the ids of areas and projects.
- Refer to tasks by key (WRK-12), to projects by id or name, to areas by id, name or key.
- Dates accept YYYY-MM-DD, YYYY-MM-DDTHH:mm or phrases like "tomorrow 9:00" or "next friday". Results show the date that was used; check it.
- "planned" is the day the user means to work on a task, "due" is its deadline. Priorities: urgent, high, medium, low, none.
- Give tasks descriptions with enough context to act on them later.
- Ask the user before deleting anything or starting agent sessions.
- If PacedMind started you on a task (your first message names a task and a session), call start_task first and finish_task when the work is ready for review. Never mark your own task done.`;
