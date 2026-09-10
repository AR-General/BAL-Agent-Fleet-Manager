import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { closeDb, getDb } from "./client.js";
import { teams, teamMembers, tenants, users } from "./schema.js";

async function main(): Promise<void> {
  // CHAT_ENCRYPTION_KEY is validated when config loads; refuse empty ephemeral seeds.
  const db = getDb();
  let tenant = await db.query.tenants.findFirst({ where: eq(tenants.slug, "default") });
  if (!tenant) {
    const [created] = await db
      .insert(tenants)
      .values({ name: "Default Tenant", slug: "default" })
      .returning();
    tenant = created;
    console.log("Created default tenant");
  }

  const existingUser = await db.query.users.findFirst({
    where: eq(users.email, config.adminEmail),
  });
  const hash = await bcrypt.hash(config.adminPassword, 12);
  if (!existingUser) {
    await db.insert(users).values({
      tenantId: tenant.id,
      email: config.adminEmail,
      passwordHash: hash,
      role: "admin",
      displayName: "Admin",
    });
    console.log(`Created admin user ${config.adminEmail} (role: admin, tenant: default)`);
  } else if (process.env.ADMIN_PASSWORD_RESET === "true") {
    await db.update(users).set({ passwordHash: hash }).where(eq(users.id, existingUser.id));
    console.log(`Reset password for ${config.adminEmail} (ADMIN_PASSWORD_RESET=true)`);
  } else {
    console.log(`Admin user ${config.adminEmail} already exists (password unchanged; set ADMIN_PASSWORD_RESET=true to sync)`);
  }
  console.log("Sign in with ADMIN_EMAIL / ADMIN_PASSWORD from your environment.");

  let fleetTeam = await db.query.teams.findFirst({
    where: eq(teams.slug, "fleet"),
  });
  if (!fleetTeam) {
    const [t] = await db
      .insert(teams)
      .values({
        tenantId: tenant.id,
        slug: "fleet",
        name: "Fleet",
        description: "All registered OpenClaw instances",
      })
      .returning();
    fleetTeam = t;
    console.log("Created fleet team");
  }

  console.log("Seed complete");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
