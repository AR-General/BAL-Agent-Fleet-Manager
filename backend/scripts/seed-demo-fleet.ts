/**
 * Idempotent demo seed: two example instances (alpha/beta), ops+chat rooms,
 * event tags, and API tokens.
 *
 * Usage: npm run db:seed-demo
 * Optional: OC_WRITE_TOKENS_DIR=/path/to/profiles to write OC_CONTROLLER_API_KEY
 * Per-slug keys: OC_ALPHA_API_KEY, OC_BETA_API_KEY
 */
import bcrypt from "bcrypt";
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { config } from "../src/config.js";
import { closeDb, getDb } from "../src/db/client.js";
import {
  agentPresence,
  agentProfiles,
  chatSessionParticipants,
  chatSessions,
  eventTagCatalog,
  instanceApiTokens,
  instances,
  tenants,
} from "../src/db/schema.js";
import { encryptGatewayToken } from "../src/services/gatewayToken.js";
import { generateInstanceToken } from "../src/utils/crypto.js";
import { buildHermesInstanceUrls } from "../src/utils/instanceEndpoints.js";

const GATEWAY_HOST = process.env.OC_GATEWAY_HOST || process.env.HERMES_HOST || config.hermesHost;
const GATEWAY_HOST_FALLBACK = process.env.OC_GATEWAY_HOST_FALLBACK || process.env.HERMES_HOST_FALLBACK || config.hermesHostFallback;

const DEMO_FLEET: Array<{
  slug: string;
  port: number;
  role: string;
  trusted: boolean;
  mood: string;
}> = [
  { slug: "alpha", port: 18789, role: "Primary agent", trusted: true, mood: "calm" },
  { slug: "beta", port: 18889, role: "Secondary agent", trusted: true, mood: "focused" },
];

const STANDARD_TAGS = [
  ["heartbeat", "Periodic liveness"],
  ["started_conversation", "Began talking to someone"],
  ["pr_opened", "Opened a pull request"],
  ["pr_merged", "Merged a pull request"],
  ["deploy", "Deployment activity"],
  ["incident", "Incident or alert"],
  ["handoff", "Cross-agent handoff"],
  ["custom", "Custom tag"],
];

const DEMO_CHANNELS = [
  { slug: "ops", title: "Ops" },
  { slug: "chat", title: "Chat" },
];

const DEFAULT_SCOPES = [
  "fleet:read",
  "fleet:write",
  "events:push",
  "messages:send",
  "chat:read",
  "chat:post",
  "contacts:read",
  "rooms:read",
  "rooms:write",
  "workspace:read",
  "workspace:write",
  "tools:invoke",
];

