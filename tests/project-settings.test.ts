import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { applyMutation, createProject, deleteProject, getProject, MutationError } from "../src/lib/projects/store";
import { projectMutation } from "../src/lib/projects/mutations";
import { baseWorkflow, DEFAULT_WORKFLOW_ID, getWorkflow, usesModule } from "../src/lib/workflow";
import {
  applyCustomization,
  applyWorkflowChange,
  EMPTY_CUSTOMIZATION,
  workflowOutline,
  WorkflowChangeError,
  type ProjectProgress,
  type WorkflowChange,
  type WorkflowCustomization,
} from "../src/lib/workflow/custom";
import { phaseProgress } from "../src/lib/studio/selectors";
import { completePhase, newProject } from "../src/lib/studio/transitions";
import { projectTasks } from "../src/lib/studio/tasks";
import type { Project } from "../src/lib/studio/types";

const base = baseWorkflow(DEFAULT_WORKFLOW_ID);
const [first, second, third] = base.phases;
const atStart: ProjectProgress = { currentPhase: first.key, completedPhases: [] };

function apply(changes: WorkflowChange[], progress = atStart, from: WorkflowCustomization = EMPTY_CUSTOMIZATION) {
  return changes.reduce((c, ch) => applyWorkflowChange(base, c, progress, ch), from);
}

function project(custom?: WorkflowCustomization): Project {
  const p = newProject({ id: "p", name: "P", client: "C", workflowId: DEFAULT_WORKFLOW_ID, startDate: "2026-10-01T00:00:00.000Z", swatch: "clay" });
  return custom ? { ...p, workflowCustom: custom } : p;
}

test("an unchanged project runs on its definition exactly", () => {
  assert.equal(getWorkflow(project()), base);
  assert.equal(applyCustomization(base, EMPTY_CUSTOMIZATION), base);
});

test("default phases and steps switch off and back on, but are never removed", () => {
  const step = second.checklist[0];
  const off = apply([
    { type: "setPhaseEnabled", phaseKey: third.key, enabled: false },
    { type: "setStepEnabled", itemId: step.id, enabled: false },
  ]);
  const wf = applyCustomization(base, off);
  assert.ok(!wf.phases.some((p) => p.key === third.key));
  assert.ok(!wf.phases.find((p) => p.key === second.key)!.checklist.some((i) => i.id === step.id));
  // Still in the outline, switched off, so settings can switch them back on.
  const outline = workflowOutline(base, off);
  assert.equal(outline.find((p) => p.phase.key === third.key)!.enabled, false);

  const on = apply([
    { type: "setPhaseEnabled", phaseKey: third.key, enabled: true },
    { type: "setStepEnabled", itemId: step.id, enabled: true },
  ], atStart, off);
  assert.deepEqual(applyCustomization(base, on).phases.map((p) => p.key), base.phases.map((p) => p.key));

  assert.throws(() => apply([{ type: "removePhase", phaseKey: third.key }]), WorkflowChangeError);
  assert.throws(() => apply([{ type: "removeStep", itemId: step.id }]), WorkflowChangeError);
});

test("custom phases, steps and modules are added, edited, moved and removed", () => {
  const custom = apply([
    { type: "addPhase", key: "site-measure", name: "Site measure", after: first.key },
    { type: "addStep", id: "measure-1", phaseKey: "site-measure", text: "Measure every room", essential: true, relativeDaysDue: 4 },
    { type: "addStep", id: "measure-2", phaseKey: "site-measure", text: "Photograph services" },
    { type: "moveStep", itemId: "measure-2", after: null },
    { type: "updateStep", itemId: "measure-1", text: "Measure every room and ceiling", modules: ["floor_plan_editor"] },
    { type: "updatePhase", phaseKey: "site-measure", modules: ["checklist", "documents"] },
    { type: "addStep", id: "disc-extra", phaseKey: first.key, text: "Confirm parking for the site visit" },
  ]);
  const wf = applyCustomization(base, custom);
  assert.deepEqual(wf.phases.slice(0, 3).map((p) => p.key), [first.key, "site-measure", second.key]);
  const measure = wf.phases[1];
  assert.deepEqual(measure.checklist.map((i) => i.id), ["measure-2", "measure-1"]);
  assert.equal(measure.checklist[1].text, "Measure every room and ceiling");
  assert.deepEqual(measure.checklist[1].modules, ["floor_plan_editor"]);
  assert.deepEqual(measure.modules, ["checklist", "documents"]);
  assert.ok(wf.phases[0].checklist.some((i) => i.id === "disc-extra"));

  // Added steps are tasks like any other, with their date counted from the start.
  const tasks = projectTasks(project(custom));
  assert.equal(tasks.find((t) => t.id === "measure-1")!.due, "2026-10-05");

  const removed = apply([{ type: "removePhase", phaseKey: "site-measure" }], atStart, custom);
  assert.ok(!applyCustomization(base, removed).phases.some((p) => p.key === "site-measure"));
  assert.ok(!removed.customSteps.some((s) => s.phaseKey === "site-measure"));
});

test("a phase can be tool cards only, and then completes without steps", () => {
  const custom = apply([
    { type: "addPhase", key: "pick-doc", name: "Pick a document", modules: ["documents"], after: first.key },
  ]);
  const p = { ...project(custom), completedPhases: [first.key], currentPhase: "pick-doc" };
  assert.equal(phaseProgress(p, "pick-doc").ready, true);
  assert.equal(completePhase(p, "pick-doc").currentPhase, second.key);
});

