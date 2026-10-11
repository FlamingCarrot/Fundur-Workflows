import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { applyMutation, createProject, getProject, MutationError } from "../src/lib/projects/store";
import {
  applyPlanMutation,
  baselineSlip,
  criticalPath,
  linkConflicts,
  planMove,
  planResize,
  planShift,
  taskById,
  timelineCsv,
  undoSchedule,
  weeklyWorkload,
  workload,
  wouldLoop,
} from "../src/lib/studio/schedule";
import { addDays, phaseSpans } from "../src/lib/studio/timeline";
import { projectTasks } from "../src/lib/studio/tasks";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";
import type { Project } from "../src/lib/studio/types";

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

/** Two dated steps, the second due after the first. */
function twoSteps(project: Project) {
  const dated = projectTasks(project).filter((t) => t.due);
  const a = dated[0];
  const b = dated.find((t) => t.due! > a.due!)!;
  return { a, b };
}

test("a step is a one-day task until it is given a start", async () => {
  const { project } = await setup();
  for (const task of projectTasks(project).filter((t) => t.due)) {
    assert.equal(task.start, task.due);
    assert.deepEqual(task.after, []);
    assert.equal(task.milestone, false);
  }
});

test("moving a task pushes the tasks that wait on it, keeping their length", async () => {
  const { project } = await setup();
  const { a, b } = twoSteps(project);
  let p = applyPlanMutation(project, { type: "setTaskPlan", taskId: b.id, after: [a.id], milestone: false, estimateHours: null });
  p = applyPlanMutation(p, { type: "scheduleTasks", changes: [{ taskId: b.id, start: addDays(b.due!, -2), due: b.due! }] });

  const changes = planMove(p, a.id, addDays(b.due!, 3), addDays(b.due!, 4));
  assert.equal(changes[0].taskId, a.id);
  const pushed = changes.find((c) => c.taskId === b.id)!;
  assert.ok(pushed, "the waiting task moves too");
  assert.equal(pushed.start, addDays(b.due!, 5), "it starts the day after what it waits on");
  assert.equal(pushed.due, addDays(b.due!, 7), "and keeps its three days");

  // A move that leaves room changes nothing else.
  assert.equal(planMove(p, a.id, addDays(b.due!, -10), addDays(b.due!, -9)).length, 1);
});

test("resizing keeps the other end, and an end never crosses the start", async () => {
  const { project } = await setup();
  const { a } = twoSteps(project);
  const [longer] = planResize(project, a.id, "due", addDays(a.due!, 4));
  assert.deepEqual(longer, { taskId: a.id, start: a.due, due: addDays(a.due!, 4) });
  const [crossed] = planResize(project, a.id, "due", addDays(a.due!, -4));
  assert.equal(crossed.due, a.due);
});

test("links cannot loop, and a task starting too early is a conflict", async () => {
  const { project } = await setup();
  const { a, b } = twoSteps(project);
  const p = applyPlanMutation(project, { type: "setTaskPlan", taskId: b.id, after: [a.id], milestone: false, estimateHours: null });
  assert.equal(wouldLoop(p, a.id, [b.id]), true);
  assert.equal(wouldLoop(p, a.id, []), false);
  assert.deepEqual(linkConflicts(p), []);

  const late = applyPlanMutation(p, { type: "scheduleTasks", changes: [{ taskId: a.id, start: null, due: b.due! }] });
  assert.deepEqual(linkConflicts(late), [{ from: a.id, to: b.id }]);
});

test("the critical path runs through the tasks that decide the last day", async () => {
  const { project } = await setup();
  const tasks = projectTasks(project).filter((t) => t.due);
  const last = tasks.reduce((m, t) => (t.due! > m.due! ? t : m));
  const critical = criticalPath(project);
  assert.ok(critical.has(last.id));
  // A task the last one waits on, with no room before it, joins the path.
  const before = tasks.find((t) => t.due === addDays(last.due!, -1) || t.due! < last.due!)!;
  const linked = applyPlanMutation(
    applyPlanMutation(project, { type: "setTaskPlan", taskId: last.id, after: [before.id], milestone: false, estimateHours: null }),
    { type: "scheduleTasks", changes: [{ taskId: before.id, start: null, due: addDays(last.due!, -1) }] }
  );
  assert.ok(criticalPath(linked).has(before.id));
});

test("a baseline shows how many days the end slipped", async () => {
  const { project } = await setup();
  const saved = applyPlanMutation(project, { type: "setBaseline", save: true }, new Date("2026-10-02T00:00:00Z"));
  assert.equal(baselineSlip(saved)?.endDays, 0);
  const shifted = applyPlanMutation(saved, { type: "shiftProject", days: 9 });
  assert.equal(baselineSlip(shifted)?.endDays, 9);
  assert.equal(baselineSlip(applyPlanMutation(shifted, { type: "setBaseline", save: false })), null);
});

