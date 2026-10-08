import type { Db } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import { newId } from "./geometry";
import { assemblyInput, type Assembly, type AssemblyInput } from "./groups";

/** A shared practice library cannot expose restricted project content to collaborators. */
export const canUseAssemblies = (role?: WorkspaceRole) =>
  role === "owner" || role === "member";
type Row = {
  id: string;
  name: string;
  items: AssemblyInput["items"];
  created_at: Date | string;
};
const fromRow = (r: Row): Assembly => ({
  id: r.id,
  name: r.name,
  items: r.items,
  createdAt: new Date(r.created_at).toISOString(),
});
export async function listAssemblies(
  db: Db,
  workspaceId: string,
): Promise<Assembly[]> {
  const rows = await db.query<Row>(
    "SELECT id,name,items,created_at FROM furniture_assemblies WHERE workspace_id=$1 ORDER BY created_at DESC,id LIMIT 200",
    [workspaceId],
  );
  return rows.map(fromRow);
}
export async function createAssembly(
  db: Db,
  workspaceId: string,
  userId: string,
  input: AssemblyInput,
): Promise<Assembly> {
  const parsed = assemblyInput.parse(input);
  const rows = await db.query<Row>(
    `INSERT INTO furniture_assemblies(id,workspace_id,name,items,created_by)
    SELECT $1,$2,$3,$4::jsonb,$5 WHERE (SELECT count(*) FROM furniture_assemblies WHERE workspace_id=$2)<200
    RETURNING id,name,items,created_at`,
    [newId(), workspaceId, parsed.name, JSON.stringify(parsed.items), userId],
  );
  if (!rows.length)
    throw new Error(
      "The practice library is full. Remove an unused arrangement first.",
    );
  return fromRow(rows[0]);
}
export async function removeAssembly(
  db: Db,
  workspaceId: string,
  id: string,
): Promise<boolean> {
  const rows = await db.query(
    "DELETE FROM furniture_assemblies WHERE workspace_id=$1 AND id=$2 RETURNING id",
    [workspaceId, id],
  );
  return rows.length > 0;
}
