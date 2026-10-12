import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../src/lib/db/migrator";
import type { Db } from "../src/lib/db";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { createProject, getProject } from "../src/lib/projects/store";
import { getWorkflow } from "../src/lib/workflow";
import { projectSections } from "../src/lib/studio/project-navigation";
import { DEMO_VIEWER } from "../src/lib/studio/viewer";
import {
  ACCESS_TEMPLATES,
  FULL_ACCESS,
  allowedSections,
  canUseTool,
  refuseMutation,
  toolKey,
  type ProjectAccess,
} from "../src/lib/team/access";
import { clientPage, defaultClientSettings } from "../src/lib/team/client-view";
import {
  accessByProject,
  addComment,
  applyWhiteboardOp,
  createChat,
  createClientInvite,
  deleteComment,
  listChats,
  listClientInvites,
  listComments,
  listMessages,
  listNotes,
  memberAccess,
  openClientInvite,
  postMessage,
  projectTeam,
  resolveComment,
  setMemberAccess,
  updateClientInvite,
} from "../src/lib/team/store";
import { AccessError } from "../src/lib/workspaces/store";
import { takeBackup, restoreBackup, checkRestore } from "../src/lib/backup/backup";

async function fresh() {
  const pg = new PGlite();
  await runMigrations({ exec: (s) => pg.exec(s), query: (s, p) => pg.query(s, p) });
  const db: Db = { query: async (s, p) => (await pg.query(s, p)).rows as never };
  return { db, pg };
}
const input = {
  id: "office",
  name: "Office",
  client: "Client",
  workflowId: "interior-design-corporate",
  startDate: "2026-10-01T00:00:00.000Z",
  swatch: "sage" as const,
};

async function setup(db: Db) {
  const ws = await ensureWorkspace(db, { sub: "owner", email: "owner@example.com", name: "Olive Owner" });
  await createProject(db, ws, input);
  for (const [id, role] of [["mem", "member"], ["col", "collaborator"], ["out", "collaborator"]] as const) {
    await db.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [id, `${id}@example.com`, id.toUpperCase()]);
    await db.query("INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)", [ws, id, role]);
  }
  const [p] = await db.query<{ id: string }>("SELECT id FROM projects WHERE workspace_id=$1 AND slug='office'", [ws]);
  // "col" is given this project; "out" is a collaborator on other projects only.
  await db.query("INSERT INTO project_members(workspace_id,project_id,user_id) VALUES($1,$2,'col')", [ws, p.id]);
  const project = (await getProject(db, ws, "office"))!;
  return { ws, project };
}

test("access rules: templates, sections and refused changes", async () => {
  const { db, pg } = await fresh();
  try {
    const { project } = await setup(db);
    const phases = getWorkflow(project).phases;
    const view = ACCESS_TEMPLATES.find((t) => t.key === "view")!.build(project);
    assert.equal(refuseMutation(project, view, { type: "setWaitingOn", waitingOn: "client" }), "You can view this project but not change it");
    assert.equal(refuseMutation(project, undefined, { type: "setWaitingOn", waitingOn: "client" }), null);

    const current = ACCESS_TEMPLATES.find((t) => t.key === "current_phase")!.build(project);
    assert.deepEqual(current.hiddenPhases, phases.map((p) => p.key).filter((k) => k !== project.currentPhase));
    const later = phases.find((p) => p.key !== project.currentPhase && p.checklist.length)!;
    const ownStep = phases.find((p) => p.key === project.currentPhase)!.checklist[0];
    assert.match(refuseMutation(project, current, { type: "setCheck", itemId: later.checklist[0].id, done: true }) ?? "", /not shared/);
    assert.equal(refuseMutation(project, current, { type: "setCheck", itemId: ownStep.id, done: true }), null);
    assert.match(refuseMutation(project, current, { type: "completePhase", phaseKey: later.key }) ?? "", /not shared/);
    assert.match(refuseMutation(project, current, { type: "shiftProject", days: 3 }) ?? "", /not shared/);
    const hideStep: ProjectAccess = { ...FULL_ACCESS, hiddenSteps: [ownStep.id] };
    assert.match(refuseMutation(project, hideStep, { type: "setStepDue", itemId: ownStep.id, due: "2026-11-01" }) ?? "", /not shared/);

    const noCosts = ACCESS_TEMPLATES.find((t) => t.key === "no_costs")!.build(project);
    const sections = projectSections(project, DEMO_VIEWER);
    const allowed = allowedSections(sections, noCosts, project.id).map((s) => toolKey(s.href, project.id));
    assert.ok(!allowed.includes("ai") && !allowed.includes("export"));
    assert.ok(allowed.includes("plan") && allowed.includes("team") && allowed.includes(null));
    assert.equal(canUseTool({ ...FULL_ACCESS, hiddenTools: ["boards"] }, "boards/moodboard"), false);
    // A project carrying the person's access hides those sections from its menu.
    assert.ok(!projectSections({ ...project, myAccess: noCosts }, DEMO_VIEWER).some((s) => s.href.endsWith("/ai")));
  } finally {
    await pg.close();
  }
});

