import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { createProject } from "../src/lib/projects/store";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";
import { MODULE_REGISTRY } from "../src/lib/modules/registry";
import {
  addMonths,
  DEFAULT_SUBSCRIPTION,
  describePlan,
  discountedPrice,
  moduleAccess,
  moduleAllows,
  moduleCap,
  PLANS,
  resolvePlan,
  workflowAccess,
  type PlanLimits,
  type Subscription,
} from "../src/lib/billing/plans";
import {
  adminChange,
  applyChange,
  assertSeatAvailable,
  BillingError,
  createCode,
  listAccounts,
  planFor,
  readUsage,
  redeemCode,
  saveBillingSettings,
  setSeats,
} from "../src/lib/billing/store";
import { AiAllowanceError, assertAiAllowance, assertCanCreateProject, assertWithinCap, PlanLimitError } from "../src/lib/billing/guard";
import { AiBudgetError } from "../src/lib/ai/budget";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

const NOW = new Date("2026-10-07T10:00:00Z");
const sub = (over: Partial<Subscription> = {}): Subscription => ({ ...DEFAULT_SUBSCRIPTION, ...over });

test("a workspace with no subscription is on Free, or Paid while the beta is on", () => {
  assert.equal(resolvePlan(sub(), { now: NOW }).key, "free");
  const beta = resolvePlan(sub(), { now: NOW, beta: true });
  assert.equal(beta.key, "paid");
  assert.equal(beta.reason, "beta");
  assert.equal(beta.monthlyUsd, 0);
  assert.equal(resolvePlan(sub(), { now: NOW, admin: true }).limits.aiUsdPerMonth, null);
});

test("paid time and free months run out back to Free on their own", () => {
  const paid = sub({ plan: "paid", paidUntil: "2026-11-07T10:00:00Z" });
  assert.equal(resolvePlan(paid, { now: NOW }).key, "paid");
  const later = resolvePlan(paid, { now: new Date("2026-12-01T00:00:00Z") });
  assert.equal(later.key, "free");
  assert.equal(later.reason, "lapsed");

  const comped = applyChange(sub(), { type: "freeMonths", months: 3 }, NOW);
  assert.equal(comped.compUntil, "2027-01-07T10:00:00.000Z");
  const p = resolvePlan(comped, { now: NOW });
  assert.equal(p.reason, "free_months");
  assert.equal(p.monthlyUsd, 0);
  assert.equal(resolvePlan(comped, { now: new Date("2027-02-01T00:00:00Z") }).key, "free");

  // More free months stack on the end of the ones already given.
  const more = applyChange(comped, { type: "freeMonths", months: 1 }, NOW);
  assert.equal(more.compUntil, "2027-02-07T10:00:00.000Z");
  // On Paid with no end date, free months don't end the plan.
  const open = applyChange(sub({ plan: "paid" }), { type: "freeMonths", months: 2 }, NOW);
  assert.equal(open.paidUntil, null);
  assert.equal(resolvePlan(open, { now: new Date("2027-06-01T00:00:00Z") }).reason, "subscription");
});

test("extra seats make Paid a Team plan at $5 each, and dropping them makes it Paid again", () => {
  const team = applyChange(sub({ plan: "paid" }), { type: "seats", extraSeats: 3 });
  const p = resolvePlan(team, { now: NOW });
  assert.equal(p.label, "Team");
  assert.equal(p.seats, 4);
  assert.equal(p.monthlyUsd, 35);
  assert.equal(resolvePlan(applyChange(team, { type: "seats", extraSeats: 0 }), { now: NOW }).label, "Paid");
  assert.throws(() => applyChange(sub(), { type: "seats", extraSeats: 1 }), BillingError);
  // Moving to Free drops the seats.
  assert.equal(applyChange(team, { type: "assign", plan: "free", months: null }).extraSeats, 0);
});

