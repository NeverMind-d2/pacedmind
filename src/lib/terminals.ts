import type { TerminalId } from "./types";

type Terminal = TerminalId;

/** The terminals agent sessions can open in, by system; the first is each system's default. */
export const TERMINALS: Partial<Record<NodeJS.Platform, { value: Terminal; label: string }[]>> = {
  win32: [{ value: "wt", label: "Windows Terminal" }, { value: "cmd", label: "Command Prompt" }],
  darwin: [{ value: "terminal", label: "Terminal" }, { value: "iterm", label: "iTerm" }],
};

/**
 * The terminal sessions open in on this system: the saved choice when it's one of this system's,
 * otherwise the system's default (a new database says "wt", which on a Mac means Terminal).
 */
export function terminalFor(saved: Terminal, platform: NodeJS.Platform): { value: Terminal; label: string } {
  const options = TERMINALS[platform];
  if (!options) return { value: saved, label: "the default terminal" };
  return options.find((o) => o.value === saved) ?? options[0];
}