test("shifting a project moves every phase and every date she set", async () => {
  const { project } = await setup();
  const { a } = twoSteps(project);
  const own = { ...project, tasks: [{ id: "own-1", phaseKey: a.phaseKey, title: "Order samples", done: false, due: "2026-10-20" }] };
  const { phaseDates, changes } = planShift(own, 14);
  assert.equal(phaseDates[phaseSpans(own)[0].key], addDays(phaseSpans(own)[0].start, 14));
  assert.deepEqual(changes, [{ taskId: "own-1", start: null, due: "2026-11-03" }]);
});

test("undo puts the moved tasks back as they were", async () => {
  const { project } = await setup();
  const { a } = twoSteps(project);
  const changes = planMove(project, a.id, addDays(a.due!, 2), addDays(a.due!, 3));
  const undo = undoSchedule(project, changes);
  const moved = applyPlanMutation(project, { type: "scheduleTasks", changes });
  const back = applyPlanMutation(moved, undo);
  assert.deepEqual(taskById(back, a.id)?.due, a.due);
});

test("workload spreads hours over weekdays and sums by week", async () => {
  const { project } = await setup();
  const own: Project = {
    ...project,
    tasks: [{ id: "own-1", phaseKey: phaseSpans(project)[0].key, title: "Draw", done: false, start: "2026-11-06", due: "2026-11-09", estimateHours: 8 }],
  };
  // 6 Nov is a Friday, 9 Nov a Monday: the hours land on those two days.
  const days = workload([own], "2026-11-06", "2026-11-09");
  const hours = Object.fromEntries(days.map((d) => [d.day, d.hours]));
  assert.ok(hours["2026-11-06"] >= 4);
  assert.equal(days.find((d) => d.day === "2026-11-07")!.capacity, 0);
  const weeks = weeklyWorkload(days);
  assert.equal(weeks.length, 2);
});

test("the CSV lists every task with its dates", async () => {
  const { project } = await setup();
  const csv = timelineCsv([project]);
  const lines = csv.split("\n");
  assert.match(lines[0], /^Project,Client,Phase,Task,Start,Due/);
  assert.equal(lines.length, projectTasks(project).length + 1);
});

test("plan changes save to the database and come back the same", async () => {
  const { db, ws, project } = await setup();
  const { a, b } = twoSteps(project);
  await applyMutation(db, ws, input.id, { type: "setTaskPlan", taskId: b.id, after: [a.id], milestone: true, estimateHours: 3.5 });
  await applyMutation(db, ws, input.id, {
    type: "scheduleTasks",
    changes: planMove(project, a.id, addDays(b.due!, 1), addDays(b.due!, 2)),
  });
  let saved = (await getProject(db, ws, input.id))!;
  const savedB = taskById(saved, b.id)!;
  assert.deepEqual(savedB.after, [a.id]);
  assert.equal(savedB.milestone, true);
  assert.equal(savedB.estimateHours, 3.5);
  assert.equal(taskById(saved, a.id)!.start, addDays(b.due!, 1));
  assert.equal(taskById(saved, a.id)!.due, addDays(b.due!, 2));

  // An own task moves too, and the whole project shifts in one change.
  const ownId = "7a0e2f2e-6f7d-4a43-9d2b-0d7f3b1d1c11";
  await applyMutation(db, ws, input.id, { type: "addTask", id: ownId, phaseKey: a.phaseKey, title: "Site visit", due: "2026-10-10" });
  await applyMutation(db, ws, input.id, { type: "scheduleTasks", changes: [{ taskId: ownId, start: "2026-10-08", due: "2026-10-10" }] });
  await applyMutation(db, ws, input.id, { type: "shiftProject", days: 7 });
  saved = (await getProject(db, ws, input.id))!;
  assert.equal(taskById(saved, ownId)!.start, "2026-10-15");
  assert.equal(taskById(saved, ownId)!.due, "2026-10-17");
  assert.equal(phaseSpans(saved)[0].shiftDays, 7);

  await applyMutation(db, ws, input.id, { type: "setBaseline", save: true });
  saved = (await getProject(db, ws, input.id))!;
  assert.ok(saved.baseline?.tasks[ownId]);
  assert.equal(baselineSlip(saved)?.endDays, 0);
});

test("the server refuses loops and unknown tasks", async () => {
  const { db, ws, project } = await setup();
  const { a, b } = twoSteps(project);
  await applyMutation(db, ws, input.id, { type: "setTaskPlan", taskId: b.id, after: [a.id], milestone: false, estimateHours: null });
  await assert.rejects(
    applyMutation(db, ws, input.id, { type: "setTaskPlan", taskId: a.id, after: [b.id], milestone: false, estimateHours: null }),
    MutationError
  );
  await assert.rejects(
    applyMutation(db, ws, input.id, { type: "scheduleTasks", changes: [{ taskId: "nope", start: null, due: "2026-10-10" }] }),
    MutationError
  );
});