test("per-member access is stored per project, owners keep full access, outsiders can't be set", async () => {
  const { db, pg } = await fresh();
  try {
    const { ws, project } = await setup(db);
    const team = await projectTeam(db, ws, "office");
    assert.deepEqual(team.map((m) => m.id), ["owner", "mem", "col"]);
    const view = ACCESS_TEMPLATES.find((t) => t.key === "view")!.build(project);
    await setMemberAccess(db, ws, "office", "owner", "col", { ...view, hiddenPhases: ["nope", project.currentPhase] });
    const saved = await memberAccess(db, ws, "office", "col", "collaborator");
    assert.equal(saved?.level, "view");
    assert.deepEqual(saved?.hiddenPhases, [project.currentPhase], "unknown phases are dropped");
    assert.equal((await accessByProject(db, ws, "col", "collaborator")).get("office")?.level, "view");
    assert.equal(await memberAccess(db, ws, "office", "owner", "owner"), null);
    await assert.rejects(setMemberAccess(db, ws, "office", "owner", "owner", view), (e) => e instanceof AccessError && e.status === 400);
    await assert.rejects(setMemberAccess(db, ws, "office", "owner", "out", view), (e) => e instanceof AccessError && e.status === 404);
    await setMemberAccess(db, ws, "office", "owner", "col", null);
    assert.equal(await memberAccess(db, ws, "office", "col", "collaborator"), null);
  } finally {
    await pg.close();
  }
});

