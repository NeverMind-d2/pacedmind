import type { Area, Project } from "./types";

/** Muted colors for areas and projects. They carry identity only, never state. */
export const PALETTE: { name: string; value: string }[] = [
  { name: "Blue", value: "#7D93B5" },
  { name: "Teal", value: "#7AA3AD" },
  { name: "Green", value: "#7FA894" },
  { name: "Olive", value: "#9AA37A" },
  { name: "Sand", value: "#B8A27A" },
  { name: "Clay", value: "#B88F7A" },
  { name: "Rose", value: "#B08A9B" },
  { name: "Violet", value: "#9C93B8" },
  { name: "Mauve", value: "#A08FB0" },
  { name: "Gray", value: "#8E8E95" },
];

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
