import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { applyMutation, createProject, getProject, listProjects, MutationError } from "../src/lib/projects/store";
import { getWorkflow, DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";

function connection(pg: PGlite) {
  return {
    exec: (sql: string) => pg.exec(sql),
    query: (text: string, params?: unknown[]) => pg.query<Record<string, unknown>>(text, params),
  };
}

// A real Postgres, in process, with the same migrations a deploy runs.
async function freshDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  await runMigrations(connection(pg));
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  return { db, pg };
}

const input = {
  id: "harbour-house",
  name: "Harbour House",
  client: "Harbour Holdings",
  workflowId: DEFAULT_WORKFLOW_ID,
  startDate: "2026-10-01T00:00:00.000Z",
  swatch: "sage" as const,
};

test("migrations apply once and are skipped on the next deploy", async () => {
  const conn = connection(new PGlite());
  const first = await runMigrations(conn);
  assert.deepEqual(first, ["001_initial.sql", "002_projects_app_state.sql", "003_admin_and_ai_settings.sql", "004_ai_run_log.sql", "005_files_and_snapshots.sql", "006_issue_tickets.sql"]);
  assert.deepEqual(await runMigrations(conn), []);
});

test("a first sign-in gets its own workspace, and later sign-ins reuse it", async () => {
  const { db } = await freshDb();
  const a = await ensureWorkspace(db, { sub: "auth0|a", email: "a@example.com", name: "Ann" });
  assert.equal(await ensureWorkspace(db, { sub: "auth0|a", email: "a@example.com", name: "Ann" }), a);
  const b = await ensureWorkspace(db, { sub: "google-oauth2|b", email: null, name: null });
  assert.notEqual(a, b);
  // Two Auth0 connections can share an email; the user id is the identity.
  const c = await ensureWorkspace(db, { sub: "google-oauth2|a", email: "a@example.com", name: "Ann" });
  assert.notEqual(a, c);
});

test("a created project reads back as the app shows it", async () => {
  const { db } = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  const created = await createProject(db, ws, input);
  const wf = getWorkflow(DEFAULT_WORKFLOW_ID);
  assert.equal(created.id, "harbour-house");
  assert.equal(created.workflowVersion, wf.version);
  assert.equal(created.currentPhase, wf.phases[0].key);
  assert.equal(created.status, "active");
  assert.equal(created.brief.clientName, "Harbour Holdings");
  assert.equal(created.startDate, input.startDate);
  assert.deepEqual(await listProjects(db, ws), [created]);
});

test("a taken slug gets a suffix instead of failing", async () => {
  const { db } = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);
  const second = await createProject(db, ws, input);
  assert.match(second.id, /^harbour-house-[a-z0-9]+$/);
  assert.equal((await listProjects(db, ws)).length, 2);
});

test("workspaces are isolated: another studio can neither see nor change a project", async () => {
  const { db } = await freshDb();
  const a = await ensureWorkspace(db, { sub: "auth0|a" });
  const b = await ensureWorkspace(db, { sub: "auth0|b" });
  await createProject(db, a, input);

  assert.deepEqual(await listProjects(db, b), []);
  assert.equal(await getProject(db, b, input.id), null);
  assert.equal(await applyMutation(db, b, input.id, { type: "setWaitingOn", waitingOn: "client" }), null);
  assert.equal((await getProject(db, a, input.id))!.waitingOn, "me");

  // The same slug is free in another workspace, and the two stay separate.
  const theirs = await createProject(db, b, input);
  assert.equal(theirs.id, input.id);
  await applyMutation(db, b, input.id, { type: "setStatus", status: "on_hold" });
  assert.equal((await getProject(db, a, input.id))!.status, "active");
});

test("checklist ticks, waiting-on and status save", async () => {
  const { db } = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);
  const item = getWorkflow(DEFAULT_WORKFLOW_ID).phases[0].checklist[0];
  await applyMutation(db, ws, input.id, { type: "setCheck", itemId: item.id, done: true });
  await applyMutation(db, ws, input.id, { type: "setWaitingOn", waitingOn: "client" });
  const p = await applyMutation(db, ws, input.id, { type: "setStatus", status: "on_hold" });
  assert.deepEqual(p!.checks, { [item.id]: true });
  assert.equal(p!.waitingOn, "client");
  assert.equal(p!.status, "on_hold");
  await assert.rejects(
    applyMutation(db, ws, input.id, { type: "setCheck", itemId: "not-an-item", done: true }),
    MutationError
  );
});