async function upsertDemoAgents(
  tenantId: string,
): Promise<Map<string, { id: string; token?: string }>> {
  const db = getDb();
  const out = new Map<string, { id: string; token?: string }>();
  const writeDir = process.env.OC_WRITE_TOKENS_DIR || "";

  for (const h of DEMO_FLEET) {
    const apiKeyEnv = process.env[`OC_${h.slug.toUpperCase()}_API_KEY`] || process.env[`HERMES_${h.slug.toUpperCase()}_API_KEY`] || "";
    let existing = await db.query.instances.findFirst({
      where: and(eq(instances.tenantId, tenantId), eq(instances.slug, h.slug)),
    });
    const urls = buildHermesInstanceUrls({
      host: GATEWAY_HOST,
      fallbackHost: GATEWAY_HOST_FALLBACK,
      apiPort: h.port,
      httpsPort: h.port + 1000,
    });
    const identity = {
      runtime: "hermes",
      health_path: "/health",
      role: h.role,
      trusted: h.trusted,
      display_name: h.slug.charAt(0).toUpperCase() + h.slug.slice(1),
      default_model: "default",
      fallback_host: GATEWAY_HOST_FALLBACK,
    };
    const payload = {
      tenantId,
      slug: h.slug,
      host: GATEWAY_HOST,
      ports: { api: h.port, gateway: h.port, https: h.port + 1000 },
      urls,
      identity,
      tls: { gateway_https: false, allow_self_signed: false },
      status: "registered",
      lastSeen: new Date(),
      ...(apiKeyEnv ? { gatewayTokenEncrypted: encryptGatewayToken(apiKeyEnv) } : {}),
    };

    if (existing) {
      await db
        .update(instances)
        .set({
          ...payload,
          gatewayTokenEncrypted: apiKeyEnv
            ? encryptGatewayToken(apiKeyEnv)
            : existing.gatewayTokenEncrypted,
        })
        .where(eq(instances.id, existing.id));
    } else {
      const [created] = await db.insert(instances).values(payload).returning();
      existing = created;
      console.log(`created demo instance ${h.slug}`);
    }

    let profile = await db.query.agentProfiles.findFirst({
      where: and(eq(agentProfiles.instanceId, existing.id), eq(agentProfiles.agentId, "main")),
    });
    if (!profile) {
      const [p] = await db
        .insert(agentProfiles)
        .values({
          instanceId: existing.id,
          agentId: "main",
          displayName: identity.display_name,
          roleDescription: h.role,
          isPublic: !h.trusted ? true : false,
        })
        .returning();
      profile = p;
    }

    const presence = await db.query.agentPresence.findFirst({
      where: eq(agentPresence.instanceId, existing.id),
    });
    if (!presence) {
      await db.insert(agentPresence).values({
        instanceId: existing.id,
        agentProfileId: profile.id,
        defaultMood: h.mood,
        defaultModelId: "default",
      });
    }

    // Mint token if none active
    const tokens = await db
      .select()
      .from(instanceApiTokens)
      .where(eq(instanceApiTokens.instanceId, existing.id));
    const active = tokens.find((t) => !t.revokedAt);
    let rawToken: string | undefined;
    if (!active) {
      const { raw, prefix } = generateInstanceToken();
      const hash = await bcrypt.hash(raw, 12);
      await db.insert(instanceApiTokens).values({
        instanceId: existing.id,
        label: "demo-skill",
        tokenPrefix: prefix,
        tokenHash: hash,
        scopes: DEFAULT_SCOPES,
      });
      rawToken = raw;
      console.log(`minted oc_inst token for ${h.slug} (prefix ${prefix})`);
      if (writeDir) {
        const envPath = path.join(writeDir, h.slug, ".env");
        try {
          let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
          if (/^OC_CONTROLLER_API_KEY=/m.test(text)) {
            text = text.replace(/^OC_CONTROLLER_API_KEY=.*$/m, `OC_CONTROLLER_API_KEY=${raw}`);
          } else {
            text += `\nOC_CONTROLLER_API_KEY=${raw}\n`;
          }
          if (!/^OC_CONTROLLER_URL=/m.test(text)) {
            text += `OC_CONTROLLER_URL=http://host.docker.internal:3800\n`;
          }
          fs.mkdirSync(path.dirname(envPath), { recursive: true });
          fs.writeFileSync(envPath, text);
          console.log(`wrote token to ${envPath}`);
        } catch (e) {
          console.warn(`could not write ${envPath}:`, e);
        }
      } else {
        console.log(`TOKEN ${h.slug}=${raw} (set OC_WRITE_TOKENS_DIR to persist)`);
      }
    }

    out.set(h.slug, { id: existing.id, token: rawToken });
  }
  return out;
}

async function seedChannels(tenantId: string, agents: Map<string, { id: string }>) {
  const db = getDb();
  const trusted = DEMO_FLEET.filter((h) => h.trusted).map((h) => h.slug);
  for (const ch of DEMO_CHANNELS) {
    let session = await db.query.chatSessions.findFirst({
      where: and(eq(chatSessions.tenantId, tenantId), eq(chatSessions.slug, ch.slug)),
    });
    if (!session) {
      const [s] = await db
        .insert(chatSessions)
        .values({
          tenantId,
          title: ch.title,
          slug: ch.slug,
          origin: "named_channel",
          sessionType: "group",
          replyPolicy: "off",
          status: "active",
        })
        .returning();
      session = s;
      console.log(`created channel ${ch.slug}`);
    }
    for (const slug of trusted) {
      const inst = agents.get(slug);
      if (!inst) continue;
      const part = await db.query.chatSessionParticipants.findFirst({
        where: and(
          eq(chatSessionParticipants.sessionId, session.id),
          eq(chatSessionParticipants.instanceId, inst.id),
        ),
      });
      if (!part) {
        await db.insert(chatSessionParticipants).values({
          sessionId: session.id,
          participantType: "instance",
          instanceId: inst.id,
          displayName: slug,
        });
      }
    }
  }
}

async function seedTags(tenantId: string) {
  const db = getDb();
  for (const [tag, description] of STANDARD_TAGS) {
    const existing = await db.query.eventTagCatalog.findFirst({
      where: and(eq(eventTagCatalog.tenantId, tenantId), eq(eventTagCatalog.tag, tag)),
    });
    if (!existing) {
      await db.insert(eventTagCatalog).values({
        tenantId,
        tag,
        description,
        isStandard: true,
      });
    }
  }
}

async function main() {
  const db = getDb();
  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.slug, "default") });
  if (!tenant) throw new Error("default tenant missing — run npm run db:seed first");

  const agents = await upsertDemoAgents(tenant.id);
  await seedChannels(tenant.id, agents);
  await seedTags(tenant.id);
  console.log(
    `Demo fleet seed complete (primary ${GATEWAY_HOST}, fallback ${GATEWAY_HOST_FALLBACK || "none"})`,
  );
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
