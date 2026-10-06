import { loadEnvConfig } from "@next/env";
import { Pool } from "@neondatabase/serverless";
import { runMigrations } from "./migrator";

// Load environment variables from .env.local and .env
loadEnvConfig(process.cwd());

/**
 * Brings the database up to date. Runs before every build (see package.json),
 * so a deploy never runs code against a schema it does not know. Without a
 * database configured it does nothing, and the app runs on demo data.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

  if (!connectionString || connectionString.includes("dev_user:dev_pass@localhost")) {
    console.log("No database configured (DATABASE_URL); skipping migrations.");
    return;
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    const applied = await runMigrations({
      exec: (sql) => client.query(sql),
      query: (text, params) => client.query(text, params),
    });
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database schema is up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
