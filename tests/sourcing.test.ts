import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { createProject, projectDbId } from "../src/lib/projects/store";
import { emptyDesign, newItem } from "../src/lib/design/model";
import { designDataSchema } from "../src/lib/design/schema";
import { getDesign, saveDesign, DesignConflict } from "../src/lib/design/store";
import {
  draftRfq,
  saveRfq,
  recordRfqRequested,
} from "../src/lib/sourcing/model";
import {
  supplierSchema,
  rfqTemplateSchema,
  DEFAULT_RFQ_TEMPLATE,
} from "../src/lib/sourcing/schema";
import {
  canUseSourcingLibrary,
  listSourcingLibrary,
  saveSourcingEntry,
  removeSourcingEntry,
} from "../src/lib/sourcing/store";
import { sourcingLibrary } from "../src/lib/sourcing/client";
import {
  takeBackup,
  restoreBackup,
  checkRestore,
} from "../src/lib/backup/backup";
import {
  createShare,
  readShared,
  setVisibility,
} from "../src/lib/sharing/store";
import { enabledTools, runTool } from "../src/lib/ai/tools";
import { features } from "../src/lib/workspaces/store";
const opts = {
  supplierName: "Supplier",
  recipientEmail: "quotes@example.com",
  project: "Office",
  client: "Client",
  practice: "Practice",
  now: "2026-10-08T10:00:00.000Z",
};
const item = () => ({
  ...newItem(randomUUID()),
  name: "Oak chair",
  quantity: 2.5,
  specification: "Solid oak, upholstered seat",
  dimensions: "600 × 650 × 800 mm",
  unitPriceCents: 9876543,
  notes: "PRIVATE installation note",
  tags: ["PRIVATE tag"],
  supplierUrl: "https://example.com/chair",
});
test("requests keep exact known selection facts, mark missing facts and omit prices and private notes", () => {
  const chair = item(),
    unknown = {
      ...item(),
      id: randomUUID(),
      dimensions: "",
      specification: "",
    };
  const request = draftRfq([chair, unknown], opts);
  assert.match(request.body, /Quantity: 2.5/);
  assert.match(request.body, /Solid oak, upholstered seat/);
  assert.match(request.body, /600 × 650 × 800 mm/);
  assert.match(request.body, /https:\/\/example.com\/chair/);
  assert.match(request.body, /Dimensions: To be confirmed/);
  assert.match(request.body, /Specification: To be confirmed/);
  assert.doesNotMatch(request.body, /9876543|PRIVATE/);
  assert.throws(() => draftRfq([], opts));
  assert.throws(() => draftRfq([chair, chair], opts));
  assert.throws(() => draftRfq(Array.from({ length: 51 }, item), opts));
  assert.throws(
    () =>
      draftRfq(
        Array.from({ length: 20 }, () => ({
          ...item(),
          specification: "x".repeat(5000),
        })),
        opts,
      ),
    /too long/,
  );
  assert.equal(
    rfqTemplateSchema.safeParse({
      ...DEFAULT_RFQ_TEMPLATE,
      body: "No item list",
    }).success,
    false,
  );
  assert.equal(
    rfqTemplateSchema.safeParse({
      ...DEFAULT_RFQ_TEMPLATE,
      body: "{items} {secret}",
    }).success,
    false,
  );
  assert.equal(
    supplierSchema.safeParse({
      name: "Name",
      contactName: "",
      email: null,
      phone: "",
      website: "javascript:alert(1)",
      notes: "",
    }).success,
    false,
  );
  const literal = draftRfq([{ ...chair, name: "Literal {practice}" }], {
    ...opts,
    supplierName: "Literal {project}",
  });
  assert.match(literal.body, /Hello Literal \{project\}/);
  assert.match(literal.body, /Literal \{practice\}/);
});
test("saved request text stays captured; recording is idempotent and cannot move ordered/delivered items backwards", () => {
  const items = [
      item(),
      { ...item(), status: "ordered" as const },
      { ...item(), status: "delivered" as const },
    ],
    request = draftRfq(items, opts);
  const data = saveRfq({ ...emptyDesign(), items }, request),
    changed = {
      ...data,
      items: data.items.map((i) => ({
        ...i,
        specification: "Changed specification",
      })),
    };
  assert.equal(changed.rfqs![0].body, request.body);
  const recorded = recordRfqRequested(changed, request.id);
  assert.deepEqual(
    recorded.items.map((i) => i.status),
    ["quote_requested", "ordered", "delivered"],
  );
  assert.equal(recordRfqRequested(recorded, request.id), recorded);
  assert.throws(
    () => saveRfq(recorded, { ...recorded.rfqs![0], body: "Rewritten" }),
    /cannot be edited/,
  );
  const removed = { ...data, items: [] };
  assert.equal(recordRfqRequested(removed, request.id).items.length, 0);
  assert.equal(designDataSchema.safeParse(removed).success, true);
  assert.equal(
    designDataSchema.safeParse({ ...data, rfqs: [request, request] }).success,
    false,
  );
  assert.equal(designDataSchema.safeParse(emptyDesign()).success, true);
  assert.throws(() => recordRfqRequested(data, randomUUID()));
  assert.throws(() => recordRfqRequested(data, request.id, "invalid"));
});
test("demo library separates account/workspace scopes and preserves contact/template identity", async () => {
  const store = new Map<string, string>(),
    previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
  });
  try {
    const a = sourcingLibrary(false, "a.practice"),
      b = sourcingLibrary(false, "a.other");
    const entry = await a.save({
      kind: "template",
      data: DEFAULT_RFQ_TEMPLATE,
    });
    assert.equal((await b.list()).length, 0);
    await assert.rejects(b.save({ ...entry }));
    await assert.rejects(
      a.save({
        kind: "supplier",
        id: entry.id,
        data: {
          name: "Name",
          contactName: "",
          email: null,
          phone: "",
          website: null,
          notes: "",
        },
      }),
    );
    await a.remove(entry.id);
    assert.equal((await a.list()).length, 0);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previous,
    });
  }
});
test("practice library, project RFQs, privacy, assistant facts and backup round trip", async () => {
  process.env.AUTH0_SECRET = "sourcing-test-secret-key-derivation-0123456789";
  const pg = new PGlite(),
    db: Db = { query: async (s, p) => (await pg.query(s, p)).rows as never };
  try {
    await runMigrations({
      exec: (s) => pg.exec(s),
      query: (s, p) => pg.query<Record<string, unknown>>(s, p),
    });
    const ws = await ensureWorkspace(db, {
        sub: "rfq-designer",
        name: "Designer",
      }),
      other = await ensureWorkspace(db, { sub: "rfq-other", name: "Other" });
    const input = {
      id: "rfq-office",
      name: "Office",
      client: "Client",
      workflowId: "interior-design-corporate",
      swatch: "sage" as const,
      startDate: "2026-10-08T00:00:00.000Z",
    };
    await createProject(db, ws, input);
    await createProject(db, other, input);
    const contact = await saveSourcingEntry(db, ws, "rfq-designer", {
        kind: "supplier",
        data: {
          name: "Oak Works",
          contactName: "Contact",
          email: "private@example.com",
          phone: "123",
          website: null,
          notes: "PRIVATE library note",
        },
      }),
      template = await saveSourcingEntry(db, ws, "rfq-designer", {
        kind: "template",
        data: DEFAULT_RFQ_TEMPLATE,
      });
    assert.equal((await listSourcingLibrary(db, ws)).length, 2);
    assert.equal((await listSourcingLibrary(db, other)).length, 0);
    await assert.rejects(
      saveSourcingEntry(db, other, "rfq-other", {
        kind: "supplier",
        id: contact.id,
        data: contact.data,
      } as never),
    );
    assert.equal(await removeSourcingEntry(db, other, contact.id), false);
    assert.deepEqual(
      ["owner", "member", "collaborator", "client"].map((r) =>
        canUseSourcingLibrary(r as never),
      ),
      [true, true, false, false],
    );
    const items = [item()],
      request = draftRfq(items, {
        ...opts,
        supplierName: "Oak Works",
        recipientEmail: "private@example.com",
      }),
      data = saveRfq({ ...emptyDesign(), items }, request);
    await saveDesign(db, ws, "rfq-designer", input.id, data, 0);
    assert.deepEqual((await getDesign(db, ws, input.id)).data, data);
    assert.equal((await getDesign(db, other, input.id)).data.rfqs, undefined);
    await assert.rejects(
      saveDesign(db, ws, "rfq-designer", input.id, { ...data, rfqs: [] }, 0),
      DesignConflict,
    );
    await setVisibility(db, ws, input.id, {
      targetType: "schedule",
      clientVisible: true,
    });
    await setVisibility(db, ws, input.id, {
      targetType: "phase",
      targetId: "documentation",
      clientVisible: true,
    });
    const projectId = (await projectDbId(db, ws, input.id))!,
      share = await createShare(db, ws, input.id, "rfq-designer", {
        targetType: "schedule",
        mode: "live",
        permission: "view",
      });
    const payload = JSON.stringify(await readShared(db, share.token));
    assert.doesNotMatch(
      payload,
      /private@example.com|PRIVATE installation note|PRIVATE library note|request for quotation/,
    );
    const project = (await import("../src/lib/projects/store")).getProject;
    const current = (await project(db, ws, input.id))!,
      featureState = await features(db, ws, "rfq-designer");
    const ctx = {
      db,
      project: current,
      features: featureState,
      run: { workspaceId: ws, projectId, userId: "rfq-designer" },
      readFile: async () => null,
    };
    const result = await runTool(ctx, "draft_supplier_rfq", {
      itemIds: [items[0].id],
      supplierName: "Oak Works",
      practiceName: "Practice",
    });
    assert.match(result.content, /Solid oak, upholstered seat/);
    assert.doesNotMatch(result.content, /PRIVATE|9876543/);
    assert.equal((await getDesign(db, ws, input.id)).revision, 1);
    assert.equal(
      (
        await runTool(ctx, "draft_supplier_rfq", {
          itemIds: [randomUUID()],
          supplierName: "Oak Works",
          practiceName: "Practice",
        })
      ).isError,
      true,
    );
    assert.equal(
      enabledTools({ ...featureState, design: false }).some(
        (t) => t.name === "draft_supplier_rfq",
      ),
      false,
    );
    const backup = await takeBackup(db);
    assert.equal(backup.counts.sourcing_library, 2);
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
        (await listSourcingLibrary(target, ws)).map((r) => r.id).sort(),
        [contact.id, template.id].sort(),
      );
      assert.deepEqual((await getDesign(target, ws, input.id)).data.rfqs, [
        request,
      ]);
    } finally {
      await targetPg.close();
    }
  } finally {
    await pg.close();
  }
});
