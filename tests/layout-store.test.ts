import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { DEFAULT_RULES, DEFAULT_RULE_SET_NAME } from "../src/lib/layout/rules";
import { RuleSetConflictError, createRuleSet, deleteRuleSet, listRuleSets, updateRuleSet } from "../src/lib/layout/store";
import { generateLayouts } from "../src/lib/layout/generate";
import { createProject } from "../src/lib/projects/store";
import { getPlanState, savePlan } from "../src/lib/plan/store";
import { samplePlan } from "../src/lib/plan/geometry";
import { planSchema } from "../src/lib/plan/schema";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";

async function setup() {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  const who = { sub: "auth0|designer", email: "dee@example.com", name: "Dee" };
  const user = await syncUser(db, who);
  const ws = await ensureWorkspace(db, who);
  const other = await ensureWorkspace(db, { sub: "auth0|other", email: "o@example.com", name: "O" });
  return { db, ws, other, userId: user.id };
}

test("a workspace starts with the studio rules, keeps its own sets, and refuses a stale save", async () => {
  const { db, ws, other, userId } = await setup();
  const first = await listRuleSets(db, ws, userId);
  assert.equal(first.length, 1);
  assert.equal(first[0].name, DEFAULT_RULE_SET_NAME);
  assert.deepEqual(first[0].rules, DEFAULT_RULES);
  // Asking again does not add another.
  assert.equal((await listRuleSets(db, ws, userId)).length, 1);

  const tight = await createRuleSet(db, ws, userId, { name: "Call centre", rules: { ...DEFAULT_RULES, deskWidth: 1_200, aisle: 800 } });
  const saved = await updateRuleSet(db, ws, userId, tight.id, { name: "Call centre", rules: { ...tight.rules, aisle: 850 }, baseRevision: 1 });
  assert.equal(saved.revision, 2);
  assert.equal(saved.rules.aisle, 850);
  assert.equal(saved.updatedBy, "Dee");
  await assert.rejects(
    updateRuleSet(db, ws, userId, tight.id, { name: "Old", rules: tight.rules, baseRevision: 1 }),
    (err) => err instanceof RuleSetConflictError && err.current.rules.aisle === 850
  );

  // Another workspace sees only its own.
  const theirs = await listRuleSets(db, other, userId);
  assert.equal(theirs.length, 1);
  await assert.rejects(updateRuleSet(db, other, userId, tight.id, { name: "x", rules: DEFAULT_RULES, baseRevision: 2 }));

  await deleteRuleSet(db, ws, tight.id);
  await assert.rejects(deleteRuleSet(db, ws, first[0].id), RuleSetConflictError, "the last set stays");
  assert.equal((await listRuleSets(db, ws, userId)).length, 1);
});

test("layout options save with the plan and come back exactly", async () => {
  const { db, ws, userId } = await setup();
  await createProject(db, ws, { id: "harbour", name: "Harbour", client: "H", workflowId: DEFAULT_WORKFLOW_ID, startDate: "2026-10-01T00:00:00.000Z", swatch: "sage" });
  const plan = samplePlan();
  const result = generateLayouts(plan, plan.levels[0].id, { rules: DEFAULT_RULES, ruleSetName: "Studio", headcount: 20, departments: [], adjacencies: [] });
  if (!result.ok) assert.fail(result.error);
  const withLayouts = { ...plan, layouts: result.options.map((o, i) => ({ ...o.option, ...(i === 0 ? { chosen: true, notes: "Most daylight" } : {}) })) };
  const parsed = planSchema.safeParse(withLayouts);
  assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
  await savePlan(db, ws, userId, "harbour", { plan: withLayouts, baseRevision: null, changes: ["Layout options generated"] });
  const state = await getPlanState(db, ws, "harbour");
  assert.deepEqual(state!.plan!.layouts, withLayouts.layouts);
});
