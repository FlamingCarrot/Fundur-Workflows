import { loadEnvConfig } from "@next/env";
import { Pool } from "@neondatabase/serverless";
import * as fs from "fs";
import * as path from "path";

// Load environment variables from .env.local and .env
loadEnvConfig(process.cwd());

async function runMigration() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error("❌ Error: DATABASE_URL or DATABASE_URL_UNPOOLED is not set in environment.");
    process.exit(1);
  }

  if (connectionString.includes("dev_user:dev_pass@localhost")) {
    console.warn("⚠️ DATABASE_URL is set to placeholder localhost. Set your Neon Postgres connection string in .env.local to execute migrations against Neon.");
    process.exit(0);
  }

  console.log("⚡ Connecting to Neon Database...");
  const pool = new Pool({ connectionString });

  const schemaPath = path.join(__dirname, "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf-8");

  console.log("🚀 Executing schema migration...");
  
  try {
    await pool.query(schemaSql);
    await pool.end();
    console.log("✅ Neon schema migration completed successfully!");
  } catch (err) {
    await pool.end();
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

runMigration().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
