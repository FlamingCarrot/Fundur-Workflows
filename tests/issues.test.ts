import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { createProject, projectDbId } from "../src/lib/projects/store";
import { createIssue, listMyIssues, listTickets, updateMyIssue, updateTicket } from "../src/lib/issues/store";
import { isActiveIssue } from "../src/lib/studio/types";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

const project = {
  id: "harbour-house",
  name: "Harbour House",
  client: "Harbour Holdings",
  workflowId: DEFAULT_WORKFLOW_ID,
  startDate: "2026-10-01T00:00:00.000Z",
  swatch: "sage" as const,
};

async function setup() {
  const db = await freshDb();
  const designer = await syncUser(db, { sub: "auth0|designer", email: "designer@example.com", name: "Dee" });
  const ws = await ensureWorkspace(db, { sub: "auth0|designer", email: "designer@example.com", name: "Dee" });
  await createProject(db, ws, project);
  return { db, ws, designer };
}

test("two reports on one module show a count of two for the reporter", async () => {
  const { db, ws, designer } = await setup();
  await createIssue(db, ws, designer.id, { moduleKey: "documents", note: "Upload spun forever", path: "/projects/harbour-house/documents", projectId: project.id });
  await createIssue(db, ws, designer.id, { moduleKey: "documents", note: "The names are cut off", path: "/projects/harbour-house/documents", projectId: project.id });
  await createIssue(db, ws, designer.id, { moduleKey: "checklist", note: "Tick didn't stick", path: "/projects/harbour-house/phases/discovery" });

  const mine = await listMyIssues(db, ws, designer.id);
  assert.equal(mine.length, 3);
  assert.equal(mine.filter((i) => i.moduleKey === "documents" && isActiveIssue(i)).length, 2);
  // The project it was reported in comes back as the app's own project id.
  assert.equal(mine.find((i) => i.moduleKey === "documents")!.projectId, project.id);
  assert.equal(mine.find((i) => i.moduleKey === "checklist")!.projectId, undefined);
  assert.ok(mine.every((i) => i.status === "open"));
});

test("a reporter can edit and close their own report, but not someone else's", async () => {
  const { db, ws, designer } = await setup();
  const other = await syncUser(db, { sub: "auth0|other", email: "other@example.com" });
  const issue = await createIssue(db, ws, designer.id, { moduleKey: "documents", note: "First try", path: "/x" });

  const edited = await updateMyIssue(db, ws, designer.id, issue.id, { note: "With more detail" });
  assert.equal(edited?.note, "With more detail");
  assert.equal(await updateMyIssue(db, ws, other.id, issue.id, { note: "Mine now" }), null);

  assert.equal((await updateMyIssue(db, ws, designer.id, issue.id, { close: true }))?.status, "closed");
  assert.deepEqual(await listMyIssues(db, ws, designer.id), []);
  // Closing it twice changes nothing.
  assert.equal(await updateMyIssue(db, ws, designer.id, issue.id, { close: true }), null);
});

test("a new report is a ticket in the admin queue, with its module, page and note", async () => {
  const { db, ws, designer } = await setup();
  const pid = (await projectDbId(db, ws, project.id))!;
  assert.ok(pid);
  await createIssue(db, ws, designer.id, {
    moduleKey: "structured_form",
    note: "The brief lost my notes",
    path: "/projects/harbour-house/brief",
    projectId: project.id,
  });

  const [ticket] = await listTickets(db);
  assert.equal(ticket.moduleKey, "structured_form");
  assert.equal(ticket.note, "The brief lost my notes");
  assert.equal(ticket.path, "/projects/harbour-house/brief");
  assert.equal(ticket.status, "open");
  assert.equal(ticket.reporter.email, "designer@example.com");
  assert.equal(ticket.reporter.name, "Dee");
  assert.equal(ticket.projectName, "Harbour House");
});

test("the admin moves a ticket along and replies, and the reporter sees both", async () => {
  const { db, ws, designer } = await setup();
  const admin = await syncUser(db, { sub: "auth0|admin", email: "admin@example.com" });
  const issue = await createIssue(db, ws, designer.id, { moduleKey: "documents", note: "Upload failed", path: "/x" });

  const working = await updateTicket(db, admin.id, issue.id, { status: "in_progress" });
  assert.equal(working?.status, "in_progress");
  const replied = await updateTicket(db, admin.id, issue.id, { adminNote: "Fixed in the next release" });
  // A note on its own leaves the status where it was.
  assert.equal(replied?.status, "in_progress");
  assert.equal(replied?.adminNote, "Fixed in the next release");

  const [mine] = await listMyIssues(db, ws, designer.id);
  assert.equal(mine.status, "in_progress");
  assert.equal(mine.adminNote, "Fixed in the next release");
  // Still showing a marker: it is being looked at, not finished.
  assert.equal(isActiveIssue(mine), true);

  assert.equal((await updateTicket(db, admin.id, issue.id, { status: "resolved" }))?.status, "resolved");
  assert.equal(isActiveIssue((await listMyIssues(db, ws, designer.id))[0]), false);
  assert.equal(await updateTicket(db, admin.id, "6f1c1f55-8a3e-4b9b-9a51-2b5c3f0e6a11", { status: "resolved" }), null);
});

test("reports from other workspaces are in the admin queue but not in the reporter's list", async () => {
  const { db, ws, designer } = await setup();
  const otherUser = await syncUser(db, { sub: "auth0|other", email: "other@example.com" });
  const otherWs = await ensureWorkspace(db, { sub: "auth0|other", email: "other@example.com" });
  await createIssue(db, ws, designer.id, { moduleKey: "documents", note: "Mine", path: "/x" });
  await createIssue(db, otherWs, otherUser.id, { moduleKey: "documents", note: "Theirs", path: "/y" });

  assert.deepEqual((await listMyIssues(db, ws, designer.id)).map((i) => i.note), ["Mine"]);
  assert.deepEqual((await listMyIssues(db, otherWs, otherUser.id)).map((i) => i.note), ["Theirs"]);
  assert.deepEqual((await listTickets(db)).map((t) => t.note).sort(), ["Mine", "Theirs"]);
  // A report made in one workspace cannot be reached through another.
  const theirs = (await listMyIssues(db, otherWs, otherUser.id))[0];
  assert.equal(await updateMyIssue(db, ws, otherUser.id, theirs.id, { note: "moved" }), null);
});
