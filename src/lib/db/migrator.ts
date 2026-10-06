import * as fs from "fs";
import * as path from "path";

/** The smallest connection surface migrations need; a Neon pool client and PGlite both fit. */
export interface MigrationConnection {
  /** Runs a script that may hold several statements. */
  exec(sql: string): Promise<unknown>;
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const MIGRATIONS_DIR = path.join(process.cwd(), "src", "lib", "db", "migrations");

// Any fixed number works; it only has to be the same for every deploy.
const LOCK_ID = 7_351_024;

/**
 * Applies every migration in `dir` that has not run yet, in file-name order.
 * Each file runs in its own transaction together with its record in
 * schema_migrations, so a failed file leaves nothing half applied. An advisory
 * lock keeps two deploys building at once from running the same file twice.
 */
export async function runMigrations(conn: MigrationConnection, dir = MIGRATIONS_DIR): Promise<string[]> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await conn.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
  try {
    const { rows } = await conn.query("SELECT name FROM schema_migrations");
    const done = new Set(rows.map((r) => String(r.name)));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf-8");
      await conn.exec("BEGIN");
      try {
        await conn.exec(sql);
        await conn.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await conn.exec("COMMIT");
      } catch (err) {
        await conn.exec("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
    }
    return applied;
  } finally {
    await conn.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]);
  }
}
