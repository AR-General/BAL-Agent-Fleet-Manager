import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool, closeDb } from "./client.js";

async function main(): Promise<void> {
  const db = getDb();
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