test("the server refuses to complete a phase whose essentials are open", async () => {
  const { db } = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);
  const [first, second] = getWorkflow(DEFAULT_WORKFLOW_ID).phases;

  let p = await applyMutation(db, ws, input.id, { type: "completePhase", phaseKey: first.key });
  assert.equal(p!.currentPhase, first.key);

  for (const item of first.checklist.filter((i) => i.essential)) {
    await applyMutation(db, ws, input.id, { type: "setCheck", itemId: item.id, done: true });
  }
  p = await applyMutation(db, ws, input.id, { type: "completePhase", phaseKey: first.key });
  assert.equal(p!.currentPhase, second.key);
  assert.deepEqual(p!.completedPhases, [first.key]);

  // Completing it again (a stale tab) changes nothing.
  p = await applyMutation(db, ws, input.id, { type: "completePhase", phaseKey: first.key });
  assert.equal(p!.currentPhase, second.key);
  assert.deepEqual(p!.completedPhases, [first.key]);
});

test("brief edits merge by field and keep the AI-draft marks right", async () => {
  const { db } = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);
  await applyMutation(db, ws, input.id, { type: "updateBrief", patch: { headcount: "140", notes: "Warm" }, fromAi: true });
  const p = await applyMutation(db, ws, input.id, { type: "updateBrief", patch: { headcount: "150" }, fromAi: false });
  assert.equal(p!.brief.headcount, "150");
  assert.equal(p!.brief.notes, "Warm");
  assert.equal(p!.brief.clientName, "Harbour Holdings");
  assert.deepEqual(p!.briefAiFields, ["notes"]);
  await assert.rejects(
    applyMutation(db, ws, input.id, { type: "updateBrief", patch: { nope: "x" }, fromAi: false }),
    MutationError
  );
});

test("documents save", async () => {
  const { db } = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);
  const doc = {
    id: "6f1c1f55-8a3e-4b9b-9a51-2b5c3f0e6a11",
    name: "Floor plate.dwg",
    sizeBytes: 2_400_000,
    phaseKey: "discovery",
    uploadedAt: "2026-10-02T09:00:00.000Z",
    clientVisible: false,
  };
  let p = await applyMutation(db, ws, input.id, { type: "addDocuments", documents: [doc] });
  // Without a storage path only the name is recorded.
  assert.deepEqual(p!.documents, [{ ...doc, stored: false, version: 1 }]);
  p = await applyMutation(db, ws, input.id, { type: "setClientVisible", documentId: doc.id, clientVisible: true });
  assert.equal(p!.documents[0].clientVisible, true);


  // Another workspace cannot flip a document it does not own.
  const other = await ensureWorkspace(db, { sub: "auth0|b" });
  await createProject(db, other, input);
  await applyMutation(db, other, input.id, { type: "setClientVisible", documentId: doc.id, clientVisible: false });
  assert.equal((await getProject(db, ws, input.id))!.documents[0].clientVisible, true);
});

test("a phase is not completed if an essential is unticked while the completion is on its way", async () => {
  const { db } = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);
  const [first] = getWorkflow(DEFAULT_WORKFLOW_ID).phases;
  const essentials = first.checklist.filter((i) => i.essential);
  for (const item of essentials) {
    await applyMutation(db, ws, input.id, { type: "setCheck", itemId: item.id, done: true });
  }
  // A collaborator unticks an essential after the completion read the project, before it writes.
  const racing: Db = {
    query: async (text, params) => {
      if (text.includes("SET completed_phases")) {
        await applyMutation(db, ws, input.id, { type: "setCheck", itemId: essentials[0].id, done: false });
      }
      return db.query(text, params);
    },
  };
  const p = await applyMutation(racing, ws, input.id, { type: "completePhase", phaseKey: first.key });
  assert.equal(p!.currentPhase, first.key);
  assert.deepEqual(p!.completedPhases, []);
});
