import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { applyMutation, createProject, getProject, MutationError } from "../src/lib/projects/store";
import { projectMutation } from "../src/lib/projects/mutations";
import { dueGroup, groupByDue, openTasks, projectTasks, toDay } from "../src/lib/studio/tasks";
import { DEFAULT_WORKFLOW_ID, getWorkflow } from "../src/lib/workflow";
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
  const firstPhase = getWorkflow(project).phases[0];
  const step = firstPhase.checklist.find((i) => i.relativeDaysDue != null)!;
  return { db, ws, project, phaseKey: firstPhase.key, step };
}

const TASK_ID = "9c1c1f55-8a3e-4b9b-9a51-2b5c3f0e6a22";

test("every checklist step is a task, with the date the workflow gives it", async () => {
  const { project, step } = await setup();
  const tasks = projectTasks(project);
  const stepCount = getWorkflow(project).phases.reduce((n, p) => n + p.checklist.length, 0);
  assert.equal(tasks.length, stepCount);

  const task = tasks.find((t) => t.id === step.id)!;
  assert.equal(task.source, "step");
  assert.equal(task.title, step.text);
  assert.equal(task.done, false);
  assert.equal(task.dateMoved, false);
  // The project started on 1 October; the step is due that many days later.
  const expected = toDay(new Date(Date.parse(input.startDate) + step.relativeDaysDue! * 86_400_000));
  assert.equal(task.due, expected);
});

test("ticking a step marks its task done, and moving its date moves the task", async () => {
  const { db, ws, step } = await setup();
  await applyMutation(db, ws, input.id, { type: "setCheck", itemId: step.id, done: true });
  await applyMutation(db, ws, input.id, { type: "setStepDue", itemId: step.id, due: "2026-11-20" });

  const project = (await getProject(db, ws, input.id))!;
  const task = projectTasks(project).find((t) => t.id === step.id)!;
  assert.equal(task.done, true);
  assert.equal(task.due, "2026-11-20");
  assert.equal(task.dateMoved, true);

  // Moving it again changes the same record rather than adding another.
  await applyMutation(db, ws, input.id, { type: "setStepDue", itemId: step.id, due: "2026-11-21" });
  const moved = (await getProject(db, ws, input.id))!;
  assert.equal(moved.tasks.filter((t) => t.stepItemId === step.id).length, 1);
  assert.equal(projectTasks(moved).find((t) => t.id === step.id)!.due, "2026-11-21");

  // Clearing it falls back to the workflow's own date.
  await applyMutation(db, ws, input.id, { type: "setStepDue", itemId: step.id, due: null });
  const cleared = projectTasks((await getProject(db, ws, input.id))!).find((t) => t.id === step.id)!;
  assert.equal(cleared.dateMoved, false);
  assert.ok(cleared.due);
});

test("a task of her own appears beside the workflow's steps, and can be done or dropped", async () => {
  const { db, ws, phaseKey, project } = await setup();
  const before = projectTasks(project).length;
  await applyMutation(db, ws, input.id, {
    type: "addTask",
    id: TASK_ID,
    phaseKey,
    title: "Ring the landlord about the loading bay",
    due: "2026-10-09",
  });

  let saved = (await getProject(db, ws, input.id))!;
  const mine = projectTasks(saved).find((t) => t.id === TASK_ID)!;
  assert.equal(projectTasks(saved).length, before + 1);
  assert.equal(mine.source, "own");
  assert.equal(mine.title, "Ring the landlord about the loading bay");
  assert.equal(mine.due, "2026-10-09");
  assert.equal(mine.done, false);

  await applyMutation(db, ws, input.id, { type: "updateTask", taskId: TASK_ID, done: true, due: "2026-10-12" });
  saved = (await getProject(db, ws, input.id))!;
  const changed = projectTasks(saved).find((t) => t.id === TASK_ID)!;
  assert.equal(changed.done, true);
  assert.equal(changed.due, "2026-10-12");
  // A field the change does not name is left alone.
  assert.equal(changed.title, "Ring the landlord about the loading bay");

  await applyMutation(db, ws, input.id, { type: "deleteTask", taskId: TASK_ID });
  assert.equal(projectTasks((await getProject(db, ws, input.id))!).length, before);
});

