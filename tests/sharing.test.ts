import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../src/lib/db/migrator";
import type { Db } from "../src/lib/db";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import {
  createProject,
  projectDbId,
  applyMutation,
  getProject,
} from "../src/lib/projects/store";
import { savePlan } from "../src/lib/plan/store";
import { samplePlan } from "../src/lib/plan/geometry";
import { projectPrefix } from "../src/lib/storage/blob";
import {
  createShare,
  listShares,
  setVisibility,
  readShared,
  revokeShare,
  commentShared,
  internalComments,
  editSharedBrief,
  sharedFile,
  ShareError,
} from "../src/lib/sharing/store";
import { createShareInput } from "../src/lib/sharing/schema";
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
  startDate: "2026-10-01T00:00:00.000Z",
  swatch: "sage" as const,
};
async function fresh() {
  const pg = new PGlite();
  await runMigrations({
    exec: (s) => pg.exec(s),
    query: (s, p) => pg.query(s, p),
  });
  const db: Db = {
    query: async (s, p) => (await pg.query(s, p)).rows as never,
  };
  return { db, pg };
}
test("explicit publication, frozen/live content, revocation, comments and tenant isolation", async (t) => {
  const { db, pg } = await fresh();
  try {
    const ws = await ensureWorkspace(db, {
      sub: "owner",
      email: "owner@example.com",
    });
    const other = await ensureWorkspace(db, {
      sub: "other",
      email: "other@example.com",
    });
    await createProject(db, ws, input);
    await createProject(db, other, input);
    const pid = (await projectDbId(db, ws, input.id))!;
    await applyMutation(db, ws, input.id, {
      type: "updateBrief",
      patch: { headcount: "12" },
      fromAi: false,
    });
    await t.test(
      "a private brief cannot be shared; phase and document both need an explicit flag",
      async () => {
        await assert.rejects(
          createShare(db, ws, input.id, "owner", {
            targetType: "brief",
            mode: "snapshot",
            permission: "view",
          }),
          ShareError,
        );
        await setVisibility(db, ws, input.id, {
          targetType: "brief",
          clientVisible: true,
        });
        await assert.rejects(
          createShare(db, ws, input.id, "owner", {
            targetType: "brief",
            mode: "snapshot",
            permission: "view",
          }),
          ShareError,
        );
        await setVisibility(db, ws, input.id, {
          targetType: "phase",
          targetId: "discovery",
          clientVisible: true,
        });
      },
    );
    const live = await createShare(db, ws, input.id, "owner", {
      targetType: "brief",
      mode: "live",
      permission: "comment",
    });
    const frozen = await createShare(db, ws, input.id, "owner", {
      targetType: "brief",
      mode: "snapshot",
      permission: "view",
    });
    await t.test(
      "the bearer token is never retained or listed and live/frozen links diverge after an edit",
      async () => {
        assert.equal(live.token.length, 43);
        const [stored] = await db.query<{ token: string }>(
          "SELECT token FROM share_links WHERE id=$1",
          [live.link.id],
        );
        assert.notEqual(stored.token, live.token);
        assert.equal(stored.token.length, 64);
        await applyMutation(db, ws, input.id, {
          type: "updateBrief",
          patch: { headcount: "24" },
          fromAi: false,
        });
        const lp = await readShared(db, live.token);
        const fp = await readShared(db, frozen.token);
        assert.equal(lp.content.type, "brief");
        assert.equal(fp.content.type, "brief");
        if (lp.content.type === "brief" && fp.content.type === "brief") {
          assert.equal(
            lp.content.fields.find((f) => f.key === "headcount")?.value,
            "24",
          );
          assert.equal(
            fp.content.fields.find((f) => f.key === "headcount")?.value,
            "12",
          );
        }
        const listed = await listShares(db, ws, input.id);
        assert.equal(
          listed.links.find((l) => l.id === live.link.id)?.viewCount,
          1,
        );
        assert.ok(!JSON.stringify(listed).includes(live.token));
        assert.ok(!JSON.stringify(lp).includes(ws));
        assert.deepEqual((await listShares(db, other, input.id)).links, []);
      },
    );
    await t.test(
      "view links reject comments and edits; comments stay within their link",
      async () => {
        await assert.rejects(
          commentShared(db, frozen.token, {
            authorName: "Client",
            body: "Hello",
          }),
          (e) => e instanceof ShareError && e.status === 403,
        );
        const comment = await commentShared(db, live.token, {
          authorName: "Client",
          body: "Can we fit more desks?",
        });
        const reply = await internalComments(db, ws, input.id, live.link.id, {
          authorName: "Studio",
          body: "We will check.",
          parentId: comment.id,
        });
        assert.ok(!Array.isArray(reply) && reply.internal);
        assert.equal(
          (await readShared(db, live.token, false)).comments.length,
          2,
        );
        await assert.rejects(
          internalComments(db, other, input.id, live.link.id),
          ShareError,
        );
        const another = await createShare(db, ws, input.id, "owner", {
          targetType: "brief",
          mode: "live",
          permission: "comment",
        });
        await assert.rejects(
          commentShared(db, another.token, {
            authorName: "Other",
            body: "Reply",
            parentId: comment.id,
          }),
          ShareError,
        );
        await assert.rejects(
          editSharedBrief(db, live.token, { headcount: "99" }),
          (e) => e instanceof ShareError && e.status === 403,
        );
      },
    );
    await t.test(
      "edit permission is limited to live brief fields and never changes other project data",
      async () => {
        assert.equal(
          createShareInput.safeParse({
            targetType: "brief",
            mode: "snapshot",
            permission: "edit",
          }).success,
          false,
        );
        const editable = await createShare(db, ws, input.id, "owner", {
          targetType: "brief",
          mode: "live",
          permission: "edit",
        });
        await editSharedBrief(db, editable.token, { headcount: "30" });
        assert.equal(
          (await getProject(db, ws, input.id))?.brief.headcount,
          "30",
        );
        await assert.rejects(
          editSharedBrief(db, editable.token, { checks: "true" }),
          ShareError,
        );
        assert.notEqual(
          (await getProject(db, other, input.id))?.brief.headcount,
          "30",
        );
      },
    );
    await t.test(
      "hiding a phase or target ends access even to frozen content and files",
      async () => {
        await setVisibility(db, ws, input.id, {
          targetType: "phase",
          targetId: "discovery",
          clientVisible: false,
        });
        await assert.rejects(readShared(db, frozen.token), ShareError);
        await setVisibility(db, ws, input.id, {
          targetType: "phase",
          targetId: "discovery",
          clientVisible: true,
        });
        await setVisibility(db, ws, input.id, {
          targetType: "brief",
          clientVisible: false,
        });
        await assert.rejects(readShared(db, live.token), ShareError);
        await setVisibility(db, ws, input.id, {
          targetType: "brief",
          clientVisible: true,
        });
        await revokeShare(db, ws, input.id, live.link.id);
        await assert.rejects(readShared(db, live.token), ShareError);
        await assert.rejects(
          revokeShare(db, other, input.id, frozen.link.id),
          ShareError,
        );
        await db.query(
          "UPDATE share_links SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
          [frozen.link.id],
        );
        await assert.rejects(readShared(db, frozen.token), ShareError);
        await assert.rejects(readShared(db, "unknown"), ShareError);
      },
    );
    await t.test(
      "frozen uploads keep their file version, and raw storage paths never reach the client",
      async () => {
        const doc = "55555555-5555-4555-8555-555555555555",
          key = projectPrefix(ws, pid) + "first.pdf";
        await applyMutation(db, ws, input.id, {
          type: "addDocuments",
          documents: [
            {
              id: doc,
              name: "First.pdf",
              sizeBytes: 50,
              phaseKey: "discovery",
              uploadedAt: new Date().toISOString(),
              clientVisible: true,
              storageKey: key,
            },
          ],
        });
        const fileShare = await createShare(db, ws, input.id, "owner", {
          targetType: "document",
          targetId: doc,
          mode: "snapshot",
          permission: "view",
        });
        await applyMutation(db, ws, input.id, {
          type: "replaceDocumentFile",
          documentId: doc,
          name: "Second.pdf",
          sizeBytes: 80,
          storageKey: projectPrefix(ws, pid) + "second.pdf",
        });
        assert.equal((await sharedFile(db, fileShare.token)).pathname, key);
        const page = await readShared(db, fileShare.token);
        assert.ok(!JSON.stringify(page).includes(key));
        assert.equal(page.content.type, "document");
        if (page.content.type === "document")
          assert.equal(page.content.name, "First.pdf");
        await setVisibility(db, ws, input.id, {
          targetType: "document",
          targetId: doc,
          clientVisible: false,
        });
        await assert.rejects(sharedFile(db, fileShare.token), ShareError);
      },
    );
    await t.test(
      "shared plans exclude private notes, import data and unchosen options",
      async () => {
        const plan = samplePlan();
        plan.notes = [
          {
            id: "private",
            levelId: plan.levels[0].id,
            at: { x: 0, y: 0 },
            text: "Private fee advice",
          },
        ];
        plan.source = {
          name: "private-source.dxf",
          format: "dxf",
          importedAt: new Date().toISOString(),
          warnings: [],
        };
        await savePlan(db, ws, "owner", input.id, {
          plan,
          baseRevision: null,
          changes: ["Plan"],
        });
        await setVisibility(db, ws, input.id, {
          targetType: "plan",
          clientVisible: true,
        });
        await setVisibility(db, ws, input.id, {
          targetType: "phase",
          targetId: "space_planning",
          clientVisible: true,
        });
        const share = await createShare(db, ws, input.id, "owner", {
          targetType: "plan",
          mode: "snapshot",
          permission: "view",
        });
        const page = await readShared(db, share.token);
        assert.ok(!JSON.stringify(page).includes("private-source"));
        assert.ok(!JSON.stringify(page).includes("Private fee advice"));
        assert.equal(page.content.type, "plan");
      },
    );
    await t.test(
      "a restore includes links, visibility and threaded comments in dependency order",
      async () => {
        const [message] = await db.query<{ id: string }>(
          "INSERT INTO ai_chat_messages(workspace_id,project_id,role,content) VALUES($1,$2,'assistant','Saved reply') RETURNING id",
          [ws, pid],
        );
        await db.query(
          "INSERT INTO ai_runs(workspace_id,project_id,task_name,model_name,provider,chat_message_id) VALUES($1,$2,'chat','test','openrouter',$3)",
          [ws, pid, message.id],
        );
        await db.query(
          "INSERT INTO ai_proposals(workspace_id,project_id,message_id,summary,mutation) VALUES($1,$2,$3,'Proposal','{}')",
          [ws, pid, message.id],
        );
        const backup = await takeBackup(db);
        const scratch = await fresh();
        try {
          await restoreBackup(scratch.db, backup);
          assert.deepEqual(await checkRestore(scratch.db, backup), []);
          const [before] = await db.query(
            "SELECT * FROM share_comments WHERE parent_id IS NOT NULL",
          );
          const [after] = await scratch.db.query(
            "SELECT * FROM share_comments WHERE parent_id IS NOT NULL",
          );
          assert.deepEqual(after, before);
        } finally {
          await scratch.pg.close();
        }
      },
    );
  } finally {
    await pg.close();
  }
});
