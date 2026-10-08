import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import {
  createProject,
  applyMutation,
  projectDbId,
} from "../src/lib/projects/store";
import { projectPrefix } from "../src/lib/storage/blob";
import { collectProjectArchive } from "../src/lib/export/project";
import {
  projectArchiveStream,
  archiveSummary,
  validateArchive,
  type ProjectArchive,
} from "../src/lib/export/archive";
import { zipStream, textEntry, type ZipEntry } from "../src/lib/export/zip";
import { saveDesign } from "../src/lib/design/store";
import { emptyDesign, newItem } from "../src/lib/design/model";
import { draftRfq, saveRfq } from "../src/lib/sourcing/model";
import { savePlan, createPlanVersion } from "../src/lib/plan/store";
import { samplePlan } from "../src/lib/plan/geometry";
const encoder = new TextEncoder();
async function readZip(stream: ReadableStream<Uint8Array>) {
  return JSZip.loadAsync(await new Response(stream).arrayBuffer(), {
    checkCRC32: true,
  });
}
test("streaming ZIP keeps exact binary bytes, Unicode paths and empty files; rejects unsafe/duplicate paths and truncated streams", async () => {
  const binary = Uint8Array.from({ length: 100_000 }, (_, n) => n % 256);
  let position = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (position === binary.length) c.close();
      else {
        const end = Math.min(position + 733, binary.length);
        c.enqueue(binary.slice(position, end));
        position = end;
      }
    },
  });
  async function* entries() {
    yield textEntry("notes/évidence.txt", "Oak — 火");
    yield { name: "drawing.dwg", data: stream, expectedSize: binary.length };
    yield textEntry("empty.txt", "");
  }
  const archive = await readZip(zipStream(entries()));
  assert.equal(
    await archive.file("notes/évidence.txt")!.async("string"),
    "Oak — 火",
  );
  assert.deepEqual(
    await archive.file("drawing.dwg")!.async("uint8array"),
    binary,
  );
  assert.equal(await archive.file("empty.txt")!.async("string"), "");
  const generate = async function* (rows: ZipEntry[]) {
    yield* rows;
  };
  for (const name of ["../escape", "/absolute", "bad\\path", "a/../b"])
    await assert.rejects(
      readZip(zipStream(generate([textEntry(name, "test")]))),
      /path/,
    );
  await assert.rejects(
    readZip(
      zipStream(generate([textEntry("same", "a"), textEntry("same", "b")])),
    ),
    /duplicate/,
  );
  await assert.rejects(
    readZip(
      zipStream(
        generate([
          { name: "short", data: encoder.encode("abc"), expectedSize: 4 },
        ]),
      ),
    ),
    /incomplete/,
  );
  await assert.rejects(
    readZip(zipStream(generate([textEntry("big", "x".repeat(100))]), 50)),
    /size limit/,
  );
});
test("cancelling a streamed file cancels its source; manifests explicitly distinguish missing and unuploaded bytes", async () => {
  let cancelled = false;
  const source = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(encoder.encode("chunk"));
    },
    cancel() {
      cancelled = true;
    },
  });
  async function* entries() {
    yield { name: "file", data: source };
  }
  const reader = zipStream(entries()).getReader();
  await reader.read();
  await reader.read();
  await reader.cancel();
  assert.equal(cancelled, true);
  const id = randomUUID(),
    archive: ProjectArchive = {
      takenAt: "2026-10-08T10:00:00.000Z",
      projectName: "Office",
      slug: "office",
      data: { project: { name: "Office" } },
      files: [
        {
          documentId: id,
          version: 1,
          name: "Absent",
          phase: "discovery",
          sizeBytes: 0,
          current: false,
          storageKey: "",
          path: `documents/${id}/v1-Absent`,
        },
        {
          documentId: id,
          version: 2,
          name: "Missing",
          phase: "discovery",
          sizeBytes: 3,
          current: true,
          storageKey: "missing",
          path: `documents/${id}/v2-Missing`,
        },
      ],
    };
  const zip = await readZip(projectArchiveStream(archive, async () => null)),
    manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.complete, false);
  assert.deepEqual(
    manifest.files.map((f: { status: string }) => f.status),
    ["not_uploaded", "missing_from_storage"],
  );
  assert.doesNotMatch(JSON.stringify(manifest), /storageKey/);
  assert.equal(archiveSummary(archive).storedVersions, 1);
  assert.throws(() =>
    validateArchive({
      ...archive,
      files: [{ ...archive.files[0], sizeBytes: -1 }],
    }),
  );
});
test("project archive includes every scoped document version and saved design/plan history; no foreign files, contacts or credentials", async () => {
  const pg = new PGlite(),
    db: Db = { query: async (s, p) => (await pg.query(s, p)).rows as never };
  try {
    await runMigrations({
      exec: (s) => pg.exec(s),
      query: (s, p) => pg.query<Record<string, unknown>>(s, p),
    });
    const ws = await ensureWorkspace(db, { sub: "archive-owner" }),
      other = await ensureWorkspace(db, { sub: "archive-other" });
    const input = {
      id: "office",
      name: "Office",
      client: "Client",
      workflowId: "interior-design-corporate",
      swatch: "sage" as const,
      startDate: "2026-10-08T00:00:00.000Z",
    };
    await createProject(db, ws, input);
    await createProject(db, other, { ...input, name: "FOREIGN" });
    const id = (await projectDbId(db, ws, input.id))!,
      docId = randomUUID(),
      folder = projectPrefix(ws, id),
      v1 = folder + "original",
      v2 = folder + "revised";
    await applyMutation(db, ws, input.id, {
      type: "addDocuments",
      documents: [
        {
          id: docId,
          name: "../Réception.pdf",
          sizeBytes: 3,
          phaseKey: "discovery",
          uploadedAt: new Date().toISOString(),
          clientVisible: false,
          storageKey: v1,
        },
      ],
    });
    await applyMutation(db, ws, input.id, {
      type: "replaceDocumentFile",
      documentId: docId,
      storageKey: v2,
      name: "Revised.pdf",
      sizeBytes: 4,
    });
    const item = { ...newItem(randomUUID()), name: "Armchair" },
      draft = draftRfq([item], {
        supplierName: "Supplier",
        recipientEmail: null,
        project: "Office",
        client: "Client",
        practice: "Practice",
      });
    await saveDesign(
      db,
      ws,
      "archive-owner",
      input.id,
      saveRfq({ ...emptyDesign(), items: [item] }, draft),
      0,
    );
    await savePlan(db, ws, "archive-owner", input.id, {
      plan: samplePlan(),
      baseRevision: 0,
      changes: ["Measured"],
    });
    await createPlanVersion(
      db,
      ws,
      "archive-owner",
      input.id,
      "Measured original",
    );
    await db.query(
      "INSERT INTO sourcing_library(workspace_id,kind,data,created_by) VALUES($1,'supplier',$2::jsonb,'archive-owner')",
      [
        ws,
        JSON.stringify({
          name: "PRIVATE-CONTACT",
          contactName: "",
          email: null,
          phone: "",
          website: null,
          notes: "",
        }),
      ],
    );
    await applyMutation(db, ws, input.id, {
      type: "restoreDocumentVersion",
      documentId: docId,
      version: 1,
    });
    const collected = await collectProjectArchive(db, ws, input.id);
    assert.equal(collected.files.length, 3);
    assert.deepEqual(
      collected.files.map((f) => f.version),
      [1, 2, 3],
    );
    assert.equal(collected.files.filter((f) => f.current).length, 1);
    assert.equal(collected.files[0].path.includes("../"), false);
    assert.equal((collected.data.planVersions as unknown[]).length, 1);
    assert.deepEqual(
      (collected.data.design as { data: { rfqs: unknown[] } }[])[0].data.rfqs,
      [draft],
    );
    assert.doesNotMatch(
      JSON.stringify(collected.data),
      /PRIVATE-CONTACT|FOREIGN|file_location|encrypted_key|token/,
    );
    const opened: string[] = [],
      contents = new Map([
        [v1, "one"],
        [v2, "four"],
      ]);
    const zip = await readZip(
      projectArchiveStream(collected, async (key) => {
        opened.push(key);
        const text = contents.get(key)!;
        return {
          size: text.length,
          contentType: "application/pdf",
          stream: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(encoder.encode(text));
              c.close();
            },
          }),
        };
      }),
    );
    assert.deepEqual(opened, [v1, v2, v1]);
    for (const f of collected.files)
      assert.equal(
        await zip.file(f.path)!.async("string"),
        contents.get(f.storageKey),
      );
    const manifest = JSON.parse(
      await zip.file("manifest.json")!.async("string"),
    );
    assert.equal(manifest.complete, true);
    assert.equal(manifest.files.length, 3);
    assert.doesNotMatch(JSON.stringify(manifest), /workspaces\//);
    assert.equal(
      (await collectProjectArchive(db, other, input.id)).files.length,
      0,
    );
    await assert.rejects(
      collectProjectArchive(db, randomUUID(), input.id),
      /not found/,
    );
    await db.query("UPDATE documents SET file_location=$1 WHERE id=$2", [
      projectPrefix(other, randomUUID()) + "foreign",
      docId,
    ]);
    await assert.rejects(
      collectProjectArchive(db, ws, input.id),
      /invalid storage/,
    );
  } finally {
    await pg.close();
  }
});
