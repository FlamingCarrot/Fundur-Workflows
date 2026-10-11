import type { Db } from "@/lib/db";
import { assertAllows, assertModule, assertWithinCap } from "@/lib/billing/guard";
import type { AppUser } from "@/lib/auth/users";
import { getPlanState } from "./store";
import type { Plan } from "./geometry";

const MODULE = "floor_plan_editor";

interface Ctx {
  db: Db;
  workspaceId: string;
  user: AppUser;
}

async function workflowOf(db: Db, workspaceId: string, slug: string): Promise<string | undefined> {
  const [row] = await db.query<{ workflow_id: string }>(
    "SELECT workflow_id FROM projects WHERE workspace_id = $1 AND slug = $2",
    [workspaceId, slug]
  );
  return row?.workflow_id;
}

/**
 * The plan editor's limits on a save. Only what the save adds is checked
 * (more floors, a new trace image, a DXF import, layout options), so a plan
 * drawn on Paid can still be edited after a move to Free.
 */
export async function assertPlanSaveAllowed(ctx: Ctx, slug: string, next: Plan): Promise<void> {
  const workflowId = await workflowOf(ctx.db, ctx.workspaceId, slug);
  const plan = await assertModule(ctx, MODULE, workflowId);
  const prev = (await getPlanState(ctx.db, ctx.workspaceId, slug))?.plan ?? null;
  assertWithinCap(plan, MODULE, "floors", next.levels.length, prev?.levels.length ?? 1, "floor", workflowId);
  if ((next.underlays?.length ?? 0) > (prev?.underlays?.length ?? 0)) {
    assertAllows(plan, MODULE, "traceImage", "Tracing over a photo or scan is on the Paid plan.", workflowId);
  }
  if (next.source && next.source.importedAt !== prev?.source?.importedAt) {
    assertAllows(plan, MODULE, "importDxf", "Importing DXF drawings is on the Paid plan.", workflowId);
  }
  if ((next.layouts?.length ?? 0) > (prev?.layouts?.length ?? 0)) {
    await assertModule(ctx, "layout_generator", workflowId);
  }
}

/** Keeping one more named version. */
export async function assertPlanVersionAllowed(ctx: Ctx, slug: string): Promise<void> {
  const workflowId = await workflowOf(ctx.db, ctx.workspaceId, slug);
  const plan = await assertModule(ctx, MODULE, workflowId);
  const count = (await getPlanState(ctx.db, ctx.workspaceId, slug))?.versions.length ?? 0;
  assertWithinCap(plan, MODULE, "namedVersions", count + 1, count, "named version", workflowId);
}
