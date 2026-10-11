import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../src/lib/db/migrator";
import type { Db } from "../src/lib/db";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { createProject, projectDbId } from "../src/lib/projects/store";
import {
  invite,
  acceptInvitation,
  invitationInfo,
  canAccessProject,
  projectSlugs,
  features,
  updateMember,
  AccessError,
} from "../src/lib/workspaces/store";
import { enabledTools, runTool } from "../src/lib/ai/tools";
import {
  takeBackup,
  restoreBackup,
  checkRestore,
} from "../src/lib/backup/backup";

test("verified invitations, project-limited access, account deactivation and feature enforcement", async (t) => {
  const pg = new PGlite();
  await runMigrations({
    exec: (s) => pg.exec(s),
    query: (s, p) => pg.query(s, p),
  });
  const db: Db = {
    query: async (s, p) => (await pg.query(s, p)).rows as never,
  };
  try {
    const owner = {
      sub: "owner",
      email: "owner@example.com",
      email_verified: true,
    };
    await syncUser(db, owner);
    const ws = await ensureWorkspace(db, owner);
    const other = {
      sub: "other",
      email: "other@example.com",
      email_verified: true,
    };
    await syncUser(db, other);
    const otherWs = await ensureWorkspace(db, other);
    const input = {
      id: "allowed",
      name: "Allowed",
      client: "Client",
      workflowId: "interior-design-corporate",
      startDate: new Date().toISOString(),
      swatch: "sage" as const,
    };
    await createProject(db, ws, input);
    await createProject(db, ws, { ...input, id: "private" });
    await createProject(db, otherWs, input);
    const pid = (await projectDbId(db, ws, "allowed"))!;
    const foreign = (await projectDbId(db, otherWs, "allowed"))!;
    const guest = {
      sub: "guest",
      email: "guest@example.com",
      email_verified: true,
    };
    await syncUser(db, guest);
    await ensureWorkspace(db, guest);
    const invitation = await invite(
      db,
      ws,
      owner.sub,
      guest.email,
      "collaborator",
      [pid],
    );
    await t.test(
      "only the invited verified email can claim a single-use invitation",
      async () => {
        await assert.rejects(
          acceptInvitation(db, invitation.token, {
            ...guest,
            email_verified: false,
          }),
          AccessError,
        );
        await assert.rejects(
          acceptInvitation(db, invitation.token, other),
          AccessError,
        );
        assert.equal(await acceptInvitation(db, invitation.token, guest), ws);
        assert.equal(await invitationInfo(db, invitation.token), null);
        await assert.rejects(
          acceptInvitation(db, invitation.token, guest),
          AccessError,
        );
      },
    );
    await t.test(
      "collaborators see assigned projects and never another workspace's same slug",
      async () => {
        assert.equal(
          await canAccessProject(db, ws, guest.sub, "collaborator", "allowed"),
          true,
        );
        assert.equal(
          await canAccessProject(db, ws, guest.sub, "collaborator", "private"),
          false,
        );
        assert.equal(
          await canAccessProject(
            db,
            otherWs,
            guest.sub,
            "collaborator",
            "allowed",
          ),
          false,
        );
        assert.deepEqual(
          await projectSlugs(db, ws, guest.sub, "collaborator"),
          ["allowed"],
        );
        await assert.rejects(
          updateMember(db, ws, owner.sub, guest.sub, { projectIds: [foreign] }),
          AccessError,
        );
        await updateMember(db, ws, owner.sub, guest.sub, { projectIds: [] });
        assert.deepEqual(
          await projectSlugs(db, ws, guest.sub, "collaborator"),
          [],
        );
        await updateMember(db, ws, owner.sub, guest.sub, { projectIds: [pid] });
        assert.deepEqual(
          await projectSlugs(db, ws, guest.sub, "collaborator"),
          ["allowed"],
        );
        await assert.rejects(
          invite(db, ws, owner.sub, "new@example.com", "collaborator", [
            foreign,
          ]),
          AccessError,
        );
      },
    );
    await t.test(
      "deactivation survives future sign-ins and inactive users cannot accept invitations",
      async () => {
        await updateMember(db, ws, owner.sub, guest.sub, { active: false });
        assert.equal((await syncUser(db, guest)).active, false);
        const again = await invite(
          db,
          otherWs,
          other.sub,
          guest.email,
          "member",
        );
        await assert.rejects(
          acceptInvitation(db, again.token, guest),
          AccessError,
        );
        await assert.rejects(
          updateMember(db, ws, owner.sub, owner.sub, { active: false }),
          AccessError,
        );
        await assert.rejects(
          updateMember(db, ws, owner.sub, owner.sub, { role: "member" }),
          AccessError,
        );
        await updateMember(db, ws, owner.sub, guest.sub, { active: true });
        assert.equal((await syncUser(db, guest)).active, true);
      },
    );
    await t.test(
      "an explicit Admin role change survives bootstrap sign-in rules",
      async () => {
        const admin = {
          sub: "admin",
          email: "andre1.swanepoel1@gmail.com",
          email_verified: true,
        };
        await syncUser(db, admin);
        await db.query(
          "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'member')",
          [ws, admin.sub],
        );
        await updateMember(db, ws, owner.sub, admin.sub, {
          platformRole: "user",
        });
        assert.equal((await syncUser(db, admin)).platformRole, "user");
      },
    );
    await t.test(
      "disabled modules are neither offered nor callable through the assistant",
      async () => {
        await db.query(
          "INSERT INTO workspace_user_features(workspace_id,user_id,feature_key,enabled) VALUES($1,$2,'floor_plan',FALSE)",
          [ws, guest.sub],
        );
        const flags = await features(db, ws, guest.sub);
        assert.equal(flags.floor_plan, false);
        assert.equal((await features(db, ws, owner.sub)).floor_plan, true);
        assert.ok(
          !enabledTools(flags).some(
            (tool) =>
              tool.module === "floor_plan_editor" ||
              tool.module === "layout_generator",
          ),
        );
        const context = {
          db,
          run: { workspaceId: ws, projectId: pid, userId: guest.sub },
          project: {} as never,
          readFile: async () => null,
          features: flags,
        };
        assert.equal((await runTool(context, "read_plan", {})).isError, true);
      },
    );
    await t.test(
      "backup and restore retain invitations, restricted membership and feature switches",
      async () => {
        const backup = await takeBackup(db);
        const scratch = new PGlite();
        try {
          await runMigrations({
            exec: (s) => scratch.exec(s),
            query: (s, p) => scratch.query(s, p),
          });
          const restored: Db = {
            query: async (s, p) => (await scratch.query(s, p)).rows as never,
          };
          await restoreBackup(restored, backup);
          assert.deepEqual(await checkRestore(restored, backup), []);
          assert.deepEqual(
            await projectSlugs(restored, ws, guest.sub, "collaborator"),
            ["allowed"],
          );
          assert.equal(
            (await features(restored, ws, guest.sub)).floor_plan,
            false,
          );
        } finally {
          await scratch.close();
        }
      },
    );
  } finally {
    await pg.close();
  }
});
