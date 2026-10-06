import { neon, neonConfig, Pool } from "@neondatabase/serverless";

// Disable SSL verification issues in development if needed
neonConfig.fetchConnectionCache = true;

const connectionString = process.env.DATABASE_URL;

/**
 * Returns true if a valid, non-placeholder Neon connection string is configured.
 */
export function isNeonConfigured(): boolean {
  if (!connectionString) return false;
  return (
    connectionString.startsWith("postgres://") ||
    connectionString.startsWith("postgresql://")
  ) && !connectionString.includes("dev_user:dev_pass@localhost");
}

/**
 * Serverless query client for Neon Postgres.
 * Optimized for Vercel Serverless and Edge runtimes.
 */
export function getDbClient() {
  if (!connectionString || !isNeonConfigured()) {
    return null;
  }
  return neon(connectionString);
}

/**
 * Connection pool for multi-statement migrations or transactions on Neon.
 */
export function getDbPool() {
  if (!connectionString || !isNeonConfigured()) {
    return null;
  }
  return new Pool({ connectionString });
}

export type DbQueryResult<T = unknown> = T[];
