/**
 * One-shot migration from legacy op-controller MongoDB to PostgreSQL.
 * Usage: MONGO_URI=mongodb://... DATABASE_URL=postgresql://... npx tsx scripts/migrate-mongo-to-pg.ts
 */
import "dotenv/config";
import { MongoClient } from "mongodb";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { and, eq } from "drizzle-orm";
import * as schema from "../src/db/schema.js";
import { encryptText } from "../src/utils/crypto.js";

const mongoUri = process.env.MONGO_URI || process.env.OP_CONTROLLER_MONGO_URI;
const databaseUrl = process.env.DATABASE_URL;
if (!mongoUri || !databaseUrl) {
  console.error("Set MONGO_URI and DATABASE_URL");
  process.exit(1);
}

async function main(): Promise<void> {
  const mongo = new MongoClient(mongoUri);
  await mongo.connect();
  const mdb = mongo.db();

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });

  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, "default"))
    .limit(1);
  if (!tenant) {
    console.error("Run db:seed first (default tenant missing)");
    process.exit(1);
  }

  const instCol = mdb.collection("instances");
  const instances = await instCol.find({}).toArray();
  for (const doc of instances) {
    const slug = String(doc.slug || doc._id);
    const existing = await db.query.instances.findFirst({
      where: eq(schema.instances.slug, slug),
    });
    if (existing) {
      await db
        .update(schema.instances)
        .set({
          identity: doc.identity || {},
          ports: doc.ports || {},
          host: doc.host,
          urls: doc.urls || {},
          channels: doc.channels || {},
          health: doc.health || { status: "unknown" },
          lastSeen: doc.last_seen ? new Date(doc.last_seen) : undefined,
        })
        .where(eq(schema.instances.id, existing.id));
      console.log(`updated instance ${slug}`);
      continue;
    }
    await db.insert(schema.instances).values({
      tenantId: tenant.id,
      slug,
      identity: doc.identity || {},
      ports: doc.ports || {},
      host: doc.host,
      urls: doc.urls || {},
      channels: doc.channels || {},
      health: doc.health || { status: "unknown" },
      status: doc.status || "registered",
      lastSeen: doc.last_seen ? new Date(doc.last_seen) : null,
    });
    console.log(`inserted instance ${slug}`);
  }

  const events = await mdb.collection("events").find({}).limit(5000).toArray();
  for (const ev of events) {
    const slug = String(ev.instance_slug || "");
    const inst = await db.query.instances.findFirst({ where: eq(schema.instances.slug, slug) });
    if (!inst) continue;
    await db.insert(schema.fleetEvents).values({
      instanceId: inst.id,
      eventType: String(ev.event_type || ev.type || "event"),
      data: ev.data || ev,
    });
  }
  console.log(`migrated ${events.length} events`);

  const messages = await mdb.collection("messages").find({}).limit(5000).toArray();
  for (const msg of messages) {
    const fromSlug = String(msg.from_slug || "");
    const toSlug = String(msg.to_slug || "");
    const fromInst = await db.query.instances.findFirst({ where: eq(schema.instances.slug, fromSlug) });
    const toInst = toSlug
      ? await db.query.instances.findFirst({ where: eq(schema.instances.slug, toSlug) })
      : null;
    if (!fromInst) continue;
    const body = String(msg.body || msg.text || "");
    const { encrypted, iv } = encryptText(body);
    await db.insert(schema.fleetMessages).values({
      fromInstanceId: fromInst.id,
      toInstanceId: toInst?.id ?? null,
      channel: String(msg.channel || "internal"),
      bodyEncrypted: encrypted,
      bodyIv: iv,
      status: (msg.status as "pending" | "delivered" | "read") || "pending",
    });
  }
  console.log(`migrated ${messages.length} messages`);

  const contacts = await mdb.collection("contacts").find({}).limit(5000).toArray();
  for (const c of contacts) {
    const slug = String(c.slug || c.name || c._id);
    const existing = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.tenantId, tenant.id), eq(schema.contacts.slug, slug)),
    });
    if (existing) continue;
    const [row] = await db
      .insert(schema.contacts)
      .values({
        tenantId: tenant.id,
        slug,
        displayName: String(c.display_name || c.name || slug),
        contactKind: c.kind === "ai" ? "ai_agent" : "human",
        isExternal: Boolean(c.is_external),
        allowContact: c.allow_contact !== false,
        notes: c.notes,
        tags: c.tags || [],
      })
      .returning();
    if (row && Array.isArray(c.channels)) {
      for (const ch of c.channels) {
        const rawType = String(ch.type || "other");
        const allowed = ["phone", "signal", "sms", "whatsapp", "email", "slack", "twilio_voice", "webchat", "other"];
        const channelType = (allowed.includes(rawType) ? rawType : "other") as (typeof allowed)[number];
        await db.insert(schema.contactChannels).values({
          contactId: row.id,
          channelType,
          address: String(ch.address || ""),
          label: ch.label,
        });
      }
    }
  }
  console.log(`migrated ${contacts.length} contacts`);

  await mongo.close();
  await pool.end();
  console.log("Migration complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
