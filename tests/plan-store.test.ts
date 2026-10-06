import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { createProject } from "../src/lib/projects/store";
import {
  createPlanVersion,
  getPlanState,
  getPlanVersion,
  PlanConflictError,
  restorePlanVersion,
  savePlan,
} from "../src/lib/plan/store";
import { samplePlan, setWallLength, usableArea } from "../src/lib/plan/geometry";
import { planSchema } from "../src/lib/plan/schema";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

const slug = "harbour-house";

async function setup() {
  const db = await freshDb();
  const who = { sub: "auth0|designer", email: "dee@example.com", name: "Dee" };
  const user = await syncUser(db, who);
  const ws = await ensureWorkspace(db, who);
  await createProject(db, ws, {
    id: slug,
    name: "Harbour House",
    client: "Harbour Holdings",
    workflowId: DEFAULT_WORKFLOW_ID,
    startDate: "2026-10-01T00:00:00.000Z",
    swatch: "sage",
  });
  return { db, ws, userId: user.id };
}

test("a project starts with no plan, and the first save creates it with its log", async () => {
  const { db, ws, userId } = await setup();
  const empty = await getPlanState(db, ws, slug);
  assert.deepEqual(empty, { plan: null, revision: 0, versions: [], corrections: [] });

  const plan = samplePlan();
  assert.ok(planSchema.safeParse(plan).success, "the sample is a plan the server accepts");
  const { revision } = await savePlan(db, ws, userId, slug, { plan, baseRevision: null, changes: ["Started from the sample"] });
  assert.equal(revision, 1);

  const state = (await getPlanState(db, ws, slug))!;
  assert.deepEqual(state.plan, plan);
  assert.equal(state.updatedBy, "Dee");
  assert.deepEqual(state.corrections.map((c) => [c.summary, c.by]), [["Started from the sample", "Dee"]]);
});

test("a save made against an older revision is refused and hands back the stored plan", async () => {
  const { db, ws, userId } = await setup();
  const plan = samplePlan();
  await savePlan(db, ws, userId, slug, { plan, baseRevision: null, changes: [] });
  const wall = plan.walls[0];
  const edit = setWallLength(plan, wall.id, 18_500);
  assert.ok(edit.ok);
  await savePlan(db, ws, userId, slug, { plan: edit.plan, baseRevision: 1, changes: [edit.summary] });

  // A second editor still on revision 1.
  await assert.rejects(
    () => savePlan(db, ws, userId, slug, { plan, baseRevision: 1, changes: ["stale"] }),
    (err: unknown) => err instanceof PlanConflictError && err.current.revision === 2 && err.current.plan !== null
  );
  // And creating a plan that already exists is a conflict too.
  await assert.rejects(() => savePlan(db, ws, userId, slug, { plan, baseRevision: null, changes: [] }), PlanConflictError);

  const state = (await getPlanState(db, ws, slug))!;
  assert.deepEqual(state.plan, edit.plan, "the stale save changed nothing");
  assert.deepEqual(state.corrections.map((c) => c.summary), [edit.summary]);
});

test("each change in a save is its own line in the log, newest first", async () => {
  const { db, ws, userId } = await setup();
  await savePlan(db, ws, userId, slug, { plan: samplePlan(), baseRevision: null, changes: ["one", "two", "three"] });
  const state = (await getPlanState(db, ws, slug))!;
  assert.deepEqual(state.corrections.map((c) => c.summary), ["three", "two", "one"]);
});

test("restoring a named version returns the exact earlier geometry, and keeps what it replaced", async () => {
  const { db, ws, userId } = await setup();
  const original = samplePlan();
  await savePlan(db, ws, userId, slug, { plan: original, baseRevision: null, changes: [] });
  const version = await createPlanVersion(db, ws, userId, slug, "As surveyed");

  const edit = setWallLength(original, original.walls[0].id, 20_000);
  assert.ok(edit.ok);
  await savePlan(db, ws, userId, slug, { plan: edit.plan, baseRevision: 1, changes: [edit.summary] });
  assert.notEqual(usableArea(edit.plan), usableArea(original));

  const restored = await restorePlanVersion(db, ws, userId, slug, version.id, 2);
  assert.deepEqual(restored.plan, original);
  assert.equal(restored.revision, 3);
  assert.deepEqual(restored.versions.map((v) => v.label), ['Before restoring "As surveyed"', "As surveyed"]);
  const kept = await getPlanVersion(db, ws, slug, restored.versions[0].id);
  assert.deepEqual(kept!.plan, edit.plan, "the plan from before the restore can be restored in turn");
  assert.equal(restored.corrections[0].summary, 'Restored version "As surveyed"');

  await assert.rejects(() => restorePlanVersion(db, ws, userId, slug, version.id, 2), PlanConflictError);
  const after = await getPlanState(db, ws, slug);
  assert.equal(after!.versions.length, 2, "a refused restore keeps no version");
  assert.equal(after!.revision, 3);
});

test("another workspace cannot see or change the plan", async () => {
  const { db, ws, userId } = await setup();
  await savePlan(db, ws, userId, slug, { plan: samplePlan(), baseRevision: null, changes: [] });
  const other = await ensureWorkspace(db, { sub: "auth0|other", email: "o@example.com", name: "O" });
  assert.equal(await getPlanState(db, other, slug), null);
});

test("the server refuses doors and windows that are off their wall, overlapping, or on no wall", () => {
  const plan = samplePlan();
  assert.ok(planSchema.safeParse(plan).success);
  const door = plan.openings[0];
  const orphan = { ...plan, openings: [...plan.openings, { ...door, id: "x", wallId: "no-such-wall" }] };
  assert.equal(planSchema.safeParse(orphan).success, false);
  const overlapping = { ...plan, openings: [...plan.openings, { ...door, id: "y", at: door.at + 100 }] };
  assert.equal(planSchema.safeParse(overlapping).success, false);
  const off = { ...plan, openings: plan.openings.map((o) => (o.id === door.id ? { ...o, at: -5_000 } : o)) };
  assert.equal(planSchema.safeParse(off).success, false);
});