test("discounts take percent or dollars off until they end", () => {
  const s = applyChange(sub({ plan: "paid", extraSeats: 2 }), { type: "discount", kind: "percent", value: 50, months: 3 }, NOW);
  assert.equal(discountedPrice(s, NOW), 15);
  assert.equal(discountedPrice(s, new Date("2027-03-01T00:00:00Z")), 30);
  const off = applyChange(sub({ plan: "paid" }), { type: "discount", kind: "amount", value: 25, months: null }, NOW);
  assert.equal(discountedPrice(off, NOW), 0);
  assert.equal(addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString(), "2026-02-28T00:00:00.000Z");
});

test("module and workflow rules fall back from a workflow to the plan's defaults", () => {
  const free = PLANS.free.limits;
  assert.equal(moduleAccess(free, "layout_generator"), "none");
  assert.equal(moduleAccess(free, "structured_form:brief"), "full");
  assert.equal(moduleAccess(free, "floor_plan_editor"), "limited");
  assert.equal(moduleCap(free, "floor_plan_editor", "floors"), 1);
  assert.equal(moduleAllows(free, "floor_plan_editor", "exportDxf"), false);
  // Paid has no caps.
  assert.equal(moduleCap(PLANS.paid.limits, "floor_plan_editor", "floors"), null);
  assert.equal(moduleAllows(PLANS.paid.limits, "floor_plan_editor", "exportDxf"), true);

  // A future workflow can be Paid-only, or change one module, without touching the others.
  const custom: PlanLimits = {
    ...free,
    workflows: {
      "*": { access: "full" },
      "ux-design": { access: "none" },
      "brand-workflow": { modules: { floor_plan_editor: "full" } },
    },
  };
  assert.equal(workflowAccess(custom, "ux-design"), "none");
  assert.equal(moduleAccess(custom, "documents", "ux-design"), "none");
  assert.equal(moduleAccess(custom, "floor_plan_editor", "brand-workflow"), "full");
  assert.equal(moduleCap(custom, "floor_plan_editor", "floors", "brand-workflow"), null);
  assert.equal(moduleCap(custom, "floor_plan_editor", "floors", DEFAULT_WORKFLOW_ID), 1);
});

test("plan pages list what each plan includes from its limits", () => {
  const names = Object.fromEntries(Object.values(MODULE_REGISTRY).map((m) => [m.key, m.name]));
  const free = describePlan(PLANS.free, names).map((l) => `${l.included ? "+" : "-"} ${l.text}`);
  assert.ok(free.includes("+ 1 project at a time"));
  assert.ok(free.includes("- Layout generator"));
  assert.ok(free.includes("+ Plan editor (floors per plan: 1, named versions per plan: 3)"));
  assert.ok(free.includes("- DXF export"));
  const paid = describePlan(PLANS.paid, names).map((l) => l.text);
  assert.ok(paid.includes("Every workflow, module and tool"));
});

test("a growing count is refused past its cap, but existing work stays usable", () => {
  const plan = resolvePlan(sub(), { now: NOW });
  assert.throws(() => assertWithinCap(plan, "floor_plan_editor", "floors", 2, 1, "floor"), PlanLimitError);
  assert.doesNotThrow(() => assertWithinCap(plan, "floor_plan_editor", "floors", 3, 3, "floor"));
  assert.doesNotThrow(() => assertWithinCap(plan, "floor_plan_editor", "floors", 2, 3, "floor"));
});

const project = (id: string) => ({
  id,
  name: id,
  client: "Client",
  workflowId: DEFAULT_WORKFLOW_ID,
  startDate: "2026-10-01T00:00:00.000Z",
  swatch: "sage" as const,
});

test("Free runs one project at a time once the beta is off; the Admin and Paid are not limited", async () => {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|f", email: "f@example.com" });
  const ctx = { db, workspaceId: ws, user: { platformRole: "user" } };
  await createProject(db, ws, project("one"));

  // The beta is on by default, so everyone has Paid.
  await assertCanCreateProject(ctx, DEFAULT_WORKFLOW_ID);
  await saveBillingSettings(db, { betaAllPaid: false }, "auth0|admin");
  await assert.rejects(assertCanCreateProject(ctx, DEFAULT_WORKFLOW_ID), /1 project at a time/);
  await assertCanCreateProject({ ...ctx, user: { platformRole: "admin" } }, DEFAULT_WORKFLOW_ID);

  await adminChange(db, ws, { type: "assign", plan: "paid", months: 1 }, "auth0|admin", NOW);
  await assertCanCreateProject(ctx, DEFAULT_WORKFLOW_ID);
  const usage = await readUsage(db, ws);
  assert.equal(usage.openProjects, 1);
  assert.equal(usage.members, 1);
});

