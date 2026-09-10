export interface ToolDefinition {
  name: string;
  description: string;
  scopes: string[];
  parameters: Record<string, unknown>;
}

export const FLEET_TOOLS: ToolDefinition[] = [
  {
    name: "fleet_status",
    description: "List registered OpenClaw instances with health summary",
    scopes: ["fleet:read", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "fleet_register",
    description: "Register or update this instance in the fleet",
    scopes: ["fleet:write", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        slug: { type: "string" },
        identity: { type: "object" },
        ports: { type: "object" },
        host: { type: "string" },
        urls: { type: "object" },
        channels: { type: "object" },
        gateway_token: {
          type: "string",
          description: "OpenClaw gateway bearer token (stored encrypted; not returned in API)",
        },
      },
    },
  },
  {
    name: "fleet_push_event",
    description: "Push a tagged fleet event (optional mention_slugs). Summary/data stored encrypted.",
    scopes: ["events:push", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        type: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
        data: { type: "object" },
        mention_slugs: { type: "array", items: { type: "string" } },
      },
      required: ["type"],
    },
  },
  {
    name: "fleet_send_message",
    description: "Send a message to another instance or contact",
    scopes: ["messages:send", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        to_slug: { type: "string" },
        to_contact_slug: { type: "string" },
        body: { type: "string" },
        channel: { type: "string" },
      },
      required: ["body"],
    },
  },
  {
    name: "fleet_check_inbox",
    description: "List pending inbox messages for this instance",
    scopes: ["fleet:read", "tools:invoke"],
    parameters: { type: "object", properties: {} },
  },
  {
    name: "contacts_list",
    description: "List tenant contacts (respects allow_contact for outbound)",
    scopes: ["contacts:read", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["human", "ai_agent"] },
        external: { type: "boolean" },
      },
    },
  },
  {
    name: "contacts_get",
    description: "Get one contact by slug with channels",
    scopes: ["contacts:read", "tools:invoke"],
    parameters: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "chat_post_message",
    description: "Post a message to a group or direct chat session",
    scopes: ["chat:post", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        message: { type: "string" },
      },
      required: ["session_id", "message"],
    },
  },
  {
    name: "chat_list_sessions",
    description: "List chat sessions where caller is a participant",
    scopes: ["chat:read", "tools:invoke"],
    parameters: { type: "object", properties: {} },
  },
  {
    name: "chat_read_history",
    description: "Read paginated messages for a session",
    scopes: ["chat:read", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        limit: { type: "number" },
        since: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "teams_list",
    description: "List teams and members",
    scopes: ["fleet:read", "tools:invoke"],
    parameters: { type: "object", properties: {} },
  },
  {
    name: "room_list",
    description: "List channels / DMs the caller can access",
    scopes: ["chat:read", "rooms:read", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string" },
        status: { type: "string" },
        slug: { type: "string" },
      },
    },
  },
  {
    name: "room_create",
    description: "Create a named channel or group room",
    scopes: ["chat:post", "rooms:write", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        slug: { type: "string" },
        origin: { type: "string" },
        participant_slugs: { type: "array", items: { type: "string" } },
        reply_policy: { type: "string" },
      },
    },
  },
  {
    name: "room_dm",
    description: "Find or create a private DM room with another fleet member",
    scopes: ["messages:send", "rooms:write", "tools:invoke"],
    parameters: {
      type: "object",
      properties: { to_slug: { type: "string" } },
      required: ["to_slug"],
    },
  },
  {
    name: "room_post",
    description: "Post a message to a room by session_id or slug",
    scopes: ["chat:post", "rooms:write", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        slug: { type: "string" },
        message: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "room_read_history",
    description: "Read room message history",
    scopes: ["chat:read", "rooms:read", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        slug: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "workspace_link_files",
    description: "Attach workspace file path links into a chat room",
    scopes: ["chat:post", "workspace:write", "tools:invoke"],
    parameters: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        paths: { type: "array", items: { type: "string" } },
        title: { type: "string" },
      },
      required: ["session_id", "paths"],
    },
  },
];

export function toolsForScopes(scopes: string[]): ToolDefinition[] {
  return FLEET_TOOLS.filter((t) =>
    t.scopes.some((s) => scopes.includes(s) || scopes.includes("tools:invoke")),
  );
}

/** Enforce that caller may invoke this tool. throws if denied. */
export function assertToolScope(toolName: string, scopes: string[]): void {
  const def = FLEET_TOOLS.find((t) => t.name === toolName);
  if (!def) throw new Error(`unknown tool: ${toolName}`);
  const ok = def.scopes.some((s) => scopes.includes(s) || scopes.includes("tools:invoke"));
  if (!ok) {
    throw new Error(`missing scope for tool ${toolName}`);
  }
}

export function openAiToolSchemas(scopes: string[]): Array<Record<string, unknown>> {
  return toolsForScopes(scopes).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
