import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import { log } from "../utils/logger.js";
import * as schema from "./schema.js";

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
    // Idle client disconnects emit on the pool; without a listener Node crashes.
    pool.on("error", (err) => {
      log.error({ err }, "postgres pool idle client error");
    });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
