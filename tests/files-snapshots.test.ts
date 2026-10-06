import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { checkStoredFiles } from "../src/lib/projects/files";
import {
  applyMutation,
  createProject,
  documentFile,
  getProject,
  listVersions,
  MutationError,
  projectDbId,
} from "../src/lib/projects/store";
import { isInProject, projectPrefix } from "../src/lib/storage/blob";
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
  const ws = await ensureWorkspace(db, { sub: "auth0|a" });
  await createProject(db, ws, input);
  const pid = (await projectDbId(db, ws, input.id))!;
  return { db, ws, pid, folder: projectPrefix(ws, pid) };
}

const DOC = "6f1c1f55-8a3e-4b9b-9a51-2b5c3f0e6a11";
const doc = (storageKey?: string) => ({
  id: DOC,
  name: "Floor plate.pdf",
  sizeBytes: 1,
  phaseKey: "discovery",
  uploadedAt: "2026-10-02T09:00:00.000Z",
  clientVisible: false,
  ...(storageKey ? { storageKey } : {}),
});

test("a storage path must be a plain file inside the project's own folder", () => {
  const folder = projectPrefix("ws1", "p1");
  assert.equal(isInProject(`${folder}plan.pdf`, "ws1", "p1"), true);
  assert.equal(isInProject(`${folder}sub/plan.pdf`, "ws1", "p1"), true);
  assert.equal(isInProject(`${folder}`, "ws1", "p1"), false);
  assert.equal(isInProject(`${folder}../p2/plan.pdf`, "ws1", "p1"), false);
  assert.equal(isInProject(`${projectPrefix("ws1", "p2")}plan.pdf`, "ws1", "p1"), false);
  assert.equal(isInProject(`${projectPrefix("ws2", "p1")}plan.pdf`, "ws1", "p1"), false);
});

test("an upload is only saved once storage has it, at the size storage reports", async () => {
  const folder = projectPrefix("ws1", "p1");
  const stat = async (path: string) => (path === `${folder}plan-abc.pdf` ? { size: 52_428_800, contentType: "application/pdf" } : null);
  const checked = await checkStoredFiles({ type: "addDocuments", documents: [doc(`${folder}plan-abc.pdf`)] }, "ws1", "p1", stat);
  assert.equal(checked.type === "addDocuments" && checked.documents[0].sizeBytes, 52_428_800);
  await assert.rejects(
    checkStoredFiles({ type: "addDocuments", documents: [doc(`${folder}never-uploaded.pdf`)] }, "ws1", "p1", stat),
    MutationError
  );
  await assert.rejects(
    checkStoredFiles({ type: "addDocuments", documents: [doc(`${projectPrefix("ws2", "p9")}theirs.pdf`)] }, "ws1", "p1", stat),
    MutationError
  );
  // A name-only document needs no storage.
  const plain = { type: "addDocuments" as const, documents: [doc()] };
  assert.deepEqual(await checkStoredFiles(plain, "ws1", "p1", stat), plain);
});

test("each upload of a file is a version, and restoring one adds a version with its content", async () => {
  const { db, ws, folder } = await setup();
  let p = await applyMutation(db, ws, input.id, { type: "addDocuments", documents: [{ ...doc(`${folder}plan-v1.pdf`), sizeBytes: 100 }] });
  assert.deepEqual([p!.documents[0].stored, p!.documents[0].version], [true, 1]);

  p = await applyMutation(db, ws, input.id, {
    type: "replaceDocumentFile",
    documentId: DOC,
    storageKey: `${folder}plan-v2.pdf`,
    name: "Floor plate rev B.pdf",
    sizeBytes: 200,
  });
  assert.deepEqual([p!.documents[0].version, p!.documents[0].name, p!.documents[0].sizeBytes], [2, "Floor plate rev B.pdf", 200]);
  assert.equal((await documentFile(db, ws, input.id, DOC))!.pathname, `${folder}plan-v2.pdf`);

  p = await applyMutation(db, ws, input.id, { type: "restoreDocumentVersion", documentId: DOC, version: 1 });
  assert.deepEqual([p!.documents[0].version, p!.documents[0].name, p!.documents[0].sizeBytes], [3, "Floor plate.pdf", 100]);
  assert.equal((await documentFile(db, ws, input.id, DOC))!.pathname, `${folder}plan-v1.pdf`);
  assert.equal((await documentFile(db, ws, input.id, DOC, 2))!.pathname, `${folder}plan-v2.pdf`);

  const { documentVersions } = (await listVersions(db, ws, input.id))!;
  assert.deepEqual(documentVersions.map((v) => [v.version, v.trigger]), [[3, "restore"], [2, "upload"], [1, "upload"]]);
  assert.equal(documentVersions[0].notes, "Restored version 1");

  await assert.rejects(
    applyMutation(db, ws, input.id, { type: "restoreDocumentVersion", documentId: DOC, version: 9 }),
    MutationError
  );
});

