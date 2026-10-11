import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../src/lib/db/migrator";
import type { Db } from "../src/lib/db";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import {
  createProject,
  applyMutation,
  projectDbId,
  getProject,
} from "../src/lib/projects/store";
import { projectPrefix } from "../src/lib/storage/blob";
import {
  getDesign,
  saveDesign,
  DesignConflict,
  DesignError,
} from "../src/lib/design/store";
import {
  emptyDesign,
  newItem,
  addSelection,
  lineTotal,
  procurementTotals,
  generateInstallOrder,
  installationItems,
  parseMoney,
} from "../src/lib/design/model";
import {
  designDataSchema,
  designItemSchema,
  type BoardCard,
  type DesignData,
} from "../src/lib/design/schema";
import {
  createShare,
  listShares,
  setVisibility,
  readShared,
  sharedFile,
  commentShared,
  revokeShare,
  editSharedBrief,
} from "../src/lib/sharing/store";
import { createShareInput } from "../src/lib/sharing/schema";
import {
  takeBackup,
  restoreBackup,
  checkRestore,
} from "../src/lib/backup/backup";
import { features } from "../src/lib/workspaces/store";
import { enabledTools, runTool } from "../src/lib/ai/tools";
import { draftSpecification } from "../src/lib/design/specification";
import { saveProviderKey, saveRoleModel } from "../src/lib/ai/settings";
import { saveTaskRoute } from "../src/lib/ai/routing";
import { projectAiCosts } from "../src/lib/ai/costs";

process.env.AUTH0_SECRET = "design-test-key-derivation-secret-0123456789";

test("quote totals, fractional quantities and installation order stay exact", () => {
  assert.equal(parseMoney("10.05"), 1005);
  assert.equal(parseMoney("0"), 0);
  assert.equal(parseMoney(""), null);
  assert.throws(() => parseMoney("1.001"));
  assert.throws(() => parseMoney("-10"));
  const a = {
    ...newItem(randomUUID()),
    name: "A",
    unitPriceCents: 100,
    quantity: 1.005,
    deliveryDate: "2026-10-22",
  };
  const b = {
    ...newItem(randomUUID()),
    name: "B",
    unitPriceCents: null,
    deliveryDate: "2026-10-12",
  };
  const c = { ...newItem(randomUUID()), name: "C", unitPriceCents: 0 };
  const data = { ...emptyDesign(), items: [a, b, c] };
  assert.equal(lineTotal(a), 101);
  assert.equal(lineTotal(b), null);
  assert.deepEqual(procurementTotals(data), {
    totalCents: 101,
    unpriced: 1,
    delivered: 0,
    total: 3,
  });
  const order = generateInstallOrder(data);
  assert.deepEqual(order, [b.id, a.id, c.id]);
  assert.deepEqual(
    installationItems({ ...data, installOrder: [a.id] }).map((i) => i.id),
    [a.id, b.id, c.id],
  );
  assert.equal(
    designItemSchema.safeParse({ ...a, deliveryDate: "2026-99-99" }).success,
    false,
  );
  assert.equal(
    designItemSchema.safeParse({ ...a, deliveryDate: "2026-02-30" }).success,
    false,
  );
  assert.equal(
    designDataSchema.safeParse({ ...data, items: [a, a] }).success,
    false,
  );
});