test("the monthly AI allowance stops AI calls as a budget error", async () => {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|ai", email: "ai@example.com" });
  await saveBillingSettings(db, { betaAllPaid: false }, "auth0|admin");
  const created = await createProject(db, ws, project("ai-project"));
  const [{ id: projectId }] = await db.query<{ id: string }>("SELECT id FROM projects WHERE slug = $1", [created.id]);
  await assertAiAllowance(db, ws, "auth0|ai");
  await db.query(
    "INSERT INTO ai_runs (workspace_id, project_id, task_name, model_name, provider, cost_usd) VALUES ($1, $2, 'chat', 'm', 'p', 1.5)",
    [ws, projectId]
  );
  const err = await assertAiAllowance(db, ws, "auth0|ai").catch((e) => e);
  assert.ok(err instanceof AiAllowanceError);
  assert.ok(err instanceof AiBudgetError);
  // Paid's allowance is larger.
  await adminChange(db, ws, { type: "assign", plan: "paid", months: null }, "auth0|admin");
  await assertAiAllowance(db, ws, "auth0|ai");
});

test("seats can't drop below the people in the workspace, and inviting needs a free seat", async () => {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|t", email: "t@example.com" });
  await saveBillingSettings(db, { betaAllPaid: false }, "auth0|admin");
  await assert.rejects(assertSeatAvailable(db, ws), /needs the Paid plan/);
  await adminChange(db, ws, { type: "assign", plan: "paid", months: null }, "auth0|admin");
  await assert.rejects(assertSeatAvailable(db, ws), /All 1 seats are taken/);
  await setSeats(db, ws, 1, "auth0|admin");
  await assertSeatAvailable(db, ws);
  await db.query("INSERT INTO users (id, email) VALUES ('auth0|m', 'm@example.com')");
  await db.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, 'auth0|m', 'member')", [ws]);
  await assert.rejects(setSeats(db, ws, 0, "auth0|admin"), /at least 1 extra seat/);
  assert.equal((await planFor(db, ws)).label, "Team");
});

test("codes give free months or a discount, once per account and up to their limit", async () => {
  const db = await freshDb();
  const a = await ensureWorkspace(db, { sub: "auth0|a", email: "a@example.com", name: "Ann" });
  const b = await ensureWorkspace(db, { sub: "auth0|b", email: "b@example.com" });
  await saveBillingSettings(db, { betaAllPaid: false }, "auth0|admin");
  await createCode(db, { code: "welcome3", kind: "free_months", value: 3, maxRedemptions: 1 }, "auth0|admin");
  await assert.rejects(createCode(db, { code: "WELCOME3", kind: "percent", value: 10 }, "auth0|admin"), /already exists/);

  const { summary } = await redeemCode(db, a, " welcome3 ", "auth0|a", NOW);
  assert.match(summary, /3 free months of Paid, until 2027-01-07/);
  assert.equal((await planFor(db, a, { now: NOW })).reason, "free_months");
  await assert.rejects(redeemCode(db, a, "WELCOME3", "auth0|a", NOW), /already used/);
  await assert.rejects(redeemCode(db, b, "WELCOME3", "auth0|b", NOW), /used up/);
  await assert.rejects(redeemCode(db, b, "NOPE", "auth0|b", NOW), /isn't valid/);

  await createCode(db, { code: "HALF", kind: "percent", value: 50, months: 6, expiresAt: "2026-10-01T00:00:00Z" }, "auth0|admin");
  await assert.rejects(redeemCode(db, b, "HALF", "auth0|b", NOW), /isn't valid/);

  const accounts = await listAccounts(db, { query: "ann" });
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].owner?.email, "a@example.com");
  const [event] = await db.query<{ summary: string }>("SELECT summary FROM subscription_events WHERE workspace_id = $1", [a]);
  assert.match(event.summary, /Used code WELCOME3/);
});
