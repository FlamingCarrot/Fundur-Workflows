import type { Db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { blueprintBody, materialBody, type BlueprintBody, type MaterialBody } from "./schema";
import { resolver, wouldLoop } from "./resolve";
import type { Blueprint, Library, Material } from "./types";

/**
 * Where the practice's design library is kept: blueprints and materials, each
 * with its revision and every earlier version. Entries are shared by the
 * workspace's owners and members, so a teammate's plan shows the same chair.
 */

export const LIBRARY_CAP = 1_000;

export class LibraryConflictError extends Error {
  constructor(public readonly current: Blueprint | Material) {
    super("Someone else saved this since you opened it.");
  }
}
export class LibraryError extends Error {}

type Row = {
  id: string;
  kind: "blueprint" | "material";
  body: BlueprintBody | MaterialBody;
  revision: number;
  updated_at: Date | string;
  created_by: string | null;
  updated_name: string | null;
};

function fromRow(r: Row): { kind: "blueprint"; entry: Blueprint } | { kind: "material"; entry: Material } {
  const meta = { id: r.id, revision: r.revision, updatedAt: new Date(r.updated_at).toISOString(), ...(r.created_by ? { createdBy: r.created_by } : {}) };
  if (r.kind === "blueprint") return { kind: "blueprint", entry: { ...(r.body as BlueprintBody), ...meta, ...(r.updated_name ? { updatedBy: r.updated_name } : {}) } as Blueprint };
  return { kind: "material", entry: { ...(r.body as MaterialBody), ...meta } as Material };
}

const SELECT = `SELECT l.id, l.kind, l.body, l.revision, l.updated_at, l.created_by, u.name AS updated_name
  FROM design_library l LEFT JOIN users u ON u.id = l.updated_by`;

export async function listLibrary(db: Db, workspaceId: string): Promise<Library> {
  const rows = await db.query<Row>(`${SELECT} WHERE l.workspace_id = $1 AND l.deleted_at IS NULL ORDER BY l.updated_at DESC, l.id LIMIT ${LIBRARY_CAP}`, [workspaceId]);
  const out: Library = { blueprints: [], materials: [] };
  for (const r of rows) {
    const e = fromRow(r);
    if (e.kind === "blueprint") out.blueprints.push(e.entry);
    else out.materials.push(e.entry);
  }
  return out;
}

export async function getEntry(db: Db, workspaceId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.query<Row>(`${SELECT} WHERE l.workspace_id = $1 AND l.id = $2 AND l.deleted_at IS NULL`, [workspaceId, id]);
  return row ? fromRow(row) : null;
}

/** Nested blueprints must exist and must not lead back to the one being saved. */
async function checkNesting(db: Db, workspaceId: string, id: string, body: BlueprintBody) {
  const nested = body.parts.filter((p) => p.blueprintId);
  if (!nested.length) return;
  const lib = resolver(await listLibrary(db, workspaceId));
  for (const p of nested) {
    if (!lib.blueprint(p.blueprintId!)) throw new LibraryError(`"${p.name ?? "A part"}" uses a blueprint that is not in the library.`);
    if (wouldLoop(lib, id, p.blueprintId!)) throw new LibraryError(`"${p.name ?? "A part"}" would put the blueprint inside itself.`);
  }
}

export async function createEntry(db: Db, workspaceId: string, userId: string, kind: "blueprint" | "material", raw: unknown, id: string = randomUUID()) {
  const body = kind === "blueprint" ? blueprintBody.parse(raw) : materialBody.parse(raw);
  if (kind === "blueprint") await checkNesting(db, workspaceId, id, body as BlueprintBody);
  const rows = await db.query<{ id: string }>(
    `INSERT INTO design_library (id, workspace_id, kind, name, body, created_by, updated_by)
     SELECT $1, $2, $3, $4, $5::jsonb, $6, $6
     WHERE (SELECT count(*) FROM design_library WHERE workspace_id = $2 AND deleted_at IS NULL) < ${LIBRARY_CAP}
     RETURNING id`,
    [id, workspaceId, kind, body.name, JSON.stringify(body), userId]
  );
  if (!rows.length) throw new LibraryError(`The library holds up to ${LIBRARY_CAP} entries. Remove some you no longer use first.`);
  await db.query(`INSERT INTO design_library_versions (entry_id, workspace_id, revision, body, created_by) VALUES ($1, $2, 1, $3::jsonb, $4)`, [id, workspaceId, JSON.stringify(body), userId]);
  return (await getEntry(db, workspaceId, id))!;
}

/** Saves a change if nobody else saved since `baseRevision`; throws LibraryConflictError with theirs when they did. */
export async function updateEntry(db: Db, workspaceId: string, userId: string, id: string, baseRevision: number, raw: unknown) {
  const current = await getEntry(db, workspaceId, id);
  if (!current) throw new LibraryError("That is no longer in the library.");
  const body = current.kind === "blueprint" ? blueprintBody.parse(raw) : materialBody.parse(raw);
  if (current.kind === "blueprint") await checkNesting(db, workspaceId, id, body as BlueprintBody);
  const rows = await db.query<{ revision: number }>(
    `UPDATE design_library SET body = $4::jsonb, name = $5, revision = revision + 1, updated_by = $6, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2 AND revision = $3 AND deleted_at IS NULL RETURNING revision`,
    [workspaceId, id, baseRevision, JSON.stringify(body), body.name, userId]
  );
  if (!rows.length) throw new LibraryConflictError(current.entry);
  await db.query(
    `INSERT INTO design_library_versions (entry_id, workspace_id, revision, body, created_by) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT DO NOTHING`,
    [id, workspaceId, rows[0].revision, JSON.stringify(body), userId]
  );
  // Keep the last 100 versions of each entry.
  await db.query(`DELETE FROM design_library_versions WHERE entry_id = $1 AND revision <= $2`, [id, rows[0].revision - 100]);
  return (await getEntry(db, workspaceId, id))!;
}

/** Takes it out of the library; plans that use it fall back to a box of the same size. */
export async function removeEntry(db: Db, workspaceId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db.query(`UPDATE design_library SET deleted_at = NOW() WHERE workspace_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING id`, [workspaceId, id]);
  return rows.length > 0;
}

export async function listVersions(db: Db, workspaceId: string, id: string) {
  const rows = await db.query<{ revision: number; created_at: Date | string; name: string | null; body: BlueprintBody | MaterialBody }>(
    `SELECT v.revision, v.created_at, u.name, v.body FROM design_library_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.workspace_id = $1 AND v.entry_id = $2 ORDER BY v.revision DESC LIMIT 100`,
    [workspaceId, id]
  );
  return rows.map((r) => ({ revision: r.revision, createdAt: new Date(r.created_at).toISOString(), createdBy: r.name ?? undefined, body: r.body }));
}