test("a task carries the document it produced, and a step cannot be deleted", async () => {
  const { db, ws, step, phaseKey } = await setup();
  const docId = "6f1c1f55-8a3e-4b9b-9a51-2b5c3f0e6a11";
  await applyMutation(db, ws, input.id, {
    type: "addDocuments",
    documents: [
      {
        id: docId,
        name: "Measured survey.pdf",
        sizeBytes: 1024,
        phaseKey,
        uploadedAt: "2026-10-02T09:00:00.000Z",
        clientVisible: false,
      },
    ],
  });
  await applyMutation(db, ws, input.id, { type: "setStepOutput", itemId: step.id, documentId: docId });

  const project = (await getProject(db, ws, input.id))!;
  const task = projectTasks(project).find((t) => t.id === step.id)!;
  assert.equal(task.outputDocumentId, docId);
  assert.ok(project.documents.some((d) => d.id === task.outputDocumentId));

  // Deleting a workflow step is not hers to do; it leaves the record alone.
  const record = project.tasks.find((t) => t.stepItemId === step.id)!;
  await applyMutation(db, ws, input.id, { type: "deleteTask", taskId: record.id });
  const after = (await getProject(db, ws, input.id))!;
  assert.equal(projectTasks(after).find((t) => t.id === step.id)!.outputDocumentId, docId);

  // And a step that is not in the workflow is refused.
  await assert.rejects(
    () => applyMutation(db, ws, input.id, { type: "setStepDue", itemId: "made-up", due: "2026-10-09" }),
    MutationError
  );
});

test("the due list groups open tasks across projects", async () => {
  const { db, ws, phaseKey } = await setup();
  await applyMutation(db, ws, input.id, { type: "addTask", id: TASK_ID, phaseKey, title: "Overdue thing", due: "2026-10-01" });
  const project = (await getProject(db, ws, input.id))!;

  const today = "2026-10-06";
  assert.equal(dueGroup({ due: "2026-10-01" }, today), "overdue");
  assert.equal(dueGroup({ due: today }, today), "today");
  assert.equal(dueGroup({ due: "2026-10-12" }, today), "this_week");
  assert.equal(dueGroup({ due: "2026-11-30" }, today), "later");
  assert.equal(dueGroup({}, today), "no_date");

  const open = openTasks([project]);
  assert.ok(open.every((t) => !t.done));
  assert.equal(open[0].id, TASK_ID, "the oldest due date comes first");
  const groups = groupByDue(open, today);
  assert.equal(groups[0].group, "overdue");
  assert.ok(groups[0].tasks.some((t) => t.id === TASK_ID));

  // A project that is not active is left out of the cross-project list.
  const onHold: Project = { ...project, status: "on_hold" };
  assert.deepEqual(openTasks([onHold]), []);
});

test("a task's title and date are checked before they are saved", () => {
  assert.equal(projectMutation.safeParse({ type: "addTask", id: TASK_ID, phaseKey: "discovery", title: "  " }).success, false);
  assert.equal(
    projectMutation.safeParse({ type: "addTask", id: TASK_ID, phaseKey: "discovery", title: "Call", due: "9 October" }).success,
    false
  );
  assert.equal(
    projectMutation.safeParse({ type: "addTask", id: TASK_ID, phaseKey: "discovery", title: "Call", due: "2026-10-09" }).success,
    true
  );
  // Clearing a date is sent as null, which is allowed; leaving it out keeps it.
  assert.equal(projectMutation.safeParse({ type: "setStepDue", itemId: "a", due: null }).success, true);
  assert.equal(projectMutation.safeParse({ type: "updateTask", taskId: TASK_ID, done: true }).success, true);
});

test("a task output cannot refer to a document outside its project", async () => {
  const { db, ws, phaseKey, step } = await setup();
  await createProject(db, ws, { ...input, id: "other-project" });
  const documentId = "3d2c4a66-13a0-4145-914d-622bf1cafaaa";
  await applyMutation(db, ws, "other-project", { type: "addDocuments", documents: [{ id: documentId, name: "Other client's quote.pdf", phaseKey, sizeBytes: 50, clientVisible: false, uploadedAt: new Date().toISOString() }] });
  await assert.rejects(applyMutation(db, ws, input.id, { type: "setStepOutput", itemId: step.id, documentId }), MutationError);
  await applyMutation(db, ws, input.id, { type: "addTask", id: TASK_ID, phaseKey, title: "Review quote" });
  await assert.rejects(applyMutation(db, ws, input.id, { type: "updateTask", taskId: TASK_ID, outputDocumentId: documentId }), MutationError);
});
