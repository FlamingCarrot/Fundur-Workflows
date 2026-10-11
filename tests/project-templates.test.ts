import { runTool, enabledTools } from "../src/lib/ai/tools";
import { features } from "../src/lib/workspaces/store";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { newProject } from "../src/lib/studio/transitions";
import { createProject, getProject } from "../src/lib/projects/store";
import { getDesign } from "../src/lib/design/store";
import { newItem, emptyDesign } from "../src/lib/design/model";
import {
  captureSetup,
  seedSetup,
  setupSchema,
} from "../src/lib/templates/model";
import {
  saveTemplate,
  listTemplates,
  getTemplate,
  removeTemplate,
} from "../src/lib/templates/store";
import { templateLibrary } from "../src/lib/templates/client";
import {
  takeBackup,
  restoreBackup,
  checkRestore,
} from "../src/lib/backup/backup";
const input = {
  id: "office",
  name: "Office",
  client: "Client",
  workflowId: "interior-design-corporate",
  swatch: "sage" as const,
  startDate: "2026-10-08T00:00:00.000Z",
};
const sourceItem = {
  ...newItem(randomUUID()),
  name: "Oak chair",
  specification: "Solid oak",
  dimensions: "600 × 650",
  quantity: 2.5,
  unitPriceCents: 40000,
  supplier: "Old supplier",
  supplierUrl: "https://example.com",
  status: "delivered" as const,
  deliveryDate: "2026-10-10",
  installDone: true,
  notes: "PRIVATE site evidence",
  snagDocumentIds: [randomUUID()],
  documentId: randomUUID(),
  sourceCardId: randomUUID(),
};
function setup() {
  return captureSetup(
    {
      ...newProject(input),
      checks: { "reg-fire-egress": true },
      regulations: {
        "reg-fire-egress": {
          title: "Confirm escape routes",
          category: "fire_egress",
          notes: "PRIVATE consultant signoff",
        },
      },
    },
    { ...emptyDesign(), items: [sourceItem] },
    [sourceItem.id],
  );
}
test("setup keeps chosen reusable facts and unchecked titles; new IDs, no client evidence, prices, files, orders or suppliers", () => {
  const captured = setup(),
    seed = seedSetup(captured),
    another = seedSetup(captured);
  assert.doesNotMatch(
    JSON.stringify(captured),
    /PRIVATE|Old supplier|40000|example.com|2026-10-10/,
  );
  assert.equal(seed.design.items[0].specification, "Solid oak");
  assert.equal(seed.design.items[0].quantity, 2.5);
  assert.notEqual(seed.design.items[0].id, sourceItem.id);
  assert.notEqual(seed.design.items[0].id, another.design.items[0].id);
  assert.equal(seed.design.items[0].status, "needs_sourcing");
  assert.equal(seed.design.items[0].unitPriceCents, null);
  assert.equal(seed.design.items[0].documentId, null);
  assert.equal(seed.design.items[0].supplier, "");
  assert.equal(Object.values(seed.regulations)[0].notes, "");
  assert.notDeepEqual(
    Object.keys(seed.regulations),
    Object.keys(another.regulations),
  );
  assert.throws(() =>
    captureSetup(newProject(input), emptyDesign(), [randomUUID()]),
  );
  assert.equal(
    setupSchema.safeParse({ ...captured, items: [sourceItem] }).success,
    false,
  ); // templates reject client-specific item fields
  assert.equal(
    seedSetup({ ...captured, requirements: [] }).regulations[
      "reg-fire-egress"
    ]?.notes.includes("professional"),
    true,
  );
  assert.throws(() => seedSetup({ ...captured, workflowVersion: 999 }));
});
test("demo templates are scoped and survive reload without changing existing projects", async () => {
  const rows = new Map<string, string>(),
    previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => rows.get(k) ?? null,
      setItem: (k: string, v: string) => rows.set(k, v),
    },
  });
  try {
    const a = templateLibrary(false, "owner.practice"),
      b = templateLibrary(false, "owner.other");
    const saved = await a.save({ name: "Small office", data: setup() });
    assert.equal(
      (await templateLibrary(false, "owner.practice").list())[0].id,
      saved.id,
    );
    assert.equal((await b.list()).length, 0);
    await b.remove(saved.id);
    assert.equal((await a.list()).length, 1);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  }
});
test("server creation applies a scoped template atomically with fresh data; foreign/deleted templates and failed seed leave no empty project", async () => {
  const pg = new PGlite(),
    db: Db = { query: async (s, p) => (await pg.query(s, p)).rows as never };
  try {
    await runMigrations({
      exec: (s) => pg.exec(s),
      query: (s, p) => pg.query<Record<string, unknown>>(s, p),
    });
    const ws = await ensureWorkspace(db, { sub: "template-owner" }),
      other = await ensureWorkspace(db, { sub: "template-other" });
    const template = await saveTemplate(db, ws, "template-owner", {
      name: "Office starter",
      data: setup(),
    });
    assert.equal((await listTemplates(db, ws)).length, 1);
    assert.equal((await listTemplates(db, other)).length, 0);
    assert.equal(await getTemplate(db, other, template.id), null);
    assert.equal(await removeTemplate(db, other, template.id), false);
    await assert.rejects(
      createProject(db, other, { ...input, templateId: template.id }),
      /not found/,
    );
    assert.equal(await getProject(db, other, input.id), null);
    const created = await createProject(db, ws, {
      ...input,
      templateId: template.id,
    });
    const flags = await features(db, ws, "template-owner"),
      projectId = (await import("../src/lib/projects/store")).projectDbId;
    const read = await runTool(
      {
        db,
        project: created,
        features: flags,
        run: {
          workspaceId: ws,
          projectId: (await projectId(db, ws, created.id))!,
          userId: "template-owner",
        },
        readFile: async () => null,
      },
      "read_practice_project_setups",
      {},
    );
    assert.equal(JSON.parse(read.content)[0].itemCount, 1);
    assert.doesNotMatch(read.content, /Solid oak|PRIVATE|FOREIGN/);
    assert.equal(
      enabledTools({ ...flags, design: false }).some(
        (t) => t.name === "read_practice_project_setups",
      ),
      false,
    );
    assert.equal(created.workflowVersion, 1);
    assert.equal(created.currentPhase, "discovery");
    assert.deepEqual(created.checks, {});
    assert.deepEqual(created.completedPhases, []);
    assert.deepEqual(created.documents, []);
    assert.equal(Object.values(created.regulations!)[0].notes, "");
    const design = await getDesign(db, ws, created.id);
    assert.equal(design.revision, 1);
    assert.equal(design.data.items[0].name, "Oak chair");
    assert.equal(design.data.items[0].status, "needs_sourcing");
    const second = await createProject(db, ws, {
      ...input,
      templateId: template.id,
    });
    assert.notEqual(second.id, created.id);
    assert.notEqual(
      (await getDesign(db, ws, second.id)).data.items[0].id,
      design.data.items[0].id,
    );
    await pg.exec(
      "CREATE FUNCTION refuse_seed() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced seed failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER refuse_seed BEFORE INSERT ON project_design FOR EACH ROW EXECUTE FUNCTION refuse_seed();",
    );
    await assert.rejects(
      createProject(db, ws, {
        ...input,
        id: "failed-seed",
        templateId: template.id,
      }),
      /forced seed failure/,
    );
    assert.equal(await getProject(db, ws, "failed-seed"), null);
    await pg.exec(
      "DROP TRIGGER refuse_seed ON project_design; DROP FUNCTION refuse_seed();",
    );
    const backup = await takeBackup(db);
    assert.equal(backup.counts.project_templates, 1);
    const targetPg = new PGlite(),
      target: Db = {
        query: async (s, p) => (await targetPg.query(s, p)).rows as never,
      };
    try {
      await runMigrations({
        exec: (s) => targetPg.exec(s),
        query: (s, p) => targetPg.query<Record<string, unknown>>(s, p),
      });
      await restoreBackup(target, backup);
      assert.deepEqual(await checkRestore(target, backup), []);
      assert.deepEqual(
        (await getTemplate(target, ws, template.id))?.data,
        template.data,
      );
    } finally {
      await targetPg.close();
    }
    await removeTemplate(db, ws, template.id);
    assert.equal((await getDesign(db, ws, created.id)).data.items.length, 1);
    await assert.rejects(
      createProject(db, ws, {
        ...input,
        id: "deleted-template",
        templateId: template.id,
      }),
      /not found/,
    );
    assert.equal(await getProject(db, ws, "deleted-template"), null);
  } finally {
    await pg.close();
  }
});