test("another workspace can neither restore nor download a project's files", async () => {
  const { db, ws, folder } = await setup();
  await applyMutation(db, ws, input.id, { type: "addDocuments", documents: [doc(`${folder}plan-v1.pdf`)] });
  const other = await ensureWorkspace(db, { sub: "auth0|b" });
  await createProject(db, other, input);
  assert.equal(await documentFile(db, other, input.id, DOC), null);
  assert.equal(await documentFile(db, other, input.id, DOC, 1), null);
  await assert.rejects(
    applyMutation(db, other, input.id, { type: "restoreDocumentVersion", documentId: DOC, version: 1 }),
    MutationError
  );
  assert.deepEqual((await listVersions(db, other, input.id))!.documentVersions, []);
});

test("completing a phase snapshots the brief and documents, and restoring brings the brief back", async () => {
  const { db, ws, folder } = await setup();
  const [first] = getWorkflow(DEFAULT_WORKFLOW_ID).phases;
  await applyMutation(db, ws, input.id, { type: "addDocuments", documents: [doc(`${folder}plan-v1.pdf`)] });
  await applyMutation(db, ws, input.id, { type: "updateBrief", patch: { headcount: "140" }, fromAi: true });
  for (const item of first.checklist.filter((i) => i.essential)) {
    await applyMutation(db, ws, input.id, { type: "setCheck", itemId: item.id, done: true });
  }
  await applyMutation(db, ws, input.id, { type: "completePhase", phaseKey: first.key });
  // A second completion (stale tab) does nothing, so no second snapshot.
  await applyMutation(db, ws, input.id, { type: "completePhase", phaseKey: first.key });

  let { snapshots } = (await listVersions(db, ws, input.id))!;
  assert.equal(snapshots.length, 1);
  const [snap] = snapshots;
  assert.equal(snap.phaseKey, first.key);
  assert.equal(snap.brief.headcount, "140");
  assert.deepEqual(snap.briefAiFields, ["headcount"]);
  assert.deepEqual(snap.documents, [{ id: DOC, version: 1 }]);

  await applyMutation(db, ws, input.id, { type: "updateBrief", patch: { headcount: "180", notes: "Changed" }, fromAi: false });
  const p = await applyMutation(db, ws, input.id, { type: "restoreBrief", snapshotId: snap.id });
  assert.equal(p!.brief.headcount, "140");
  assert.equal(p!.brief.notes ?? "", snap.brief.notes ?? "");
  assert.deepEqual(p!.briefAiFields, ["headcount"]);

  // The brief as it was before the restore is kept, so the restore can be undone.
  ({ snapshots } = (await listVersions(db, ws, input.id))!);
  const kept = snapshots.find((s) => s.trigger === "before_restore")!;
  assert.equal(kept.brief.headcount, "180");
  assert.equal((await getProject(db, ws, input.id))!.brief.headcount, "140");

  // Another workspace cannot apply this snapshot to its own project of the same name.
  const other = await ensureWorkspace(db, { sub: "auth0|b" });
  await createProject(db, other, input);
  await assert.rejects(applyMutation(db, other, input.id, { type: "restoreBrief", snapshotId: snap.id }), MutationError);
});
