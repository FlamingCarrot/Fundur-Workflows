import { neon } from "@neondatabase/serverless";

/**
 * Parameterised queries, one statement each. The app reaches the database only
 * through this, so tests can hand the same code an in-process Postgres.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/**
 * Returns true if a valid, non-placeholder Neon connection string is configured.
 */
export function isNeonConfigured(): boolean {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return false;
  return (
    connectionString.startsWith("postgres://") ||
    connectionString.startsWith("postgresql://")
  ) && !connectionString.includes("dev_user:dev_pass@localhost");
}

let db: Db | null = null;

/**
 * The database over Neon's HTTP driver, which suits serverless functions: no
 * connection to hold open between requests. Null while none is configured.
 */
export function getDb(): Db | null {
  if (!isNeonConfigured()) return null;
  if (!db) {
    const sql = neon(process.env.DATABASE_URL!);
    db = { query: (text, params) => sql.query(text, params) as never };
  }
  return db;
}
