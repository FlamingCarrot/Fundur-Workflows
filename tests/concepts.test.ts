import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import {
  createProject,
  projectDbId,
  getProject,
  applyMutation,
} from "../src/lib/projects/store";
import {
  saveRoleModel,
  saveProviderKey,
  readRoleModels,
} from "../src/lib/ai/settings";
import { generateImage, normalizeImage } from "../src/lib/concepts/provider";
import { generateConcepts, conceptPrompt } from "../src/lib/concepts/generate";
import {
  beginConcept,
  listConcepts,
  ConceptBusyError,
} from "../src/lib/concepts/store";
import { samplePlan } from "../src/lib/plan/geometry";
import { planReferenceSvg, rasterPlan } from "../src/lib/concepts/reference";
import { ProviderError } from "../src/lib/ai/providers";
import { saveBudget } from "../src/lib/ai/budget";
import { takeBackup, restoreBackup } from "../src/lib/backup/backup";
import { collectProjectArchive } from "../src/lib/export/project";
import { projectPrefix } from "../src/lib/storage/blob";
import type { ConceptInput } from "../src/lib/concepts/schema";
process.env.AUTH0_SECRET = "concept-test-encryption-secret-01234567890";
const png = () =>
  sharp({
    create: { width: 32, height: 24, channels: 3, background: "#f1e5c2" },
  })
    .png()
    .toBuffer();
