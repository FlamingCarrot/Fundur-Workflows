import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import {
  createProject,
  applyMutation,
  projectDbId,
  getProject,
} from "../src/lib/projects/store";
import {
  createShare,
  setVisibility,
  readShared,
  approveShared,
  listShares,
  commentShared,
  revokeShare,
  ShareError,
} from "../src/lib/sharing/store";
import { createShareInput, approvalInput } from "../src/lib/sharing/schema";
import { takeBackup, restoreBackup } from "../src/lib/backup/backup";
import { collectProjectArchive } from "../src/lib/export/project";
import { eventsSince } from "../src/lib/realtime/channel";
const projectInput = {
  id: "approval-office",
  name: "Office",
  client: "Client",
  workflowId: "interior-design-corporate",
  startDate: "2026-10-08T00:00:00Z",
  swatch: "sage" as const,
};
const decision = (
  kind: "approved" | "changes_requested" = "approved",
  note = "",
) => ({
  requestId: randomUUID(),
  authorName: "Client representative",
  decision: kind,
  note,
  reviewed: true as const,
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
  const ws = await ensureWorkspace(db, { sub: "auth0|approval-owner" }),
    other = await ensureWorkspace(db, { sub: "auth0|approval-other" });
  await createProject(db, ws, projectInput);
  await createProject(db, other, projectInput);
  const id = (await projectDbId(db, ws, projectInput.id))!;
  await applyMutation(db, ws, projectInput.id, {
    type: "updateBrief",
    patch: { headcount: "15" },
    fromAi: false,
  });
  await setVisibility(db, ws, projectInput.id, {
    targetType: "phase",
    targetId: "discovery",
    clientVisible: true,
  });
  await setVisibility(db, ws, projectInput.id, {
    targetType: "brief",
    clientVisible: true,
  });
  return { pg, db, ws, other, id };
}
test("client decisions require a frozen copy, named reviewer, explicit acknowledgement and change details", () => {
  assert(
    createShareInput.safeParse({
      targetType: "brief",
      mode: "snapshot",
      permission: "approve",
    }).success,
  );
  assert(
    !createShareInput.safeParse({
      targetType: "brief",
      mode: "live",
      permission: "approve",
    }).success,
  );
  assert(approvalInput.safeParse(decision()).success);
  assert(!approvalInput.safeParse({ ...decision(), reviewed: false }).success);
  assert(!approvalInput.safeParse(decision("changes_requested")).success);
  assert(!approvalInput.safeParse({ ...decision(), authorName: " " }).success);
  assert(
    !approvalInput.safeParse({ ...decision(), note: "x".repeat(3001) }).success,
  );
});
test("frozen approvals persist idempotently, stay scoped and survive changes, archive and backup", async () => {
  const { pg, db, ws, other } = await setup();
  try {
    const share = await createShare(
      db,
      ws,
      projectInput.id,
      "auth0|approval-owner",
      { targetType: "brief", mode: "snapshot", permission: "approve" },
    );
    await applyMutation(db, ws, projectInput.id, {
      type: "updateBrief",
      patch: { headcount: "25" },
      fromAi: false,
    });
    const input = decision(),
      results = await Promise.all([
        approveShared(db, share.token, input),
        approveShared(db, share.token, input),
      ]);
    assert.equal(results[0].id, results[1].id);
    await assert.rejects(
      approveShared(db, share.token, { ...input, note: "Different" }),
      (e) => e instanceof ShareError && e.status === 409,
    );
    let page = await readShared(db, share.token);
    assert.equal(page.content.type, "brief");
    if (page.content.type === "brief")
      assert.equal(
        page.content.fields.find((f) => f.key === "headcount")!.value,
        "15",
      );
    assert.equal(page.approvals!.length, 1);
    assert.equal(page.approvals![0].decision, "approved");
    await commentShared(db, share.token, {
      authorName: "Client",
      body: "Approved layout; material details to follow.",
    });
    const changed = await approveShared(
      db,
      share.token,
      decision(
        "changes_requested",
        "Please increase the meeting room capacity.",
      ),
    );
    page = await readShared(db, share.token);
    assert.equal(page.approvals!.length, 2);
    assert.equal(page.approvals!.at(-1)!.id, changed.id);
    const links = await listShares(db, ws, projectInput.id);
    const events=await eventsSince(db,ws,projectInput.id,"0");
    assert.equal(events.events.filter(e=>e.type==="CLIENT_REVIEWED").length,2);
    assert(!events.events.some(e=>e.type==="RECORD_AUTOSAVED"));
    assert.equal(links.links[0].approval!.id, changed.id);
    assert.deepEqual((await listShares(db, other, projectInput.id)).links, []);
    const project = await getProject(db, ws, projectInput.id);
    assert.deepEqual(project!.completedPhases, []);
    assert(!Object.values(project!.checks).some(Boolean));
    const archive = await collectProjectArchive(db, ws, projectInput.id);
    const reviews = archive.data.clientReviews as {
      frozenCopy: unknown;
      decisions: { content_hash: string; note: string }[];
    }[];
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].decisions.length, 2);
    assert.match(reviews[0].decisions[0].content_hash, /^[a-f0-9]{64}$/);
    assert.equal(
      reviews[0].decisions[0].content_hash,
      reviews[0].decisions[1].content_hash,
    );
    assert(!JSON.stringify(reviews).includes(share.token));
    assert.deepEqual(
      (await collectProjectArchive(db, other, projectInput.id)).data
        .clientReviews,
      [],
    );
    const restoredPg = new PGlite();
    try {
      await runMigrations({
        exec: (s) => restoredPg.exec(s),
        query: (s, p) => restoredPg.query(s, p),
      });
      const restored: Db = {
        query: async (s, p) => (await restoredPg.query(s, p)).rows as never,
      };
      await restoreBackup(restored, await takeBackup(db));
      assert.equal(
        (await readShared(restored, share.token)).approvals!.length,
        2,
      );
    } finally {
      await restoredPg.close();
    }
  } finally {
    await pg.close();
  }
});
test("visibility, expiration and revocation are checked in the decision write, and ordinary links cannot approve", async () => {
  const { pg, db, ws } = await setup();
  try {
    const link = await createShare(
      db,
      ws,
      projectInput.id,
      "auth0|approval-owner",
      { targetType: "brief", mode: "snapshot", permission: "approve" },
    );
    const view = await createShare(
      db,
      ws,
      projectInput.id,
      "auth0|approval-owner",
      { targetType: "brief", mode: "snapshot", permission: "view" },
    );
    await assert.rejects(
      approveShared(db, view.token, decision()),
      /does not request/,
    );
    await setVisibility(db, ws, projectInput.id, {
      targetType: "brief",
      clientVisible: false,
    });
    await assert.rejects(
      approveShared(db, link.token, decision()),
      /unavailable/,
    );
    await setVisibility(db, ws, projectInput.id, {
      targetType: "brief",
      clientVisible: true,
    });
    let revoked = false;
    const race: Db = {
      query: async (s, p) => {
        if (s.startsWith("WITH added AS") && !revoked) {
          revoked = true;
          await revokeShare(db, ws, projectInput.id, link.link.id);
        }
        return db.query(s, p);
      },
    };
    await assert.rejects(
      approveShared(race, link.token, decision()),
      /could not be saved/,
    );
    assert.equal(
      (await listShares(db, ws, projectInput.id)).links.find(
        (l) => l.id === link.link.id,
      )!.approval,
      null,
    );
    const expiry = await createShare(
      db,
      ws,
      projectInput.id,
      "auth0|approval-owner",
      {
        targetType: "brief",
        mode: "snapshot",
        permission: "approve",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    );
    await db.query(
      "UPDATE share_links SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
      [expiry.link.id],
    );
    await assert.rejects(
      approveShared(db, expiry.token, decision()),
      /unavailable/,
    );
    const phase = await createShare(
      db,
      ws,
      projectInput.id,
      "auth0|approval-owner",
      { targetType: "brief", mode: "snapshot", permission: "approve" },
    );
    await setVisibility(db, ws, projectInput.id, {
      targetType: "phase",
      targetId: "discovery",
      clientVisible: false,
    });
    await assert.rejects(
      approveShared(db, phase.token, decision()),
      /unavailable/,
    );
    await setVisibility(db,ws,projectInput.id,{targetType:"phase",targetId:"discovery",clientVisible:true});
    const limited=await createShare(db,ws,projectInput.id,"auth0|approval-owner",{targetType:"brief",mode:"snapshot",permission:"approve"});
    const attempts=await Promise.allSettled(Array.from({length:12},()=>approveShared(db,limited.token,decision())));
    assert.equal(attempts.filter(a=>a.status==="fulfilled").length,10);
  } finally {
    await pg.close();
  }
});
