import type { RemoteStart } from "./types";

/*
 * The words for a computer's two settings for sessions asked for from elsewhere (the web app, another computer): what it
 * does with them (RemoteStart) and whether asking takes a two-factor code (remoteCode). Each computer changes both only
 * in its own desktop app (device.ts); Settings, the Computers page and the "Run on a computer" sheet show them.
 */

export const REMOTE_START_LABEL: Record<RemoteStart, string> = { off: "Refuse", ask: "Ask me", auto: "Start" };

export const REMOTE_START_OPTIONS: { value: RemoteStart; label: string }[] =
  (["off", "ask", "auto"] as const).map((value) => ({ value, label: REMOTE_START_LABEL[value] }));

/** Whether asking takes a code, in a word or two, as the Computers page shows it. */
export const remoteCodeLabel = (code: boolean) => (code ? "Code needed" : "No code needed");

/**
 * What a computer does with sessions asked for from the web app or another computer, in a sentence or three: `here` said
 * on that computer itself, `there` of another one.
 */
export function fromElsewhereText(start: RemoteStart, code: boolean, where: "here" | "there"): string {
  const place = where === "here" ? "here" : "there";
  const what = "Sessions asked for from the web app or another computer";
  if (start === "off") return `${what} are refused${where === "here" ? "" : " there"}.`;
  const does = start === "ask"
    ? `${what} wait ${place} until you allow them.`
    : `${what} start ${place} right away, except those in the agent's cloud, which wait for you ${place}.`;
  if (code) return `${does} Asking takes a current two-factor code.`;
  if (where === "there") return `${does} Asking takes no code.`;
  return start === "ask"
    ? `${does} Asking takes no code: any browser or computer signed in to your account can ask.`
    : `${does} Asking takes no code, so any browser or computer signed in to your account can start an agent here without you. Keep that for a computer whose project folders you'd let an agent work in alone.`;
}
