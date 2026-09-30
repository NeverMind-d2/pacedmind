import type { McpServer } from "@modelcontextprotocol/server";

/** The effect a tool can have, including the most powerful option in its input schema. */
export type ToolKind = "read" | "create" | "write" | "delete" | "launch";

export function toolMetadata(title: string, kind: ToolKind, hosted: boolean, openWorld = false) {
  return {
    annotations: {
      title,
      readOnlyHint: kind === "read",
      // Updating can replace existing text or remove items too. Additive tools opt into "create".
      destructiveHint: kind === "write" || kind === "delete" || kind === "launch",
      idempotentHint: kind === "read",
      openWorldHint: openWorld || kind === "launch",
    },
    // Mirror for clients that read extension metadata. Supabase grants
    // account access through consent + RLS; there are no separate planner OAuth scopes.
    ...(hosted ? { _meta: { securitySchemes: [{ type: "oauth2", scopes: [] as string[] }] } } : {}),
  };
}
type Descriptor = ReturnType<typeof toolMetadata> & { name: string; title: string; description: string };
const descriptors = new WeakMap<McpServer, Descriptor[]>();

export function rememberHostedTool(server: McpServer, descriptor: Descriptor) {
  const list = descriptors.get(server) ?? [];
  list.push(descriptor);
  descriptors.set(server, list);
}

/**
 * SDK 2.1 drops unknown top-level tool fields. Use its public list handler and schema exporter to
 * preserve OpenAI's securitySchemes alongside the compatibility mirror. Only tools actually
 * registered for this request are collected, after the hosted/session allowlists have run.
 */
export function registerHostedToolList(server: McpServer) {
  const list = descriptors.get(server);
  if (!list) return;
  server.server.setRequestHandler("tools/list", () => ({
    tools: list.map((descriptor) => ({
      ...descriptor,
      inputSchema: { ...server.toolInputSchemaJson(descriptor.name), type: "object" as const },
      securitySchemes: descriptor._meta!.securitySchemes,
    })),
  }));
}
