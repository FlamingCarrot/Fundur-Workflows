import type { Db } from "@/lib/db";

/**
 * A daily backup of everything the database holds, and a list of every stored
 * file so a restore can be checked against storage (P1-16).
 *
 * Neon keeps its own point-in-time history; this is the copy that survives the
 * database itself, and the one a restore into a scratch database is tested
 * against. The daily runner makes incremental private copies of files and
 * records their backup paths in the manifest.
 */

/** Tables are written in this order, so a restore never inserts a row before what it points at. */
export const BACKUP_TABLES = [
  "users",
  "workspaces",
  "memberships",
  "workspace_invitations",
  "workspace_user_features",
  "workspace_audit",
  "workflows",
  "workflow_versions",
  "workflow_drafts",
  "workflow_builder_settings",
  "workflow_builds",
  "workflow_capability_requests",
  "projects",
  "project_members",
  "project_design",
  "phase_instances",
  "project_phases",
  "checklist_items",
  "project_records",
  "documents",
  "concept_generations",
  "tasks",
  "records",
  "module_data",
  "feature_flags",
  "document_versions",
  "project_snapshots",
  "project_tasks",
  "floor_plans",
  "floor_plan_versions",
  "floor_plan_corrections",
  "layout_rule_sets",
  "furniture_assemblies",
  "sourcing_library",
  "project_templates",
  "issue_reports",
  "ai_chat_messages",
  "ai_runs",
  "provider_keys",
  "model_settings",
  "enabled_models",
  "model_suggestions",
  "provider_model_lists",
  "ai_task_routes",
  "project_ai_budgets",
  "ai_budget_alerts",
  "ai_proposals",
  "share_links",
  "project_share_visibility",
  "share_comments",
  "user_view_settings",
  "usage_events",
  "research_notes",
  "advisor_runs",
  "advisor_suggestions",
] as const;

export const BACKUP_VERSION = 1;

export interface FileEntry {
  key: string;
  name: string;
  sizeBytes: number;
  version: number;
  /** An incremental private copy of the immutable file, when archived. */
  backupKey?: string;
}

export interface Backup {
  version: number;
  takenAt: string;
  /** Every row of each table, by table name. */
  tables: Record<string, Record<string, unknown>[]>;
  /** Every file the database says is in storage, so a restore can check they are all there. */
  files: FileEntry[];
  counts: Record<string, number>;
}

/** Tables that exist in this database, in backup order; a table added later is simply skipped. */
async function presentTables(db: Db): Promise<string[]> {
  const rows = await db.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  const present = new Set(rows.map((r) => r.table_name));
  return BACKUP_TABLES.filter((t) => present.has(t));
}

export async function takeBackup(db: Db): Promise<Backup> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const counts: Record<string, number> = {};
  for (const table of await presentTables(db)) {
    const order = table === "share_comments" ? " ORDER BY parent_id NULLS FIRST, created_at, id" : "";
    const rows = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}${order}`);
    tables[table] = rows;
    counts[table] = rows.length;
  }

  const files = await db.query<{ key: string; name: string; size_bytes: string | number; version_number: number }>(
    `SELECT file_location AS key, name, size_bytes, version_number FROM documents WHERE file_location <> ''
     UNION ALL
     SELECT v.file_location AS key, COALESCE(v.name, d.name) AS name, v.size_bytes, v.version_number
     FROM document_versions v JOIN documents d ON d.id = v.document_id
     WHERE v.file_location <> ''`
  );

  return {
    version: BACKUP_VERSION,
    takenAt: new Date().toISOString(),
    tables,
    files: files.map((f) => ({
      key: f.key,
      name: f.name,
      sizeBytes: Number(f.size_bytes ?? 0),
      version: f.version_number,
    })),
    counts,
  };
}

function columnsOf(rows: Record<string, unknown>[]): string[] {
  const names = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) names.add(key);
  return [...names];
}

function valueFor(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  // jsonb and text[] come back as objects and arrays; the driver needs them as they go in.
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(value);
  return value ?? null;
}

/**
 * Writes a backup into an empty, already migrated database: the scratch
 * database a restore is tested in, or the real one after a loss. Existing rows
 * with the same primary key are left alone, so a half-finished restore can be
 * run again.
 */
export async function restoreBackup(db: Db, backup: Backup): Promise<Record<string, number>> {
  if (backup.version !== BACKUP_VERSION) {
    throw new Error(`This backup was written by another version (${backup.version})`);
  }
  const restored: Record<string, number> = {};
  for (const table of BACKUP_TABLES) {
    const rows = backup.tables[table];
    if (!rows?.length) continue;
    const columns = columnsOf(rows);
    const list = columns.map((c) => `"${c}"`).join(", ");
    for (const row of rows) {
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      await db.query(
        `INSERT INTO ${table} (${list}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
        columns.map((c) => valueFor(row[c]))
      );
    }
    // Explicit IDs do not advance a BIGSERIAL sequence. A restored event log
    // must accept new events without colliding with the recovered rows.
    if (table === "usage_events") {
      await db.query("SELECT setval(pg_get_serial_sequence('usage_events','id'), COALESCE(MAX(id),1), MAX(id) IS NOT NULL) FROM usage_events");
    }
    restored[table] = rows.length;
  }
  // A backup from before the model shortlist existed has no enabled_models
  // rows, and the migration that seeds the list ran on the empty database, so
  // the restored default joins the list here, as it did when it was added.
  if (!("enabled_models" in backup.tables)) {
    await db.query(
      `INSERT INTO enabled_models (workspace_id, provider, model, name, input_usd_per_mtok, output_usd_per_mtok, added_by)
       SELECT NULL, provider, model, model, input_usd_per_mtok, output_usd_per_mtok, updated_by
       FROM model_settings WHERE workspace_id IS NULL AND role = 'default'
       ON CONFLICT DO NOTHING`
    );
  }
  return restored;
}

/** What a restore should hold, compared with what it does. Empty means the restore is sound. */
export async function checkRestore(db: Db, backup: Backup): Promise<string[]> {
  const problems: string[] = [];
  for (const [table, expected] of Object.entries(backup.counts)) {
    const [row] = await db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`);
    const actual = Number(row?.count ?? 0);
    if (actual !== expected) problems.push(`${table}: ${actual} rows, expected ${expected}`);
  }
  return problems;
}
