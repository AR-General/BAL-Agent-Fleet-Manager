import { and, eq, or } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { chatSessionParticipants, chatSessions } from "../db/schema.js";
import type { AuthInstance, AuthUser } from "../middleware/auth.js";

export class RoomAccessError extends Error {
  constructor(message = "room access denied") {
    super(message);
    this.name = "RoomAccessError";
  }
}

/** True if caller may read/post in the session. */
export async function assertRoomAccess(
  sessionId: string,
  ctx: { user?: AuthUser; instance?: AuthInstance },
): Promise<typeof chatSessions.$inferSelect> {
  const db = getDb();
  const session = await db.query.chatSessions.findFirst({
    where: eq(chatSessions.id, sessionId),
  });
  if (!session) throw new RoomAccessError("session not found");

  const tid = ctx.user?.tenantId ?? ctx.instance?.tenantId;
  if (!tid || session.tenantId !== tid) {
    throw new RoomAccessError("session not found");
  }

  if (ctx.user?.role === "admin" || ctx.user?.role === "operator") {
    return session;
  }

  if (ctx.user) {
    const part = await db.query.chatSessionParticipants.findFirst({
      where: and(
        eq(chatSessionParticipants.sessionId, sessionId),
        eq(chatSessionParticipants.userId, ctx.user.id),
      ),
    });
    if (!part) throw new RoomAccessError("not a participant");
    return session;
  }

  if (ctx.instance) {
    const part = await db.query.chatSessionParticipants.findFirst({
      where: and(
        eq(chatSessionParticipants.sessionId, sessionId),
        eq(chatSessionParticipants.instanceId, ctx.instance.id),
      ),
    });
    if (!part) throw new RoomAccessError("not a participant");
    return session;
  }

  throw new RoomAccessError("no auth context");
}

export async function listAccessibleSessionIds(ctx: {
  user?: AuthUser;
  instance?: AuthInstance;
}): Promise<string[] | "all"> {
  const db = getDb();
  if (ctx.user?.role === "admin" || ctx.user?.role === "operator") {
    return "all";
  }
  if (ctx.instance) {
    const parts = await db
      .select({ sessionId: chatSessionParticipants.sessionId })
      .from(chatSessionParticipants)
      .where(eq(chatSessionParticipants.instanceId, ctx.instance.id));
    return parts.map((p) => p.sessionId);
  }
  if (ctx.user) {
    const mine = await db
      .select({ sessionId: chatSessionParticipants.sessionId })
      .from(chatSessionParticipants)
      .where(eq(chatSessionParticipants.userId, ctx.user.id));
    return mine.map((p) => p.sessionId);
  }
  return [];
}
