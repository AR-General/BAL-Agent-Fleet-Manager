import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import {
  contactChannels,
  contacts,
  fleetEvents,
  fleetMessages,
  instances,
  teamMembers,
  teams,
} from "../db/schema.js";
import type { AuthInstance, AuthUser } from "../middleware/auth.js";
import { encryptText, decryptText } from "../utils/crypto.js";
import { encryptGatewayToken } from "./gatewayToken.js";
import { instanceToPublic } from "../utils/instancePublic.js";
import { normalizeTls, parseInstanceTls } from "../utils/instanceTls.js";
import { defaultUrls, portsFromGatewayPort, portsFromSlot } from "../utils/ports.js";
import { classifyBotRuntime } from "./botRuntime.js";
import { buildRuntimeRegistration } from "./instanceRuntime.js";
import { config } from "../config.js";
import { broadcastTenantEvent } from "./chatWs.js";
import {
  roomCreate,
  roomDm,
  roomJoin,
  roomList,
  roomPost,
  roomReadHistory,
} from "./roomsService.js";
import { assertRoomAccess } from "./roomAcl.js";

export interface ToolContext {
  user?: AuthUser;
  instance?: AuthInstance;
  scopes?: string[];
}

export async function executeTool(
  tool: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<unknown> {
  switch (tool) {
    case "fleet_status":
      return fleetStatus(ctx);
    case "fleet_register":
      return fleetRegister(args, ctx);
    case "fleet_push_event":
      return fleetPushEvent(args, ctx);
    case "fleet_send_message":
      return fleetSendMessageBridged(args, ctx);
    case "fleet_check_inbox":
      return fleetCheckInbox(ctx);
    case "contacts_list":
      return contactsList(args, ctx);
    case "contacts_get":
      return contactsGet(args, ctx);
    case "chat_post_message":
      return roomPost(args, ctx);
    case "chat_list_sessions":
      return roomList(args, ctx);
    case "chat_read_history":
      return roomReadHistory(args, ctx);
    case "room_list":
      return roomList(args, ctx);
    case "room_create":
      return roomCreate(args, ctx);
    case "room_dm":
      return roomDm(args, ctx);
    case "room_post":
      return roomPost(args, ctx);
    case "room_read_history":
    case "room_get":
      return roomReadHistory(args, ctx);
    case "room_join":
      return roomJoin(args, ctx);
    case "workspace_link_files":
      return workspaceLinkFiles(args, ctx);
    case "teams_list":
      return teamsList(ctx);
    default:
      throw new Error(`unknown tool: ${tool}`);
  }
}

function tenantId(ctx: ToolContext): string {
  if (ctx.user) return ctx.user.tenantId;
  if (ctx.instance) return ctx.instance.tenantId;
  throw new Error("no auth context");
}

async function fleetStatus(ctx: ToolContext) {
  const db = getDb();
  const tid = tenantId(ctx);
  const rows = await db.select().from(instances).where(eq(instances.tenantId, tid));
  return {
    instances: rows.map((r) => ({
      slug: r.slug,
      health: r.health,
      status: r.status,
      ports: r.ports,
      last_seen: r.lastSeen,
      has_gateway_token: Boolean(r.gatewayTokenEncrypted),
    })),
    ts: new Date().toISOString(),
  };
}

async function fleetRegister(args: Record<string, unknown>, ctx: ToolContext) {
  const db = getDb();
  const slug = String(args.slug || ctx.instance?.slug || "");
  if (!slug) throw new Error("slug required");
  if (ctx.instance && ctx.instance.slug !== slug) {
    throw new Error("token may only register own slug");
  }
  const tid = tenantId(ctx);
  const identityIn = (args.identity as Record<string, unknown>) || {};
  const runtime = classifyBotRuntime(identityIn.runtime);
  const existing = await db.query.instances.findFirst({
    where: and(eq(instances.tenantId, tid), eq(instances.slug, slug)),
  });
  const tls = normalizeTls(
    (args.tls as import("../utils/instanceTls.js").InstanceTls | undefined) ??
      (existing ? parseInstanceTls(existing) : undefined),
  );

  let identity: Record<string, unknown> = identityIn;
  let ports: import("../utils/ports.js").InstancePorts;
  let host = String(args.host || config.defaultHost);
  let mergedUrls: Record<string, string>;

  if (runtime === "hermes" || runtime === "openai-like") {
    const built = buildRuntimeRegistration({
      runtime,
      host,
      ports: (args.ports || {}) as Record<string, unknown>,
      urls: (args.urls as Record<string, string>) || {},
      identity: identityIn,
      tls,
      apiBase: String(
        (args.urls as Record<string, string> | undefined)?.api_base || identityIn.api_base || "",
      ),
    });
    identity = built.identity;
    ports = built.ports;
    host = built.host;
    mergedUrls = built.urls;
  } else {
    const rawPorts = (args.ports || {}) as Record<string, unknown>;
    const slot = Number(rawPorts.slot ?? args.port_slot ?? identityIn.port_slot ?? 0);
    const gatewayPort = Number(rawPorts.gateway ?? args.port);
    if (
      rawPorts.bridge ||
      rawPorts.https ||
      rawPorts.bridge_https ||
      rawPorts.signal ||
      rawPorts.twilio ||
      rawPorts.ollama
    ) {
      const base = portsFromSlot(slot);
      const https = Number(rawPorts.https ?? base.https);
      ports = {
        ...base,
        slot: Number(rawPorts.slot ?? slot),
        gateway: Number(rawPorts.gateway ?? base.gateway),
        bridge: Number(rawPorts.bridge ?? base.bridge),
        https,
        bridge_https: Number(rawPorts.bridge_https ?? https + 1),
        signal: Number(rawPorts.signal ?? base.signal),
        twilio: Number(rawPorts.twilio ?? base.twilio),
        ollama: rawPorts.ollama != null ? Number(rawPorts.ollama) : base.ollama,
      };
    } else if (typeof gatewayPort === "number" && gatewayPort > 0) {
      ports = portsFromGatewayPort(gatewayPort, slot);
    } else {
      ports = portsFromSlot(slot);
    }
    host = String(args.host || config.defaultHost);
    mergedUrls = {
      ...defaultUrls(host, ports, { gatewayHttps: tls.gateway_https }),
      ...((args.urls as Record<string, string>) || {}),
    };
    identity = {
      ...identityIn,
      runtime: "openclaw",
      health_path: identityIn.health_path || "/healthz",
    };
  }

  const gwToken = String(args.gateway_token || "").trim();
  const payload: typeof instances.$inferInsert = {
    tenantId: tid,
    slug,
    identity,
    ports: ports as Record<string, unknown>,
    host,
    urls: mergedUrls,
    channels: (args.channels as Record<string, unknown>) || {},
    tls: tls as Record<string, unknown>,
    status: "registered",
    lastSeen: new Date(),
    registeredAt: existing?.registeredAt || new Date(),
    ...(gwToken ? { gatewayTokenEncrypted: encryptGatewayToken(gwToken) } : {}),
  };
  if (existing) {
    await db.update(instances).set(payload).where(eq(instances.id, existing.id));
    const row = await db.query.instances.findFirst({ where: eq(instances.id, existing.id) });
    return { ok: true, instance: instanceToPublic(row!) };
  }
  const [created] = await db.insert(instances).values(payload).returning();
  return { ok: true, instance: instanceToPublic(created) };
}

async function fleetPushEvent(args: Record<string, unknown>, ctx: ToolContext) {
  if (!ctx.instance) throw new Error("instance auth required");
  const db = getDb();
  const tags = Array.isArray(args.tags)
    ? (args.tags as unknown[]).map((t) => String(t).toLowerCase())
    : args.tag
      ? [String(args.tag).toLowerCase()]
      : [];
  const summary = args.summary != null ? String(args.summary) : "";
  const dataObj = (args.data as Record<string, unknown>) || {};
  const mentionSlugs = Array.isArray(args.mention_slugs)
    ? (args.mention_slugs as unknown[]).map((s) => String(s))
    : [];
  const mentionIds: string[] = [];
  for (const slug of mentionSlugs) {
    const inst = await db.query.instances.findFirst({
      where: and(eq(instances.slug, slug), eq(instances.tenantId, ctx.instance.tenantId)),
    });
    if (inst) mentionIds.push(inst.id);
  }
  const summaryEnc = summary ? encryptText(summary) : null;
  const dataEnc = encryptText(JSON.stringify(dataObj));
  const [ev] = await db
    .insert(fleetEvents)
    .values({
      tenantId: ctx.instance.tenantId,
      instanceId: ctx.instance.id,
      eventType: String(args.type || args.event_type || "event"),
      tags,
      summaryEncrypted: summaryEnc?.encrypted,
      summaryIv: summaryEnc?.iv,
      dataEncrypted: dataEnc.encrypted,
      dataIv: dataEnc.iv,
      data: dataObj,
      mentionInstanceIds: mentionIds,
    })
    .returning();
  await db
    .update(instances)
    .set({ lastSeen: new Date() })
    .where(eq(instances.id, ctx.instance.id));

  broadcastTenantEvent(ctx.instance.tenantId, {
    type: "fleet_event",
    event: {
      id: ev.id,
      instance_id: ctx.instance.id,
      instance_slug: ctx.instance.slug,
      event_type: ev.eventType,
      tags,
      summary,
      data: dataObj,
      mention_slugs: mentionSlugs,
      created_at: ev.createdAt,
    },
  });
  return { ok: true, event_id: ev.id };
}

async function fleetSendMessageBridged(args: Record<string, unknown>, ctx: ToolContext) {
  if (!ctx.instance) throw new Error("instance auth required");
  const body = String(args.body || "");
  if (!body) throw new Error("body required");
  if (args.to_slug) {
    const dm = await roomDm({ to_slug: args.to_slug }, ctx);
    const session = (dm as { session: { id: string } }).session;
    return roomPost({ session_id: session.id, message: body }, ctx);
  }
  return fleetSendMessage(args, ctx);
}

async function fleetSendMessage(args: Record<string, unknown>, ctx: ToolContext) {
  if (!ctx.instance) throw new Error("instance auth required");
  const body = String(args.body || "");
  if (!body) throw new Error("body required");
  const db = getDb();
  let toInstanceId: string | null = null;
  let toContactId: string | null = null;
  if (args.to_slug) {
    const target = await db.query.instances.findFirst({
      where: eq(instances.slug, String(args.to_slug)),
    });
    if (!target) throw new Error("target instance not found");
    toInstanceId = target.id;
  }
  if (args.to_contact_slug) {
    const c = await db.query.contacts.findFirst({
      where: and(eq(contacts.tenantId, ctx.instance.tenantId), eq(contacts.slug, String(args.to_contact_slug))),
    });
    if (!c || !c.allowContact) throw new Error("contact not found or not allowed");
    toContactId = c.id;
    if (c.linkedInstanceId) toInstanceId = c.linkedInstanceId;
  }
  const { encrypted, iv } = encryptText(body);
  const [msg] = await db
    .insert(fleetMessages)
    .values({
      fromInstanceId: ctx.instance.id,
      toInstanceId,
      toContactId,
      channel: String(args.channel || "oc-controller"),
      bodyEncrypted: encrypted,
      bodyIv: iv,
      status: "pending",
    })
    .returning();
  // Mark delivered when read via inbox path later; keep pending for pollers
  return { ok: true, message: { id: msg.id, status: msg.status } };
}

async function fleetCheckInbox(ctx: ToolContext) {
  if (!ctx.instance) throw new Error("instance auth required");
  const db = getDb();
  const rows = await db
    .select()
    .from(fleetMessages)
    .where(
      and(eq(fleetMessages.toInstanceId, ctx.instance.id), eq(fleetMessages.status, "pending")),
    );
  const messages = rows.map((m) => {
    let body = "";
    if (m.bodyEncrypted && m.bodyIv) {
      try {
        body = decryptText(m.bodyEncrypted as Buffer, m.bodyIv as Buffer);
      } catch {
        body = "[encrypted]";
      }
    }
    return { id: m.id, from_instance_id: m.fromInstanceId, body, channel: m.channel, created_at: m.createdAt };
  });
  // Mark delivered
  for (const m of rows) {
    await db
      .update(fleetMessages)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(eq(fleetMessages.id, m.id));
  }
  // Also surface unread agent_dm rooms via room_list
  const rooms = await roomList({ origin: "agent_dm", status: "active" }, ctx);
  return { messages, rooms: (rooms as { sessions: unknown[] }).sessions };
}

async function contactsList(args: Record<string, unknown>, ctx: ToolContext) {
  const db = getDb();
  const tid = tenantId(ctx);
  const rows = await db.select().from(contacts).where(eq(contacts.tenantId, tid));
  return {
    contacts: rows
      .filter((c) => {
        if (args.external === true && !c.isExternal) return false;
        if (args.kind && c.contactKind !== args.kind) return false;
        return true;
      })
      .map((c) => ({
        slug: c.slug,
        display_name: c.displayName,
        kind: c.contactKind,
        external: c.isExternal,
        allow_contact: c.allowContact,
      })),
  };
}

async function contactsGet(args: Record<string, unknown>, ctx: ToolContext) {
  const db = getDb();
  const tid = tenantId(ctx);
  const c = await db.query.contacts.findFirst({
    where: and(eq(contacts.tenantId, tid), eq(contacts.slug, String(args.slug))),
  });
  if (!c) throw new Error("not found");
  const ch = await db.select().from(contactChannels).where(eq(contactChannels.contactId, c.id));
  return { contact: c, channels: ch };
}

async function workspaceLinkFiles(args: Record<string, unknown>, ctx: ToolContext) {
  const paths = Array.isArray(args.paths) ? (args.paths as unknown[]).map(String) : [];
  if (!paths.length) throw new Error("paths required");
  const sessionId = String(args.session_id || "");
  if (!sessionId) throw new Error("session_id required");
  await assertRoomAccess(sessionId, ctx);
  const title = args.title ? String(args.title) : "Linked files";
  const body = `${title}\n\n${paths.map((p) => `- [file:${p}](${p})`).join("\n")}`;
  const result = await roomPost(
    {
      session_id: sessionId,
      message: body,
    },
    ctx,
  );
  return { ...result as object, paths };
}

async function teamsList(ctx: ToolContext) {
  const db = getDb();
  const tid = tenantId(ctx);
  const teamRows = await db.select().from(teams).where(eq(teams.tenantId, tid));
  const result = [];
  for (const t of teamRows) {
    const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, t.id));
    result.push({ ...t, members });
  }
  return { teams: result };
}
