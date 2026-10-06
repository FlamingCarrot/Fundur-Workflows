import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { applyMutation, createProject, getProject, projectDbId } from "../src/lib/projects/store";
import { createIssue } from "../src/lib/issues/store";
import { checkRestore, restoreBackup, takeBackup } from "../src/lib/backup/backup";
import { runBackup, sampleFiles, type BackupStorage } from "../src/lib/backup/run";
import { projectPrefix } from "../src/lib/storage/blob";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";

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

const DOC = "6f1c1f55-8a3e-4b9b-9a51-2b5c3f0e6a11";

/** A studio with a project, a brief, a stored file and a reported issue. */
async function studio() {
  const db = await freshDb();
  const user = await syncUser(db, { sub: "auth0|designer", email: "designer@example.com", name: "Dee" });
  const ws = await ensureWorkspace(db, { sub: "auth0|designer", email: "designer@example.com", name: "Dee" });
  await createProject(db, ws, input);
  const pid = (await projectDbId(db, ws, input.id))!;
  await applyMutation(db, ws, input.id, { type: "updateBrief", patch: { headcount: "140" }, fromAi: false });
  await applyMutation(db, ws, input.id, {
    type: "addDocuments",
    documents: [
      {
        id: DOC,
        name: "Floor plate.pdf",
        sizeBytes: 2048,
        phaseKey: "discovery",
        uploadedAt: "2026-10-02T09:00:00.000Z",
        clientVisible: false,
        storageKey: `${projectPrefix(ws, pid)}floor-plate.pdf`,
      },
    ],
  });
  await createIssue(db, ws, user.id, { moduleKey: "documents", note: "Upload was slow", path: "/x", projectId: input.id });
  return { db, ws, pid };
}

test("a backup restored into a scratch database brings the studio back whole", async () => {
  const { db, ws } = await studio();
  const backup = await takeBackup(db);
  const before = await getProject(db, ws, input.id);

  // The scratch database: migrated, and empty.
  const scratch = await freshDb();
  const restored = await restoreBackup(scratch, backup);
  assert.equal(restored.projects, 1);
  assert.deepEqual(await checkRestore(scratch, backup), []);

  const after = await getProject(scratch, ws, input.id);
  assert.deepEqual(after, before);
  assert.equal(after!.brief.headcount, "140");
  assert.equal(after!.documents[0].name, "Floor plate.pdf");
  assert.equal(after!.documents[0].stored, true);

  // Running the restore again changes nothing, so a half-finished one can be run twice.
  await restoreBackup(scratch, backup);
  assert.deepEqual(await checkRestore(scratch, backup), []);
});

test("the backup lists every stored file, and says so when one is missing", async () => {
  const { db } = await studio();
  const backup = await takeBackup(db);
  assert.equal(backup.files.length, 2); // the document and its first version
  assert.ok(backup.files.every((f) => f.key.includes("floor-plate.pdf")));

  const saved: { path: string; body: string }[] = [];
  const storage: BackupStorage = {
    put: async (path, body) => {
      saved.push({ path, body });
      return { pathname: path };
    },
    list: async () => [
      { pathname: "backups/2026-01-01.json", uploadedAt: new Date("2026-01-01") },
      { pathname: "backups/2026-10-05.json", uploadedAt: new Date("2026-10-05") },
    ],
    remove: async () => undefined,
  };

  const now = new Date("2026-10-06T01:00:00.000Z");
  const ok = await runBackup(db, { storage, now, statImpl: async () => ({ size: 2048, contentType: "application/pdf" }) });
  assert.equal(ok.path, "backups/2026-10-06.json");
  assert.deepEqual(ok.missingFiles, []);
  assert.equal(ok.counts.projects, 1);
  // Backups past a month are cleared; the recent one stays.
  assert.equal(ok.removed, 1);
  assert.equal(JSON.parse(saved[0].body).tables.projects.length, 1);

  const gone = await runBackup(db, { storage, now, statImpl: async () => null });
  assert.equal(gone.missingFiles.length, 2);
});

test("the file check looks at a spread of files rather than all of them", () => {
  const files = Array.from({ length: 100 }, (_, i) => ({ key: `k${i}`, name: `n${i}`, sizeBytes: 1, version: 1 }));
  const sample = sampleFiles(files, 10);
  assert.equal(sample.length, 10);
  assert.equal(new Set(sample.map((f) => f.key)).size, 10);
  assert.deepEqual(sampleFiles(files.slice(0, 5), 10).length, 5);
});

test("restoring a backup from before the model shortlist puts the default model on it", async () => {
  const db = await freshDb();
  await db.query(
    `INSERT INTO model_settings (workspace_id, role, provider, model, input_usd_per_mtok, output_usd_per_mtok)
     VALUES (NULL, 'default', 'openrouter', 'anthropic/claude-opus-5-5', 4, 20)`
  );
  const backup = await takeBackup(db);
  delete backup.tables.enabled_models;
  delete backup.counts.enabled_models;

  const scratch = await freshDb();
  await restoreBackup(scratch, backup);
  assert.deepEqual(await checkRestore(scratch, backup), []);
  const rows = await scratch.query<{ model: string }>("SELECT model FROM enabled_models");
  assert.deepEqual(rows.map((r) => r.model), ["anthropic/claude-opus-5-5"]);
});