test("comments, whiteboard notes and chats", async () => {
  const { db, pg } = await fresh();
  try {
    const { ws, project } = await setup(db);
    const step = getWorkflow(project).phases[0].checklist[0];
    const c = await addComment(db, ws, "office", { id: "mem", name: "MEM" }, { anchor: `step:${step.id}`, body: "Check the lease" });
    await addComment(db, ws, "office", { id: "owner", name: "Olive" }, { anchor: `step:${step.id}`, body: "Done", parentId: c.id });
    await assert.rejects(addComment(db, ws, "office", { id: "owner", name: "Olive" }, { anchor: "plan", body: "x", parentId: c.id }));
    await addComment(db, ws, "office", { id: "col", name: "COL" }, { anchor: "plan", body: "Door swing?" });
    assert.equal((await listComments(db, ws, "office", "step:")).length, 2);
    assert.equal((await listComments(db, ws, "office", "plan")).length, 1);
    assert.ok((await resolveComment(db, ws, "office", c.id, "owner", true)).resolvedAt);
    await assert.rejects(deleteComment(db, ws, "office", c.id, "col", false), (e) => e instanceof AccessError && e.status === 403);
    await deleteComment(db, ws, "office", c.id, "mem", false);
    assert.equal((await listComments(db, ws, "office", "step:")).length, 0, "replies go with their comment");

    const id = crypto.randomUUID();
    const note = { id, kind: "note" as const, text: "Idea", color: "#fff4b8" as const, x: 10, y: 10, w: 200, h: 160 };
    await applyWhiteboardOp(db, ws, "office", "MEM", { type: "put", note });
    await applyWhiteboardOp(db, ws, "office", "COL", { type: "put", note: { ...note, x: 300, text: "Idea, moved" } });
    const notes = await listNotes(db, ws, "office");
    assert.equal(notes.length, 1);
    assert.equal(notes[0].x, 300);
    assert.equal(notes[0].updatedBy, "COL");
    await applyWhiteboardOp(db, ws, "office", "MEM", { type: "remove", id });
    assert.equal((await listNotes(db, ws, "office")).length, 0);

    const chats = await listChats(db, ws, "office", "col");
    assert.deepEqual(chats.map((x) => x.name), ["Everyone"]);
    assert.equal((await listChats(db, ws, "office", "mem")).length, 1, "the Everyone chat is made once");
    await postMessage(db, ws, "office", chats[0].id, { id: "col", name: "COL" }, "Hello team");
    assert.equal((await listMessages(db, ws, "office", chats[0].id, "owner"))[0].body, "Hello team");
    const group = await createChat(db, ws, "office", "owner", { name: "Lighting", memberIds: ["mem"] });
    assert.deepEqual([...group.memberIds].sort(), ["mem", "owner"]);
    assert.equal((await listChats(db, ws, "office", "col")).length, 1, "a group chat is only for its members");
    await assert.rejects(listMessages(db, ws, "office", group.id, "col"), (e) => e instanceof AccessError && e.status === 404);
    await assert.rejects(createChat(db, ws, "office", "owner", { name: "X", memberIds: ["out"] }), (e) => e instanceof AccessError);
  } finally {
    await pg.close();
  }
});

test("client page opens only for the invited, verified email, shows only chosen phases and steps", async () => {
  const { db, pg } = await fresh();
  try {
    const { ws, project } = await setup(db);
    const phases = getWorkflow(project).phases;
    const settings = { ...defaultClientSettings(project), phases: [phases[0].key, phases[1].key], hiddenSteps: [phases[0].checklist[0].id] };
    const { invite, token } = await createClientInvite(db, ws, "office", "owner", " Client@Example.com ", settings);
    assert.equal(invite.email, "client@example.com");
    assert.equal(token.length, 43);
    const [stored] = await db.query<{ token_hash: string }>("SELECT token_hash FROM client_invites");
    assert.notEqual(stored.token_hash, token, "only a hash of the token is kept");

    assert.deepEqual(await openClientInvite(db, token, { email: "other@example.com", emailVerified: true }), { ok: false, reason: "wrong_person" });
    assert.deepEqual(await openClientInvite(db, token, { email: "client@example.com", emailVerified: false }), { ok: false, reason: "wrong_person" });
    assert.deepEqual(await openClientInvite(db, "x".repeat(43), { email: "client@example.com", emailVerified: true }), { ok: false, reason: "unavailable" });
    const opened = await openClientInvite(db, token, { email: "CLIENT@example.com", emailVerified: true });
    assert.ok(opened.ok);
    if (!opened.ok) return;
    const page = clientPage(opened.project, opened.settings, opened.studio);
    assert.deepEqual(page.phases.map((p) => p.key), [phases[0].key, phases[1].key]);
    assert.ok(!page.phases[0].steps.some((s) => s.id === phases[0].checklist[0].id));
    assert.equal(page.projectName, "Office");
    assert.equal((await listClientInvites(db, ws, "office"))[0].openCount, 1);

    await updateClientInvite(db, ws, "office", "owner", invite.id, { revoke: true });
    assert.deepEqual(await openClientInvite(db, token, { email: "client@example.com", emailVerified: true }), { ok: false, reason: "unavailable" });

    // The new tables are in the nightly backup and restore.
    const backup = await takeBackup(db);
    assert.equal(backup.counts.client_invites, 1);
    const target = await fresh();
    try {
      await restoreBackup(target.db, backup);
      assert.deepEqual(await checkRestore(target.db, backup), []);
    } finally {
      await target.pg.close();
    }
  } finally {
    await pg.close();
  }
});
