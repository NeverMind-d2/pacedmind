import type { Area, Project } from "./types";

/** Muted colors for areas and projects, clear enough to tell apart. They carry identity only, never state. */
export const PALETTE: { name: string; value: string }[] = [
  { name: "Blue", value: "#6A8DC3" },
  { name: "Teal", value: "#68AAB9" },
  { name: "Green", value: "#70B192" },
  { name: "Olive", value: "#9EAC6B" },
  { name: "Sand", value: "#C8A565" },
  { name: "Clay", value: "#C88765" },
  { name: "Rose", value: "#B97C97" },
  { name: "Violet", value: "#9485C0" },
  { name: "Mauve", value: "#9E83B7" },
  { name: "Gray", value: "#8E8E95" },
];

/**
 * The palette's earlier, paler values, each with the color it became. The data moved over once (local-db.ts
 * and supabase/migrations); an older file brought into an account moves over as it's imported (account.ts).
 */
export const EARLIER_PALETTE: Record<string, string> = {
  "#7D93B5": "#6A8DC3", "#7AA3AD": "#68AAB9", "#7FA894": "#70B192", "#9AA37A": "#9EAC6B", "#B8A27A": "#C8A565",
  "#B88F7A": "#C88765", "#B08A9B": "#B97C97", "#9C93B8": "#9485C0", "#A08FB0": "#9E83B7",
};

/** A saved color in today's palette: an earlier palette color becomes the one it turned into, any other stays. */
export const renewColor = (hex: string) => EARLIER_PALETTE[hex.toUpperCase()] ?? hex;

export const FALLBACK_COLOR = "#85858C";

/** A project's own color, or its area's color when it has none. */
export function projectColor(p: Pick<Project, "color" | "areaId">, areas: Pick<Area, "id" | "color">[]): string {
  return p.color ?? areas.find((a) => a.id === p.areaId)?.color ?? FALLBACK_COLOR;
}

/** The first palette color not used yet, so new areas and projects look distinct. */
export function nextColor(used: (string | null)[]): string {
  const taken = new Set(used.filter(Boolean).map((c) => c!.toUpperCase()));
  return (PALETTE.find((c) => !taken.has(c.value.toUpperCase())) ?? PALETTE[used.length % PALETTE.length]).value;
}
