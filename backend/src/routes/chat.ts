import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { chatSessionParticipants, chatSessions, fleetEvents, instances } from "../db/schema.js";
import { requireJwt, requireJwtOrInstance } from "../middleware/auth.js";
import { RoomAccessError, assertRoomAccess } from "../services/roomAcl.js";
import { roomCreate, roomJoin, roomList, roomPost, roomReadHistory } from "../services/roomsService.js";
import { stopAgentGeneration, stopSessionGeneration } from "../services/chatOrchestrator.js";
import { snapshotForClient } from "../services/sessionLiveState.js";
import { isViewport3dActive, setViewport3dActive, setViewportOccupants, getViewportOccupants } from "../services/viewportSession.js";
import { normalizeOccupantPoses } from "../services/sceneOccupancy.js";
import { incMetric } from "../utils/metrics.js";
import { clampMaxAgentAutoTurns } from "../services/chatReplyTargets.js";
import { clampMaxToolCalls } from "../services/chatToolCalls.js";
import {
  ParticipantActionError,
  addSessionParticipant,
  patchSessionParticipant,
  removeSessionParticipant,
  sessionTokenUsage,
} from "../services/participantActions.js";

const router = Router();

router.get("/sessions", requireJwt, async (req, res) => {
  try {
    const result = await roomList(
      {
        status: req.query.status,
        origin: req.query.origin,
        slug: req.query.slug,
      },
      { user: req.user },
    );
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

const sessionSchema = z.object({
  title: z.string().optional(),
  session_type: z.enum(["direct", "group"]).default("direct"),
  participant_instance_slugs: z.array(z.string()).optional(),
  participant_slugs: z.array(z.string()).optional(),
  model_id: z.string().optional(),
  origin: z.enum(["human", "agent_dm", "named_channel", "event_mention"]).optional(),
  slug: z.string().optional(),
  reply_policy: z.enum(["human_only", "mentioned_only", "off"]).optional(),
});

router.post("/sessions", requireJwt, async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await roomCreate(
      {
        ...parsed.data,
        participant_slugs:
          parsed.data.participant_slugs || parsed.data.participant_instance_slugs || [],
      },
      { user: req.user },
    );
    res.status(201).json(result.session);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch("/sessions/:id", requireJwt, async (req, res) => {
  const parsed = z
    .object({
      status: z.enum(["active", "archived"]).optional(),
      pinned: z.boolean().optional(),
      title: z.string().optional(),
      model_id: z.string().optional(),
      reply_policy: z.enum(["human_only", "mentioned_only", "off"]).optional(),
      primary_instance_id: z.string().uuid().nullable().optional(),
      primary_slug: z.string().optional(),
      max_agent_auto_turns: z.number().int().optional(),
      max_tool_calls: z.number().int().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const id = routeParam(req.params.id);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.pinned !== undefined) patch.pinned = parsed.data.pinned;
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.model_id !== undefined) patch.modelId = parsed.data.model_id;
  if (parsed.data.reply_policy !== undefined) patch.replyPolicy = parsed.data.reply_policy;
  if (parsed.data.max_agent_auto_turns !== undefined) {
    patch.maxAgentAutoTurns = clampMaxAgentAutoTurns(parsed.data.max_agent_auto_turns);
  }
  if (parsed.data.max_tool_calls !== undefined) {
    patch.maxToolCalls = clampMaxToolCalls(parsed.data.max_tool_calls);
  }

  if (parsed.data.primary_instance_id !== undefined || parsed.data.primary_slug !== undefined) {
    let primaryId = parsed.data.primary_instance_id ?? null;
    if (parsed.data.primary_slug) {
      const inst = await db.query.instances.findFirst({
        where: and(
          eq(instances.slug, parsed.data.primary_slug),
          eq(instances.tenantId, req.user!.tenantId),
        ),
      });
      if (!inst) {
        res.status(400).json({ error: "primary_slug not found" });
        return;
      }
      primaryId = inst.id;
    }
    if (primaryId) {
      const part = await db.query.chatSessionParticipants.findFirst({
        where: and(
          eq(chatSessionParticipants.sessionId, id),
          eq(chatSessionParticipants.instanceId, primaryId),
          eq(chatSessionParticipants.participantType, "instance"),
        ),
      });
      if (!part) {
        res.status(400).json({ error: "primary_instance_id is not a participant of this session" });
        return;
      }
    }
    patch.primaryInstanceId = primaryId;
  }

  const [row] = await db
    .update(chatSessions)
    .set(patch)
    .where(and(eq(chatSessions.id, id), eq(chatSessions.tenantId, req.user!.tenantId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(row);
});

router.get("/sessions/:id/usage", requireJwt, async (req, res) => {
  const id = routeParam(req.params.id);
  try {
    await assertRoomAccess(id, { user: req.user });
    const usage = await sessionTokenUsage({ sessionId: id, tenantId: req.user!.tenantId });
    res.json(usage);
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    if (e instanceof ParticipantActionError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/sessions/:id/participants", requireJwt, async (req, res) => {
  const parsed = z.object({ slug: z.string().trim().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const id = routeParam(req.params.id);
  try {
    await assertRoomAccess(id, { user: req.user });
    const result = await addSessionParticipant({
      sessionId: id,
      slug: parsed.data.slug,
      tenantId: req.user!.tenantId,
    });
    res.status(201).json(result);
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    if (e instanceof ParticipantActionError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch("/sessions/:id/participants/:slug", requireJwt, async (req, res) => {
  const parsed = z
    .object({
      paused: z.boolean().optional(),
      model_id: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const id = routeParam(req.params.id);
  const slug = routeParam(req.params.slug);
  try {
    await assertRoomAccess(id, { user: req.user });
    const result = await patchSessionParticipant({
      sessionId: id,
      slug,
      tenantId: req.user!.tenantId,
      paused: parsed.data.paused,
      modelId: parsed.data.model_id,
    });
    if (parsed.data.paused === true) {
      stopAgentGeneration(id, slug);
    }
    res.json(result);
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    if (e instanceof ParticipantActionError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete("/sessions/:id/participants/:slug", requireJwt, async (req, res) => {
  const id = routeParam(req.params.id);
  const slug = routeParam(req.params.slug);
  try {
    await assertRoomAccess(id, { user: req.user });
    stopAgentGeneration(id, slug);
    const result = await removeSessionParticipant({
      sessionId: id,
      slug,
      tenantId: req.user!.tenantId,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    if (e instanceof ParticipantActionError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/sessions/:id/join", requireJwt, async (req, res) => {
  try {
    const result = await roomJoin({ session_id: routeParam(req.params.id) }, { user: req.user });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/sessions/:id/stop", requireJwt, async (req, res) => {
  const ok = stopSessionGeneration(routeParam(req.params.id));
  res.json({ ok, stopped: ok });
});

router.post("/sessions/:id/stop/:slug", requireJwt, async (req, res) => {
  const sessionId = routeParam(req.params.id);
  const slug = routeParam(req.params.slug);
  try {
    await assertRoomAccess(sessionId, { user: req.user });
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    return;
  }
  const aborted = stopAgentGeneration(sessionId, slug);
  res.json({ ok: true, aborted, slug });
});

/** In-memory generation snapshot for WS reconnect / UI recovery. */
router.get("/sessions/:id/live", requireJwt, async (req, res) => {
  try {
    const id = routeParam(req.params.id);
    await assertRoomAccess(id, { user: req.user });
    res.json(snapshotForClient(id));
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Mark whether the 3D viewport is open so Hermes gets compact motion context. */
router.put("/sessions/:id/viewport", requireJwt, async (req, res) => {
  const parsed = z
    .object({
      active: z.boolean(),
      occupants: z
        .array(
          z.object({
            slug: z.string().min(1),
            x: z.number(),
            z: z.number(),
            facing: z.number(),
            present: z.boolean(),
          }),
        )
        .max(32)
        .optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const id = routeParam(req.params.id);
  try {
    await assertRoomAccess(id, { user: req.user });
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    return;
  }
  setViewport3dActive(id, parsed.data.active);
  if (parsed.data.active && parsed.data.occupants) {
    const occupants = normalizeOccupantPoses(parsed.data.occupants);
    setViewportOccupants(id, occupants);
    incMetric("oc_scene_occupants_updates_total", "3D occupant snapshots posted for Hermes");
  }
  res.json({ ok: true, active: isViewport3dActive(id) });
});

router.get("/sessions/:id/viewport", requireJwt, async (req, res) => {
  const id = routeParam(req.params.id);
  try {
    await assertRoomAccess(id, { user: req.user });
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    return;
  }
  incMetric("oc_scene_viewport_reads_total", "3D viewport pose restores");
  res.json({
    active: isViewport3dActive(id),
    occupants: getViewportOccupants(id),
  });
});

router.get("/sessions/:id/messages", requireJwtOrInstance, async (req, res) => {
  try {
    const result = await roomReadHistory(
      { session_id: routeParam(req.params.id), limit: req.query.limit },
      { user: req.user, instance: req.authInstance },
    );
    res.json(result);
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/sessions/:id/messages", requireJwtOrInstance, async (req, res) => {
  const parsed = z.object({ message: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const result = await roomPost(
      { session_id: routeParam(req.params.id), message: parsed.data.message },
      { user: req.user, instance: req.authInstance },
    );
    res.json(result);
  } catch (e) {
    if (e instanceof RoomAccessError) {
      res.status(403).json({ error: e.message });
      return;
    }
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Mention reply: create idempotent event_mention room and post first message. */
router.post("/events/:eventId/reply", requireJwtOrInstance, async (req, res) => {
  const parsed = z.object({ message: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const eventId = routeParam(req.params.eventId);
  const ev = await db.query.fleetEvents.findFirst({ where: eq(fleetEvents.id, eventId) });
  if (!ev) {
    res.status(404).json({ error: "event not found" });
    return;
  }
  const tid = req.user?.tenantId || req.authInstance?.tenantId;
  if (!tid || (ev.tenantId && ev.tenantId !== tid)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  const existing = await db.query.chatSessions.findFirst({
    where: and(
      eq(chatSessions.relatedEventId, eventId),
      eq(chatSessions.origin, "event_mention"),
      req.authInstance
        ? eq(chatSessions.createdByInstanceId, req.authInstance.id)
        : eq(chatSessions.createdByUserId, req.user!.id),
    ),
  });
  let session = existing;
  if (!session) {
    const emitter = await db.query.instances.findFirst({ where: eq(instances.id, ev.instanceId) });
    const created = await roomCreate(
      {
        title: `Re: ${ev.eventType}`,
        origin: "event_mention",
        session_type: "direct",
        related_event_id: eventId,
        participant_slugs: emitter ? [emitter.slug] : [],
        reply_policy: "human_only",
      },
      { user: req.user, instance: req.authInstance },
    );
    session = created.session;
    await db
      .update(fleetEvents)
      .set({ relatedSessionId: session.id })
      .where(eq(fleetEvents.id, eventId));
  }

  const post = await roomPost(
    { session_id: session.id, message: parsed.data.message },
    { user: req.user, instance: req.authInstance },
  );
  res.json({ session, ...post });
});

export default router;
