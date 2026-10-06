import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { applyMutation, createProject, getProject, MutationError } from "../src/lib/projects/store";
import { addDays, daysBetween, phaseSpans, plannedSpans, projectRange, timelineRange } from "../src/lib/studio/timeline";
import { projectTasks } from "../src/lib/studio/tasks";
import { DEFAULT_WORKFLOW_ID, getWorkflow } from "../src/lib/workflow";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
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

async function setup() {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a", email: "a@example.com" });
  const project = await createProject(db, ws, input);
  return { db, ws, project };
}

test("each phase runs from its first dated step to its last, in order", async () => {
  const { project } = await setup();
  const spans = plannedSpans(project);
  assert.equal(spans.length, getWorkflow(project).phases.length);
  assert.ok(spans.every((s) => s.end >= s.start));
  assert.ok(spans.every((s) => s.days >= 1));
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i].start >= spans[i - 1].end, "a phase never starts before the one before it ends");
  }
  assert.ok(spans.every((s) => s.shiftDays === 0), "nothing is moved on a fresh project");
});

test("moving a phase moves its steps with it", async () => {
  const { db, ws, project } = await setup();
  const [first] = plannedSpans(project);
  const stepsBefore = projectTasks(project).filter((t) => t.phaseKey === first.key && t.due);
  assert.ok(stepsBefore.length > 0);

  const moved = addDays(first.start, 10);
  await applyMutation(db, ws, input.id, { type: "setPhaseStart", phaseKey: first.key, start: moved });
  const after = (await getProject(db, ws, input.id))!;

  const span = phaseSpans(after).find((s) => s.key === first.key)!;
  assert.equal(span.start, moved);
  assert.equal(span.shiftDays, 10);
  assert.equal(span.days, first.days, "the phase keeps its length");

  for (const before of stepsBefore) {
    const now = projectTasks(after).find((t) => t.id === before.id)!;
    assert.equal(now.due, addDays(before.due!, 10));
  }
  // A project runs in order, so the phases after it come along by the same days.
  const planned = plannedSpans(project);
  for (let i = 1; i < planned.length; i++) {
    assert.equal(phaseSpans(after)[i].shiftDays, 10);
    assert.equal(phaseSpans(after)[i].start, addDays(planned[i].start, 10));
  }
});

test("a date she set on a step stays where she put it when its phase moves", async () => {
  const { db, ws, project } = await setup();
  const [first] = plannedSpans(project);
  const step = projectTasks(project).find((t) => t.phaseKey === first.key && t.due)!;
  await applyMutation(db, ws, input.id, { type: "setStepDue", itemId: step.id, due: "2026-11-30" });
  await applyMutation(db, ws, input.id, { type: "setPhaseStart", phaseKey: first.key, start: addDays(first.start, 7) });

  const after = (await getProject(db, ws, input.id))!;
  assert.equal(projectTasks(after).find((t) => t.id === step.id)!.due, "2026-11-30");
});

test("putting a phase back clears the move, and an unknown phase is refused", async () => {
  const { db, ws, project } = await setup();
  const [first] = plannedSpans(project);
  await applyMutation(db, ws, input.id, { type: "setPhaseStart", phaseKey: first.key, start: addDays(first.start, 5) });
  await applyMutation(db, ws, input.id, { type: "setPhaseStart", phaseKey: first.key, start: null });

  const after = (await getProject(db, ws, input.id))!;
  assert.equal(after.phaseDates?.[first.key], undefined);
  assert.equal(phaseSpans(after)[0].start, first.start);

  await assert.rejects(
    () => applyMutation(db, ws, input.id, { type: "setPhaseStart", phaseKey: "made-up", start: "2026-11-01" }),
    MutationError
  );
});

test("the timeline covers every project shown, and today", async () => {
  const { project } = await setup();
  const range = timelineRange([project]);
  const own = projectRange(project);
  assert.ok(range.start <= own.start);
  assert.ok(range.end >= own.end);
  assert.equal(range.days, daysBetween(range.start, range.end) + 1);
  assert.deepEqual(timelineRange([]).days > 0, true, "an empty timeline still has a range to draw");
});