test("image provider sends a reference, validates inline images and accounts for billed or explicitly estimated costs", async () => {
  const bytes = await png(),
    reference = `data:image/png;base64,${bytes.toString("base64")}`;
  let sent: {
    modalities: string[];
    usage: { include: boolean };
    messages: { content: { image_url?: { url: string } }[] }[];
  } = { modalities: [], usage: { include: false }, messages: [] };
  const fake: typeof fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      usage: { prompt_tokens: 2, completion_tokens: 3, cost: 0.125 },
      choices: [{ message: { images: [{ image_url: { url: reference } }] } }],
    });
  };
  const result = await generateImage(
    "fake-key",
    "image-model",
    "Warm oak",
    reference,
    0.3,
    fake as typeof fetch,
  );
  assert.equal(result.reportedCostUsd, 0.125);
  assert.equal(result.estimatedCost, false);
  assert.deepEqual(sent.modalities, ["image", "text"]);
  assert.equal(sent.usage.include, true);
  assert.equal(sent.messages[1].content[1].image_url!.url, reference);
  assert.equal((await sharp(result.bytes).metadata()).width, 32);
  const estimated = await generateImage(
    "fake",
    "model",
    "prompt",
    reference,
    0.3,
    (async () =>
      Response.json({
        choices: [{ message: { images: [{ image_url: { url: reference } }] } }],
      })) as typeof fetch,
  );
  assert.equal(estimated.reportedCostUsd, 0.3);
  assert(estimated.estimatedCost);
  await assert.rejects(
    normalizeImage("https://provider.example/remote-image.png"),
  );
  await assert.rejects(normalizeImage("data:image/svg+xml;base64,PHN2Zz4="));
  await assert.rejects(
    normalizeImage(
      "data:image/png;base64," +
        Buffer.from("not an image".repeat(5)).toString("base64"),
    ),
  );
  await assert.rejects(
    generateImage("fake", "model", "prompt", reference, 0.3, (async () =>
      Response.json({
        usage: { cost: 0.7 },
        choices: [
          {
            message: {
              images: [{ image_url: { url: "https://remote.example/image" } }],
            },
          },
        ],
      })) as typeof fetch),
    (e: unknown) =>
      e instanceof ProviderError &&
      (e as unknown as { reportedCostUsd: number }).reportedCostUsd === 0.7,
  );
});
test("floor reference renders geometry and escaped room labels while excluding private notes, underlays and unchosen layouts", async () => {
  const plan = samplePlan(),
    level = plan.levels[0];
  plan.notes = [
    {
      id: "note",
      levelId: level.id,
      at: { x: 0, y: 0 },
      text: "PRIVATE-CONCEPT-NOTE",
    },
  ];
  plan.rooms[0].name = "Reception <script>";
  const svg = planReferenceSvg(plan, level.id);
  assert(!svg.includes("PRIVATE-CONCEPT-NOTE"));
  assert(svg.includes("&lt;script&gt;"));
  assert(!svg.includes("<script>"));
  const raster = await rasterPlan(plan, level.id);
  assert(raster.startsWith("data:image/png;base64,"));
  await assert.rejects(rasterPlan(plan, "missing"), /geometry/);
});
async function setup() {
  const pg = new PGlite();
  await runMigrations({
    exec: (s) => pg.exec(s),
    query: (s, p) => pg.query(s, p),
  });
  const db: Db = {
    query: async (s, p) => (await pg.query(s, p)).rows as never,
  };
  const user = "auth0|concept-designer";
  const ws = await ensureWorkspace(db, {
    sub: user,
    email: "concept@example.com",
    name: "Designer",
  });
  const project = await createProject(db, ws, {
    id: "concept-office",
    name: "Office",
    client: "Client",
    swatch: "sage",
    startDate: "2026-10-08T00:00:00Z",
    workflowId: "interior-design-corporate",
  });
  const pid = (await projectDbId(db, ws, project.id))!;
  await saveProviderKey(db, "openrouter", "fake-provider-key", user);
  for (const role of ["image", "image_fallback"] as const)
    await saveRoleModel(
      db,
      role,
      {
        provider: "openrouter",
        model: role,
        inputUsdPerMTok: 1,
        outputUsdPerMTok: 2,
        zarPerUsd: 20,
        imageUsdPerImage: 0.3,
      },
      user,
    );
  return { pg, db, ws, user, project, pid };
}
const input = (): ConceptInput => ({
  requestId: randomUUID(),
  boardKey: "moodboard",
  levelId: "ground",
  referenceDocumentId: null,
  direction: "Warm oak",
  count: 3,
});
test("three saved alternatives survive fallback, retry and restore; history, archive and private documents stay scoped", async () => {
  const { pg, db, ws, user, project, pid } = await setup();
  try {
    const request = input(),
      bytes = await png();
    let calls = 0;
    const saveImage = async (image: Uint8Array, n: number) => {
      const documentId = randomUUID();
      await applyMutation(db, ws, project.id, {
        type: "addDocuments",
        documents: [
          {
            id: documentId,
            name: `Concept ${n}.png`,
            phaseKey: "concept",
            sizeBytes: image.length,
            clientVisible: false,
            uploadedAt: new Date().toISOString(),
            storageKey: `${projectPrefix(ws, pid)}concepts/${documentId}.png`,
          },
        ],
      });
      return { documentId };
    };
    const deps = {
      call: async () => {
        calls++;
        if (calls === 1)
          throw Object.assign(new ProviderError("failed"), {
            reportedCostUsd: 0.1,
            inputTokens: 1,
            outputTokens: 1,
          });
        return {
          text: "Image",
          bytes,
          inputTokens: 2,
          outputTokens: 3,
          reportedCostUsd: 0.2,
          estimatedCost: false,
        };
      },
      saveImage,
    };
    const ctx = {
      workspaceId: ws,
      projectId: pid,
      userId: user,
      task: "concept_visual",
      phaseKey: "concept",
    };
    await generateConcepts(
      db,
      ctx,
      project,
      request,
      "reference",
      { planRevision: 1 },
      deps,
    );
    assert.equal(calls, 4);
    const [history] = await listConcepts(db, ws, pid);
    assert.equal(history.status, "complete");
    assert.equal(history.results.length, 3);
    assert.equal(history.costZar, 14);
    assert.equal((await getProject(db, ws, project.id))!.documents.length, 3);
    assert(
      (await getProject(db, ws, project.id))!.documents.every(
        (d) => !d.clientVisible && d.stored,
      ),
    );
    assert.equal(
      (
        await db.query("SELECT * FROM ai_runs WHERE task_ref=$1", [
          request.requestId,
        ])
      ).length,
      4,
    );
    await generateConcepts(db, ctx, project, request, "reference", {}, deps);
    assert.equal(calls, 4);
    await assert.rejects(
      beginConcept(
        db,
        ws,
        pid,
        user,
        { ...request, direction: "Different" },
        {},
      ),
      ConceptBusyError,
    );
    const next = input();
    let attempts = 0;
    await generateConcepts(
      db,
      ctx,
      project,
      next,
      "reference",
      {},
      {
        call: async () => {
          if (++attempts > 1)
            throw Object.assign(new ProviderError("no image"), {
              reportedCostUsd: 0.05,
            });
          return {
            text: "Image",
            bytes,
            inputTokens: 0,
            outputTokens: 0,
            reportedCostUsd: 0.2,
            estimatedCost: false,
          };
        },
        saveImage,
      },
    );
    const partial = (await listConcepts(db, ws, pid))[0];
    assert.equal(partial.status, "partial");
    assert.equal(partial.results.length, 1);
    assert.equal(partial.costZar, 6);
    const other = await ensureWorkspace(db, {
      sub: "auth0|other-concept",
      email: "other@example.com",
      name: "Other",
    });
    assert.deepEqual(await listConcepts(db, other, pid), []);
    const archive = await collectProjectArchive(db, ws, project.id);
    assert.equal((archive.data.concepts as unknown[]).length, 2);
    const backup = await takeBackup(db);
    assert.equal(backup.tables.concept_generations.length, 2);
    await restoreBackup(db, backup);
    assert.equal((await listConcepts(db, ws, pid)).length, 2);
    assert.equal((await readRoleModels(db)).image!.imageUsdPerImage, 0.3);
    const pending = input();
    assert(await beginConcept(db, ws, pid, user, pending, {}));
    await assert.rejects(
      beginConcept(db, ws, pid, user, input(), {}),
      ConceptBusyError,
    );
    await db.query(
      "UPDATE concept_generations SET created_at=NOW()-INTERVAL '11 minutes' WHERE id=$1",
      [pending.requestId],
    );
    const stale = (await listConcepts(db, ws, pid)).find(
      (g) => g.id === pending.requestId,
    )!;
    assert.equal(stale.status, "failed");
    assert.match(stale.error!, /interrupted/);
    await saveBudget(
      db,
      ws,
      pid,
      { budgetZar: 20, alertPercent: 80, pauseAtLimit: true },
      user,
    );
    await assert.rejects(
      generateConcepts(db, ctx, project, input(), "reference", {}, deps),
      /budget/,
    );
    assert.equal(calls, 4);
  } finally {
    await pg.close();
  }
});
test("concept prompts exclude unconfirmed AI brief fields and all unrelated project records", () => {
  const project = {
    brief: { style: "Calm", headcount: "Pending" },
    briefAiFields: ["headcount"],
    client: "Secret client",
    documents: [],
    notes: "PRIVATE",
  };
  const prompt = conceptPrompt(project, "Oak", 1, "First floor");
  assert(prompt.includes("Calm"));
  assert(!prompt.includes("Pending"));
  assert(!prompt.includes("Secret client"));
  assert(!prompt.includes("PRIVATE"));
});
