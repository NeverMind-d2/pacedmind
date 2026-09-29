import { TOOL_ICON_NAMES, TOOL_ICON_PATHS } from "./tool-icon-paths";

/** A server's or connector's name as the marks are looked up: letters and digits, lowercase, without "claude.ai". */
const keyOf = (name: string) => name.toLowerCase().replace(/^claude\.?ai[ _]/, "").replace(/[^a-z0-9]/g, "");

const NAMES = Object.keys(TOOL_ICON_NAMES);

/**
 * The brand an MCP server or connector belongs to, by its name: "Gmail", "github", "figma-console" (a brand's name
 * leading the server's), "mcp-server-supabase" (with MCP words around it). Null for one PacedMind has no mark for.
 */
export function toolBrand(name: string): string | null {
  const k = keyOf(name);
  if (TOOL_ICON_NAMES[k]) return TOOL_ICON_NAMES[k];
  const bare = k.replace(/^(mcp|mcpserver)/, "").replace(/(mcp|server|mcpserver)$/, "");
  if (TOOL_ICON_NAMES[bare]) return TOOL_ICON_NAMES[bare];
  let best = "";
  for (const n of NAMES) if (n.length >= 4 && n.length > best.length && bare.startsWith(n)) best = n;
  return best ? TOOL_ICON_NAMES[best] : null;
}

/** An MCP server's or connector's mark in the text's color, or its first letter in a small square for other names. */
export function ToolIcon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  const brand = toolBrand(name);
  if (brand) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} style={{ flex: "none" }}>
        <path d={TOOL_ICON_PATHS[brand]} />
      </svg>
    );
  }
  const letter = keyOf(name).charAt(0).toUpperCase() || "?";
  return (
    <span aria-hidden="true" className={`inline-flex items-center justify-center rounded-[3px] border border-current font-semibold leading-none ${className ?? ""}`}
      style={{ flex: "none", width: size, height: size, fontSize: Math.round(size * 0.6) }}>
      {letter}
    </span>
  );
}
