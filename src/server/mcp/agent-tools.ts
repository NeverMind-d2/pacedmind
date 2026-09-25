/**
 * MCP tools that sessions started by PacedMind may use without asking: reading, the session protocol
 * (start_task, attach_image, finish_task) and adding or updating tasks. Anything that deletes, moves the
 * calendar, changes projects or starts other sessions still asks the user in the terminal.
 */
export const AGENT_ALLOWED_TOOLS = [
  "get_overview",
  "list_areas",
  "list_projects",
  "get_project",
  "list_tasks",
  "get_task",
  "list_events",
  "get_agenda",
  "get_flow",
  "list_sessions",
  "get_settings",
  "get_next_task",
  "start_task",
  "attach_image",
  "finish_task",
  "create_task",
  "update_task",
] as const;
