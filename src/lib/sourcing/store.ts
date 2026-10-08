import type { Db } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import {
  sourcingEntryInput,
  type SourcingEntry,
  type SourcingEntryInput,
} from "./schema";
export const canUseSourcingLibrary = (role?: WorkspaceRole) =>
  role === "owner" || role === "member";
export class SourcingLibraryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
type Row = {
  id: string;
  kind: SourcingEntry["kind"];
  data: SourcingEntry["data"];
  created_at: Date | string;
};
const fromRow = (r: Row) =>
  ({
    ...sourcingEntryInput.parse({ kind: r.kind, data: r.data }),
    id: r.id,
    createdAt: new Date(r.created_at).toISOString(),
  }) as SourcingEntry;
export async function listSourcingLibrary(
  db: Db,
  workspaceId: string,
): Promise<SourcingEntry[]> {
  return (
    await db.query<Row>(
      "SELECT id,kind,data,created_at FROM sourcing_library WHERE workspace_id=$1 ORDER BY kind,data->>'name',id LIMIT 550",
      [workspaceId],
    )
  ).map(fromRow);
}
export async function saveSourcingEntry(
  db: Db,
  workspaceId: string,
  userId: string,
  input: SourcingEntryInput,
): Promise<SourcingEntry> {
  const checked = sourcingEntryInput.parse(input);
  const rows = checked.id
    ? await db.query<Row>(
        "UPDATE sourcing_library SET data=$4::jsonb,updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND kind=$3 RETURNING id,kind,data,created_at",
        [workspaceId, checked.id, checked.kind, JSON.stringify(checked.data)],
      )
    : await db.query<Row>(
        `INSERT INTO sourcing_library(workspace_id,kind,data,created_by) SELECT $1::uuid,$2::varchar,$3::jsonb,$4::varchar WHERE (SELECT count(*) FROM sourcing_library WHERE workspace_id=$1::uuid AND kind=$2::varchar)<$5::int RETURNING id,kind,data,created_at`,
        [
          workspaceId,
          checked.kind,
          JSON.stringify(checked.data),
          userId,
          checked.kind === "supplier" ? 500 : 50,
        ],
      );
  if (!rows.length)
    throw new SourcingLibraryError(
      checked.id
        ? "Library entry not found"
        : "The practice library is full for this entry type",
      checked.id ? 404 : 409,
    );
  return fromRow(rows[0]);
}
export async function removeSourcingEntry(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  return (
    (
      await db.query(
        "DELETE FROM sourcing_library WHERE workspace_id=$1 AND id=$2 RETURNING id",
        [workspaceId, id],
      )
    ).length > 0
  );
}
