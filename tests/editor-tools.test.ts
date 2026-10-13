import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { applyAction, canApplyDirectly, undoFor, type AssistantAction } from "../src/lib/ai/actions";
import { runTool, toolSpecs, listTools } from "../src/lib/ai/tools";
import { createProject, getProject } from "../src/lib/projects/store";
import { taskById } from "../src/lib/studio/schedule";
import { DEFAULT_WORKFLOW_ID, getWorkflow } from "../src/lib/workflow";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";

async function setup() {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  const ws = await ensureWorkspace(db, { sub: "auth0|designer" });
  await createProject(db, ws, { id: "harbour-house", name: "Harbour House", client: "Harbour Holdings", workflowId: DEFAULT_WORKFLOW_ID, startDate: "2026-10-01T00:00:00.000Z", swatch: "sage" });
  return { db, ws };
}

async function use(db: Db, ws: string, name: string, input: unknown) {
  const project = (await getProject(db, ws, "harbour-house"))!;
  const out = await runTool({ db, run: { workspaceId: ws, projectId: null, userId: "u" }, project, readFile: async () => null } as never, name, input);
  return { project, out };
}

/** Applies a tool's proposal as the assistant would, then undoes it; returns the project in between. */
async function applyAndUndo(db: Db, ws: string, action: AssistantAction) {
  const before = (await getProject(db, ws, "harbour-house"))!;
  const undo = undoFor(before, action);
  const after = await applyAction(db, ws, "harbour-house", action);
  assert.ok(undo, "it can be undone");
  const restored = await applyAction(db, ws, "harbour-house", undo!);
  return { before, after, restored };
}

test("every editor tool has a schema the model can read", () => {
  const names = listTools().map((t) => t.name);
  for (const n of ["read_timeline", "plan_timeline", "set_baseline", "update_project_details", "edit_workflow"]) assert.ok(names.includes(n), n);
  assert.doesNotThrow(() => toolSpecs());
});

test("timeline: plan dates, links, milestones and estimates, applied and undone", async () => {
  const { db, ws } = await setup();
  const project = (await getProject(db, ws, "harbour-house"))!;
  const [a, b] = getWorkflow(project).phases[0].checklist;
  const read = await use(db, ws, "read_timeline", {});
  assert.match(String(read.out.content), new RegExp(`id ${a.id}`));

  const { out } = await use(db, ws, "plan_timeline", {
    changes: [
      { taskId: a.id, start: "2026-10-05", due: "2026-10-09", estimateHours: 6 },
      { taskId: b.id, due: "2026-10-12", after: [a.id], milestone: true },
    ],
  });
  const action = out.proposals![0].mutation as AssistantAction;
  assert.ok(canApplyDirectly(project, action));
  const { after, restored } = await applyAndUndo(db, ws, action);
  const ta = taskById(after, a.id)!;
  assert.equal(ta.start, "2026-10-05");
  assert.equal(ta.due, "2026-10-09");
  assert.equal(ta.estimateHours, 6);
  const tb = taskById(after, b.id)!;
  assert.deepEqual(tb.after, [a.id]);
  assert.equal(tb.milestone, true);
  assert.equal(taskById(restored, b.id)?.milestone ?? false, false);
  assert.equal(taskById(restored, a.id)?.estimateHours ?? null, null);

  const bad = await use(db, ws, "plan_timeline", { changes: [{ taskId: "nope", due: "2026-10-01" }] });
  assert.equal(bad.out.isError, true);
});

test("project details change and change back", async () => {
  const { db, ws } = await setup();
  const { out } = await use(db, ws, "update_project_details", { name: "Harbour House Penthouse", startDate: "2026-11-01" });
  const { after, restored } = await applyAndUndo(db, ws, out.proposals![0].mutation as AssistantAction);
  assert.equal(after.name, "Harbour House Penthouse");
  assert.equal(after.startDate.slice(0, 10), "2026-11-01");
  assert.equal(restored.name, "Harbour House");
  assert.equal(restored.startDate.slice(0, 10), "2026-10-01");
});

test("workflow: add a step after another and a phase, waiting for her", async () => {
  const { db, ws } = await setup();
  const project = (await getProject(db, ws, "harbour-house"))!;
  const phases = getWorkflow(project).phases;
  const last = phases[phases.length - 1];
  const first = last.checklist[0];
  const { out } = await use(db, ws, "edit_workflow", {
    changes: [
      { type: "addStep", phaseKey: last.key, text: "Photograph the finished space", essential: false, after: first.id },
      { type: "addPhase", name: "Aftercare", after: last.key },
      { type: "updateStep", itemId: first.id, text: `${first.text} (with the client)` },
    ],
  });
  assert.equal(out.isError, undefined, String(out.content));
  const action = out.proposals![0].mutation as AssistantAction;
  assert.equal(canApplyDirectly(project, action), false, "workflow changes wait for her");
  const after = await applyAction(db, ws, "harbour-house", action);
  const flow = getWorkflow(after);
  const lastAfter = flow.phases.find((p) => p.key === last.key)!;
  assert.equal(lastAfter.checklist[1].text, "Photograph the finished space");
  assert.equal(lastAfter.checklist[0].text, `${first.text} (with the client)`);
  assert.equal(flow.phases.at(-1)?.name, "Aftercare");

  const bad = await use(db, ws, "edit_workflow", { changes: [{ type: "removeStep", itemId: "no-such-step" }] });
  assert.equal(bad.out.isError, true);
});
