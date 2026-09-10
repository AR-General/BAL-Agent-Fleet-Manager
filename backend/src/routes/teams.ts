import { Router } from "express";
import { routeParam } from "../utils/params.js";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { agentProfiles, instances, teamMembers, teams } from "../db/schema.js";
import { requireJwt, requireRole } from "../middleware/auth.js";

const router = Router();

router.get("/", requireJwt, async (req, res) => {
  const db = getDb();
  const teamRows = await db.select().from(teams).where(eq(teams.tenantId, req.user!.tenantId));
  const out = [];
  for (const t of teamRows) {
    const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, t.id));
    out.push({ ...t, members });
  }
  res.json({ teams: out });
});

const teamSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
});

router.post("/", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = teamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const [row] = await db
    .insert(teams)
    .values({ ...parsed.data, tenantId: req.user!.tenantId })
    .returning();
  res.status(201).json(row);
});

const memberSchema = z.object({
  member_type: z.enum(["instance", "agent"]),
  instance_slug: z.string(),
  agent_id: z.string().optional(),
  role_in_team: z.string().optional(),
});

router.post("/:slug/members", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const parsed = memberSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const db = getDb();
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.slug, routeParam(req.params.slug)), eq(teams.tenantId, req.user!.tenantId)),
  });
  if (!team) {
    res.status(404).json({ error: "team not found" });
    return;
  }
  const inst = await db.query.instances.findFirst({
    where: and(eq(instances.slug, parsed.data.instance_slug), eq(instances.tenantId, req.user!.tenantId)),
  });
  if (!inst) {
    res.status(404).json({ error: "instance not found" });
    return;
  }
  let agentProfileId: string | null = null;
  if (parsed.data.member_type === "agent" && parsed.data.agent_id) {
    const profile = await db.query.agentProfiles.findFirst({
      where: and(eq(agentProfiles.instanceId, inst.id), eq(agentProfiles.agentId, parsed.data.agent_id)),
    });
    if (!profile) {
      res.status(404).json({ error: "agent profile not found" });
      return;
    }
    agentProfileId = profile.id;
  }
  const [member] = await db
    .insert(teamMembers)
    .values({
      teamId: team.id,
      memberType: parsed.data.member_type,
      instanceId: inst.id,
      agentProfileId,
      roleInTeam: parsed.data.role_in_team,
    })
    .returning();
  res.status(201).json(member);
});

router.delete("/:slug/members/:memberId", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.slug, routeParam(req.params.slug)), eq(teams.tenantId, req.user!.tenantId)),
  });
  if (!team) {
    res.status(404).json({ error: "team not found" });
    return;
  }
  await db
    .delete(teamMembers)
    .where(and(eq(teamMembers.id, routeParam(req.params.memberId)), eq(teamMembers.teamId, team.id)));
  res.json({ ok: true });
});

router.put("/:slug", requireJwt, requireRole("admin", "operator"), async (req, res) => {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (req.body.name !== undefined) patch.name = req.body.name;
  if (req.body.description !== undefined) patch.description = req.body.description;
  if (req.body.color !== undefined) patch.color = req.body.color;
  const [row] = await db
    .update(teams)
    .set(patch)
    .where(and(eq(teams.slug, routeParam(req.params.slug)), eq(teams.tenantId, req.user!.tenantId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(row);
});

export default router;