test("default names and essentials can be changed per project", () => {
  const step = first.checklist[0];
  const custom = apply([
    { type: "updatePhase", phaseKey: first.key, name: "Brief" },
    { type: "updateStep", itemId: step.id, essential: false, relativeDaysDue: null },
  ]);
  const wf = applyCustomization(base, custom);
  assert.equal(wf.phases[0].name, "Brief");
  const item = wf.phases[0].checklist.find((i) => i.id === step.id)!;
  assert.equal(item.essential, false);
  assert.equal(item.relativeDaysDue, undefined);
});

test("phases the project is in or past keep their place", () => {
  const progress = { currentPhase: second.key, completedPhases: [first.key] };
  assert.throws(() => apply([{ type: "setPhaseEnabled", phaseKey: second.key, enabled: false }], progress), /open or complete/);
  assert.throws(() => apply([{ type: "setPhaseEnabled", phaseKey: first.key, enabled: false }], progress), /open or complete/);
  assert.throws(() => apply([{ type: "movePhase", phaseKey: third.key, after: null }], progress), WorkflowChangeError);
  assert.throws(() => apply([{ type: "addPhase", key: "x", name: "X", after: first.key }], progress), WorkflowChangeError);
  // After the open phase is fine.
  const ok = apply([{ type: "addPhase", key: "x", name: "X", after: second.key }], progress);
  assert.equal(applyCustomization(base, ok).phases[2].key, "x");
});

test("unknown modules, clashing ids and an empty workflow are refused", () => {
  assert.throws(() => apply([{ type: "updatePhase", phaseKey: first.key, modules: ["teleporter"] }]), /module library/);
  assert.throws(() => apply([{ type: "addStep", id: first.checklist[0].id, phaseKey: first.key, text: "Dup" }]), /already exists/);
  assert.throws(() => apply([{ type: "addPhase", key: first.key, name: "Dup" }]), /already exists/);
  const allButFirst = base.phases.slice(1).map((p) => ({ type: "setPhaseEnabled" as const, phaseKey: p.key, enabled: false }));
  const lonely = apply(allButFirst);
  assert.equal(applyCustomization(base, lonely).phases.length, 1);
});

test("layout rules belong to projects whose workflow lays out floors", () => {
  assert.equal(usesModule(project(), "layout_generator"), true);
  const layoutPhase = base.phases.find((p) => p.modules.includes("layout_generator"))!;
  const custom = apply([
    { type: "updatePhase", phaseKey: layoutPhase.key, modules: layoutPhase.modules.filter((m) => m !== "layout_generator") },
  ]);
  assert.equal(usesModule(project(custom), "layout_generator"), false);
});

// ---------------------------------------------------------------------------
// In the database
// ---------------------------------------------------------------------------

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({
    exec: (sql: string) => pg.exec(sql),
    query: (text: string, params?: unknown[]) => pg.query<Record<string, unknown>>(text, params),
  });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

const input = {
  id: "harbour-house",
  name: "Harbour House",
  client: "Harbour Holdings",
  workflowId: DEFAULT_WORKFLOW_ID,
  startDate: "2026-10-01T00:00:00.000Z",
  swatch: "sage" as const,
};

test("workflow changes and details save, and the server refuses what the browser would", async () => {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);

  const change = (c: WorkflowChange) => applyMutation(db, ws, input.id, projectMutation.parse({ type: "customizeWorkflow", change: c }));
  await change({ type: "addPhase", key: "site-measure", name: "Site measure", after: first.key });
  await change({ type: "addStep", id: "measure-1", phaseKey: "site-measure", text: "Measure every room", essential: true });
  const saved = await change({ type: "setStepEnabled", itemId: first.checklist[0].id, enabled: false });
  assert.ok(saved);
  const wf = getWorkflow(saved);
  assert.equal(wf.phases[1].key, "site-measure");
  assert.ok(!wf.phases[0].checklist.some((i) => i.id === first.checklist[0].id));

  // An added step ticks like a default one.
  const ticked = await applyMutation(db, ws, input.id, { type: "setCheck", itemId: "measure-1", done: true });
  assert.equal(ticked!.checks["measure-1"], true);

  await assert.rejects(change({ type: "removeStep", itemId: first.checklist[1].id }), MutationError);
  await assert.rejects(change({ type: "setPhaseEnabled", phaseKey: first.key, enabled: false }), MutationError);

  const renamed = await applyMutation(db, ws, input.id, { type: "updateDetails", name: "Harbour House, Level 2", swatch: "oak", startDate: "2026-11-02T00:00:00.000Z" });
  assert.equal(renamed!.name, "Harbour House, Level 2");
  assert.equal(renamed!.client, "Harbour Holdings");
  assert.equal(renamed!.swatch, "oak");
  assert.equal(renamed!.startDate, "2026-11-02T00:00:00.000Z");

  // Removing the only change leaves an unchanged workflow.
  await change({ type: "removePhase", phaseKey: "site-measure" });
  const back = await change({ type: "setStepEnabled", itemId: first.checklist[0].id, enabled: true });
  assert.equal(getWorkflow(back!).phases.length, base.phases.length);
});

test("a deleted project is gone, with nothing left in another workspace touched", async () => {
  const db = await freshDb();
  const a = await ensureWorkspace(db, { sub: "auth0|a" });
  const b = await ensureWorkspace(db, { sub: "auth0|b" });
  await createProject(db, a, input);
  await createProject(db, b, input);
  assert.equal(await deleteProject(db, b, "nope"), false);
  assert.equal(await deleteProject(db, a, input.id), true);
  assert.equal(await getProject(db, a, input.id), null);
  assert.ok(await getProject(db, b, input.id));
});