test("boards and the shared item chain persist safely, isolate tenants, freeze publications and restore", async (t) => {
  const pg = new PGlite();
  await runMigrations({
    exec: (s) => pg.exec(s),
    query: (s, p) => pg.query(s, p),
  });
  const db: Db = {
    query: async (s, p) => (await pg.query(s, p)).rows as never,
  };
  try {
    const ws = await ensureWorkspace(db, {
      sub: "designer",
      email: "designer@example.com",
    });
    const other = await ensureWorkspace(db, {
      sub: "other",
      email: "other@example.com",
    });
    const input = {
      id: "office",
      name: "Office",
      client: "Client",
      workflowId: "interior-design-corporate",
      startDate: "2026-10-01T00:00:00.000Z",
      swatch: "sage" as const,
    };
    await createProject(db, ws, input);
    await createProject(db, other, input);
    const pid = (await projectDbId(db, ws, input.id))!,
      foreignPid = (await projectDbId(db, other, input.id))!;
    const image = randomUUID(),
      foreignImage = randomUUID(),
      privatePhaseImage = randomUUID(),
      snag = randomUUID();
    async function imageDoc(
      workspace: string,
      project: string,
      id: string,
      phaseKey: string,
      name = "swatch.png",
    ) {
      await applyMutation(db, workspace, input.id, {
        type: "addDocuments",
        documents: [
          {
            id,
            name,
            sizeBytes: 100,
            phaseKey,
            uploadedAt: new Date().toISOString(),
            clientVisible: false,
            storageKey: `${projectPrefix(workspace, project)}${id}-${name}`,
          },
        ],
      });
    }
    await imageDoc(ws, pid, image, "concept");
    await imageDoc(ws, pid, privatePhaseImage, "discovery");
    await imageDoc(ws, pid, snag, "delivery", "snag.png");
    await imageDoc(other, foreignPid, foreignImage, "concept");
    const card: BoardCard = {
      id: randomUUID(),
      title: "Oak acoustic panel",
      body: "Natural oak finish",
      documentId: image,
      tags: ["oak", "acoustic"],
      group: "Reception",
      x: 100,
      y: 120,
      width: 260,
      color: "#f6f2e8",
    };
    const board = {
      id: randomUUID(),
      key: "moodboard",
      cards: [
        card,
        {
          ...card,
          id: randomUUID(),
          title: "Private-phase reference",
          documentId: privatePhaseImage,
          x: 400,
        },
      ],
    };
    let data: DesignData = { ...emptyDesign(), boards: [board] };
    data = addSelection(data, card, randomUUID());
    data = {
      ...data,
      items: data.items.map((i) => ({
        ...i,
        quantity: 12,
        unitPriceCents: 1050,
        supplier: "PRIVATE SUPPLIER",
        notes: "PRIVATE SNAG NOTE",
        snagDocumentIds: [snag],
      })),
      budgetCents: 20000,
    };
    await t.test(
      "one tagged selection becomes one item across the chain; exact board state reloads",
      async () => {
        assert.equal(addSelection(data, card, randomUUID()), data);
        const saved = await saveDesign(db, ws, "designer", input.id, data, 0);
        assert.equal(saved.revision, 1);
        assert.deepEqual((await getDesign(db, ws, input.id)).data, data);
        assert.deepEqual(
          (await getDesign(db, other, input.id)).data,
          emptyDesign(),
        );
        assert.equal(procurementTotals(data).totalCents, 12600);
      },
    );
    await t.test(
      "stale and simultaneous saves cannot silently overwrite another editor",
      async () => {
        await assert.rejects(
          saveDesign(db, ws, "designer", input.id, data, 0),
          DesignConflict,
        );
        const writes = await Promise.allSettled([
          saveDesign(
            db,
            ws,
            "designer",
            input.id,
            { ...data, budgetCents: 21000 },
            1,
          ),
          saveDesign(
            db,
            ws,
            "designer",
            input.id,
            { ...data, budgetCents: 22000 },
            1,
          ),
        ]);
        assert.equal(writes.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(writes.filter((r) => r.status === "rejected").length, 1);
        assert.equal((await getDesign(db, ws, input.id)).revision, 2);
        data = (await getDesign(db, ws, input.id)).data;
      },
    );
    await t.test(
      "a source image or snag photo from another project is rejected",
      async () => {
        await assert.rejects(
          saveDesign(
            db,
            ws,
            "designer",
            input.id,
            {
              ...data,
              boards: [
                { ...board, cards: [{ ...card, documentId: foreignImage }] },
              ],
            },
            2,
          ),
          DesignError,
        );
        await assert.rejects(
          saveDesign(
            db,
            ws,
            "designer",
            input.id,
            {
              ...data,
              items: data.items.map((i) => ({
                ...i,
                snagDocumentIds: [foreignImage],
              })),
            },
            2,
          ),
          DesignError,
        );
        await assert.rejects(
          saveDesign(db, ws, "designer", "missing", data, 0),
          DesignError,
        );
        await assert.rejects(
          saveDesign(
            db,
            ws,
            "designer",
            input.id,
            { ...data, boards: [{ ...board, key: "not_in_workflow" }] },
            2,
          ),
          DesignError,
        );
      },
    );
    await setVisibility(db, ws, input.id, {
      targetType: "board",
      targetId: board.id,
      clientVisible: true,
    });
    await setVisibility(db, ws, input.id, {
      targetType: "schedule",
      clientVisible: true,
    });
    await setVisibility(db, ws, input.id, {
      targetType: "phase",
      targetId: "concept",
      clientVisible: true,
    });
    await setVisibility(db, ws, input.id, {
      targetType: "phase",
      targetId: "documentation",
      clientVisible: true,
    });
    const live = await createShare(db, ws, input.id, "designer", {
      targetType: "board",
      targetId: board.id,
      mode: "live",
      permission: "comment",
    });
    const hiddenSnapshot = await createShare(db, ws, input.id, "designer", {
      targetType: "board",
      targetId: board.id,
      mode: "snapshot",
      permission: "view",
    });
    await t.test(
      "board publication never publishes a private source file or a private source phase",
      async () => {
        const page = await readShared(db, live.token);
        assert.equal(page.content.type, "board");
        if (page.content.type === "board")
          assert.deepEqual(page.content.imageUrls, {});
        await assert.rejects(sharedFile(db, live.token, image));
        await assert.rejects(sharedFile(db, live.token, foreignImage));
        await assert.rejects(sharedFile(db, live.token, "not-a-uuid"));
        await applyMutation(db, ws, input.id, {
          type: "setClientVisible",
          documentId: image,
          clientVisible: true,
        });
        await applyMutation(db, ws, input.id, {
          type: "setClientVisible",
          documentId: privatePhaseImage,
          clientVisible: true,
        });
        const shown = await readShared(db, live.token);
        if (shown.content.type === "board")
          assert.deepEqual(Object.keys(shown.content.imageUrls), [image]);
        const hidden = await readShared(db, hiddenSnapshot.token);
        if (hidden.content.type === "board")
          assert.deepEqual(hidden.content.imageUrls, {});
        await assert.rejects(sharedFile(db, live.token, privatePhaseImage));
        assert.ok(
          (await sharedFile(db, live.token, image)).pathname.includes(image),
        );
      },
    );
    const frozen = await createShare(db, ws, input.id, "designer", {
      targetType: "board",
      targetId: board.id,
      mode: "snapshot",
      permission: "view",
    });
    const schedule = await createShare(db, ws, input.id, "designer", {
      targetType: "schedule",
      mode: "live",
      permission: "view",
    });
    const frozenSchedule = await createShare(db, ws, input.id, "designer", {
      targetType: "schedule",
      mode: "snapshot",
      permission: "view",
    });
    const original = (await sharedFile(db, frozen.token, image)).pathname;
    await t.test(
      "live and frozen board/schedule links diverge; image version pointers remain frozen",
      async () => {
        data = {
          ...data,
          boards: data.boards.map((b) => ({
            ...b,
            cards: b.cards.map((c) =>
              c.id === card.id ? { ...c, body: "Updated oak finish" } : c,
            ),
          })),
          items: data.items.map((i) => ({
            ...i,
            specification: "Updated specification",
            status: "ordered" as const,
            deliveryDate: "2026-10-20",
          })),
        };
        await saveDesign(db, ws, "designer", input.id, data, 2);
        const updated = await readShared(db, live.token),
          old = await readShared(db, frozen.token);
        if (updated.content.type === "board" && old.content.type === "board") {
          assert.equal(
            updated.content.board.cards[0].body,
            "Updated oak finish",
          );
          assert.equal(old.content.board.cards[0].body, "Natural oak finish");
        }
        const newest = await readShared(db, schedule.token),
          oldSchedule = await readShared(db, frozenSchedule.token);
        assert.equal(newest.content.type, "schedule");
        if (
          newest.content.type === "schedule" &&
          oldSchedule.content.type === "schedule"
        ) {
          assert.equal(
            newest.content.items[0].specification,
            "Updated specification",
          );
          assert.equal(
            oldSchedule.content.items[0].specification,
            "Natural oak finish",
          );
          assert.equal(newest.content.items[0].quantity, 12);
        }
        const payload = JSON.stringify(newest);
        assert.ok(!payload.includes("PRIVATE"));
        assert.ok(!payload.includes("unitPriceCents"));
        assert.ok(!payload.includes("snagDocumentIds"));
        assert.ok(!payload.includes("workspaces/"));
        await applyMutation(db, ws, input.id, {
          type: "replaceDocumentFile",
          documentId: image,
          name: "new-swatch.png",
          sizeBytes: 100,
          storageKey: `${projectPrefix(ws, pid)}new-swatch.png`,
        });
        assert.equal(
          (await sharedFile(db, frozen.token, image)).pathname,
          original,
        );
        assert.notEqual(
          (await sharedFile(db, live.token, image)).pathname,
          original,
        );
        await assert.rejects(sharedFile(db, schedule.token, snag));
      },
    );
    await t.test(
      "visibility withdrawal, revocation and permissions also apply to board attachments",
      async () => {
        await commentShared(db, live.token, {
          authorName: "Guest",
          body: "Please review the finish",
        });
        await assert.rejects(
          commentShared(db, frozen.token, { authorName: "Guest", body: "No" }),
        );
        await assert.rejects(editSharedBrief(db, live.token, { notes: "No" }));
        assert.equal(
          createShareInput.safeParse({
            targetType: "board",
            targetId: board.id,
            mode: "live",
            permission: "edit",
          }).success,
          false,
        );
        await applyMutation(db, ws, input.id, {
          type: "setClientVisible",
          documentId: image,
          clientVisible: false,
        });
        await assert.rejects(sharedFile(db, frozen.token, image));
        const noImage = await readShared(db, frozen.token);
        if (noImage.content.type === "board")
          assert.deepEqual(noImage.content.imageUrls, {});
        await setVisibility(db, ws, input.id, {
          targetType: "phase",
          targetId: "concept",
          clientVisible: false,
        });
        await assert.rejects(readShared(db, frozen.token));
        await setVisibility(db, ws, input.id, {
          targetType: "phase",
          targetId: "concept",
          clientVisible: true,
        });
        await revokeShare(db, ws, input.id, live.link.id);
        await assert.rejects(readShared(db, live.token));
        await assert.rejects(sharedFile(db, live.token, image));
        assert.deepEqual((await listShares(db, other, input.id)).links, []);
      },
    );
    await t.test(
      "feature switches remove both offered and callable tools",
      async () => {
        await db.query(
          "INSERT INTO workspace_user_features(workspace_id,user_id,feature_key,enabled) VALUES($1,'designer','design',FALSE)",
          [ws],
        );
        const flags = await features(db, ws, "designer");
        assert.equal(flags.design, false);
        assert.ok(
          enabledTools(flags).every(
            (t) => t.module !== "canvas_board" && t.module !== "item_register",
          ),
        );
        const project = (await getProject(db, ws, input.id))!;
        assert.equal(
          (
            await runTool(
              {
                db,
                run: { workspaceId: ws, projectId: pid, userId: "designer" },
                project,
                features: flags,
                readFile: async () => null,
              },
              "read_project_items",
              {},
            )
          ).isError,
          true,
        );
      },
    );
    await t.test(
      "specification drafts are reviewed, costed and never apply themselves or send private procurement details",
      async () => {
        await saveProviderKey(
          db,
          "openrouter",
          "sk-test-design-key-1234",
          "designer",
        );
        const pick = {
          provider: "openrouter" as const,
          model: "worker",
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 2,
          zarPerUsd: 18,
        };
        await saveRoleModel(db, "worker", pick, "designer");
        await saveRoleModel(
          db,
          "orchestrator",
          { ...pick, model: "reviewer" },
          "designer",
        );
        await saveTaskRoute(
          db,
          "schedule_specification",
          "worker",
          0,
          "designer",
        );
        const before = await getDesign(db, ws, input.id);
        const calls: { model: string; messages: unknown[] }[] = [];
        let pass = true;
        const mock = (async (_url: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          calls.push(body);
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      body.model === "worker"
                        ? "Oak finish. Dimensions: To be confirmed."
                        : JSON.stringify({
                            pass,
                            feedback: pass
                              ? ""
                              : "Confirm dimensions before use",
                          }),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1000, completion_tokens: 100 },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch;
        const ctx = {
          workspaceId: ws,
          projectId: pid,
          userId: "designer",
          phaseKey: "documentation",
        };
        const item = {
          ...before.data.items[0],
          supplier: "SECRET SUPPLIER",
          notes: "SECRET SNAG",
          unitPriceCents: 999999,
        };
        const result = await draftSpecification(db, ctx, item, mock);
        assert.equal(result.text, "Oak finish. Dimensions: To be confirmed.");
        assert.equal(result.reviewNote, undefined);
        assert.deepEqual(
          calls.map((c) => c.model),
          ["worker", "reviewer"],
        );
        assert.ok(result.costZar > 0);
        for (const call of calls) {
          const sent = JSON.stringify(call.messages);
          assert.ok(
            !sent.includes("SECRET SUPPLIER") &&
              !sent.includes("SECRET SNAG") &&
              !sent.includes("999999"),
          );
        }
        const costs = await projectAiCosts(db, ws, pid, {
          phase: (key) => key,
          task: (key) => key,
        });
        assert.equal(costs.calls, 2);
        assert.ok(Math.abs(costs.totalZar - result.costZar) < 1e-8);
        assert.equal(costs.byTaskType[0].key, "schedule_specification");
        pass = false;
        assert.match(
          (await draftSpecification(db, ctx, item, mock)).reviewNote!,
          /did not pass review/,
        );
        assert.deepEqual(await getDesign(db, ws, input.id), before);
      },
    );
    await t.test(
      "backup restore retains boards, quotes, installation state and frozen attachments",
      async () => {
        const backup = await takeBackup(db);
        assert.equal(backup.counts.project_design, 1);
        const restore = new PGlite();
        try {
          await runMigrations({
            exec: (s) => restore.exec(s),
            query: (s, p) => restore.query(s, p),
          });
          const target: Db = {
            query: async (s, p) => (await restore.query(s, p)).rows as never,
          };
          await restoreBackup(target, backup);
          assert.deepEqual(await checkRestore(target, backup), []);
          assert.deepEqual(
            await getDesign(target, ws, input.id),
            await getDesign(db, ws, input.id),
          );
          assert.deepEqual(
            await readShared(target, frozenSchedule.token, false),
            await readShared(db, frozenSchedule.token, false),
          );
        } finally {
          await restore.close();
        }
      },
    );
  } finally {
    await pg.close();
  }
});
