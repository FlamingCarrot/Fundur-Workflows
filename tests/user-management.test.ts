import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { acceptInviteLink, setViewMode, syncUser } from "../src/lib/auth/users";
import { createInvite, listInvites, listUsers, revokeInvite, saveAccess, updateUser, UserAdminError } from "../src/lib/admin/users";
import { createIssue, listMyIssues, listTickets, replyToTicket } from "../src/lib/issues/store";
import { changeMySupport, createSupportRequest, listMySupport } from "../src/lib/support/store";

const ADMIN = { sub: "google-oauth2|andre", email: "andre1.swanepoel1@gmail.com", email_verified: true, name: "Andre" };

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

async function withAdmin() {
  const db = await freshDb();
  const admin = await syncUser(db, ADMIN);
  await ensureWorkspace(db, ADMIN);
  return { db, admin };
}

test("everyone already signing up gets in while sign-ups are open", async () => {
  const { db } = await withAdmin();
  const someone = await syncUser(db, { sub: "auth0|someone", email: "someone@example.com", email_verified: true });
  assert.equal(someone.status, "active");
  assert.equal(someone.platformRole, "user");
});

test("with invite only on, a stranger waits and the Admin can let them in", async () => {
  const { db, admin } = await withAdmin();
  await saveAccess(db, admin.id, { inviteOnly: true });
  const stranger = await syncUser(db, { sub: "auth0|stranger", email: "stranger@example.com", email_verified: true });
  assert.equal(stranger.status, "waiting");
  // Waiting people come first in the Admin's list.
  assert.equal((await listUsers(db))[0].id, stranger.id);

  await updateUser(db, admin.id, stranger.id, { status: "active" });
  assert.equal((await syncUser(db, { sub: "auth0|stranger", email: "stranger@example.com" })).status, "active");
  // The Admin is never kept waiting.
  assert.equal((await syncUser(db, ADMIN)).status, "active");
});

test("an invited address gets straight in, with the role the invite gives, and the invite is used up", async () => {
  const { db, admin } = await withAdmin();
  await saveAccess(db, admin.id, { inviteOnly: true });
  const invite = await createInvite(db, admin.id, { email: "Wife@Example.com", name: "Mrs S", role: "user" });
  assert.equal(invite.email, "wife@example.com");
  assert.ok(invite.token.length >= 24);
  assert.equal((await listInvites(db)).length, 1);

  const wife = await syncUser(db, { sub: "auth0|wife", email: "wife@example.com", email_verified: true, name: "Mrs S" });
  assert.equal(wife.status, "active");
  assert.equal(wife.platformRole, "user");
  assert.deepEqual(await listInvites(db), []);
});

test("an unverified address does not use up an invite", async () => {
  const { db, admin } = await withAdmin();
  await saveAccess(db, admin.id, { inviteOnly: true });
  await createInvite(db, admin.id, { email: "wife@example.com", role: "user" });
  const claimant = await syncUser(db, { sub: "auth0|claimant", email: "wife@example.com", email_verified: false });
  assert.equal(claimant.status, "waiting");
  assert.equal((await listInvites(db)).length, 1);
});

test("the invite link lets someone in who signed up with a different address", async () => {
  const { db, admin } = await withAdmin();
  await saveAccess(db, admin.id, { inviteOnly: true });
  const invite = await createInvite(db, admin.id, { email: "wife@example.com", role: "user" });
  const other = { sub: "google-oauth2|wife", email: "wife.other@example.com", email_verified: true };
  assert.equal((await syncUser(db, other)).status, "waiting");

  assert.equal(await acceptInviteLink(db, other, invite.token), "accepted");
  assert.equal((await syncUser(db, other)).status, "active");
  // Opening it again is harmless; someone else can't reuse it.
  assert.equal(await acceptInviteLink(db, other, invite.token), "accepted");
  assert.equal(await acceptInviteLink(db, { sub: "auth0|late", email: "late@example.com" }, invite.token), "invalid");
  assert.equal(await acceptInviteLink(db, other, "not-a-token"), "invalid");
});

test("an Admin invite only works for its own verified address", async () => {
  const { db, admin } = await withAdmin();
  const invite = await createInvite(db, admin.id, { email: "partner@example.com", role: "admin" });
  const forwarded = { sub: "auth0|forwarded", email: "someone@example.com", email_verified: true };
  assert.equal(await acceptInviteLink(db, forwarded, invite.token), "wrong_email");
  assert.equal((await syncUser(db, forwarded)).platformRole, "user");

  const partner = await syncUser(db, { sub: "auth0|partner", email: "partner@example.com", email_verified: true });
  assert.equal(partner.platformRole, "admin");
});

test("a revoked invite stops working, and re-inviting renews the link", async () => {
  const { db, admin } = await withAdmin();
  const first = await createInvite(db, admin.id, { email: "a@example.com", role: "user" });
  const second = await createInvite(db, admin.id, { email: "a@example.com", role: "admin" });
  assert.notEqual(first.token, second.token);
  const open = await listInvites(db);
  assert.equal(open.length, 1);
  assert.equal(open[0].role, "admin");

  assert.equal(await revokeInvite(db, second.id), true);
  assert.equal(await acceptInviteLink(db, { sub: "auth0|a", email: "a@example.com", email_verified: true }, second.token), "invalid");
});

test("someone who already has an account can't be invited", async () => {
  const { db, admin } = await withAdmin();
  await syncUser(db, { sub: "auth0|here", email: "here@example.com" });
  await assert.rejects(createInvite(db, admin.id, { email: "HERE@example.com", role: "user" }), UserAdminError);
});

test("the Admin can change roles and switch people off, but not themselves", async () => {
  const { db, admin } = await withAdmin();
  const user = await syncUser(db, { sub: "auth0|user", email: "user@example.com" });
  assert.equal((await updateUser(db, admin.id, user.id, { role: "admin" })).role, "admin");
  assert.equal((await updateUser(db, admin.id, user.id, { role: "user" })).role, "user");

  assert.equal((await updateUser(db, admin.id, user.id, { status: "disabled" })).status, "disabled");
  assert.equal((await syncUser(db, { sub: "auth0|user", email: "user@example.com" })).status, "disabled");
  // An invite to a switched-off person's address does not switch them back on.
  assert.equal((await updateUser(db, admin.id, user.id, { status: "active" })).status, "active");

  await assert.rejects(updateUser(db, admin.id, admin.id, { role: "user" }), /own Admin access/);
  await assert.rejects(updateUser(db, admin.id, admin.id, { status: "disabled" }), /own Admin access/);
  await assert.rejects(updateUser(db, admin.id, "auth0|nobody", { role: "admin" }), /No such person/);
});

test("the Admin's view choice is kept with them", async () => {
  const { db, admin } = await withAdmin();
  assert.equal(admin.viewMode, "admin");
  await setViewMode(db, admin.id, "basic");
  const again = await syncUser(db, ADMIN);
  assert.equal(again.viewMode, "basic");
  // Basic view never takes the role itself away.
  assert.equal(again.platformRole, "admin");
});

test("a support request is a conversation in the Admin's queue, apart from issue markers", async () => {
  const { db, admin } = await withAdmin();
  const wife = { sub: "auth0|wife", email: "wife@example.com", email_verified: true, name: "Mrs S" };
  const user = await syncUser(db, wife);
  const ws = await ensureWorkspace(db, wife);

  const request = await createSupportRequest(db, ws, user.id, {
    topic: "how_to",
    subject: "Adding a client",
    message: "Where do I put the client's details?",
    path: "/support",
  });
  assert.equal(request.status, "open");
  assert.equal(request.messages.length, 1);
  assert.equal(request.unread, false);
  await createIssue(db, ws, user.id, { moduleKey: "documents", note: "Upload stuck", path: "/x" });

  // Issue markers only count issue reports.
  assert.equal((await listMyIssues(db, ws, user.id)).length, 1);
  const tickets = await listTickets(db);
  assert.equal(tickets.length, 2);
  const ticket = tickets.find((t) => t.kind === "support")!;
  assert.equal(ticket.subject, "Adding a client");
  assert.equal(ticket.topic, "how_to");
  assert.equal(ticket.messages[0].body, "Where do I put the client's details?");

  const answered = await replyToTicket(db, admin.id, request.id, "On the project's brief, first page.");
  assert.equal(answered?.status, "in_progress");
  assert.equal(answered?.messages.length, 2);
  assert.equal(answered?.messages[1].fromAdmin, true);

  let [mine] = await listMySupport(db, user.id);
  assert.equal(mine.unread, true);
  mine = (await changeMySupport(db, user.id, mine.id, { seen: true }))!;
  assert.equal(mine.unread, false);

  // A reply after it was resolved opens it again.
  await db.query("UPDATE issue_reports SET status = 'resolved' WHERE id = $1", [mine.id]);
  mine = (await changeMySupport(db, user.id, mine.id, { reply: "One more thing" }))!;
  assert.equal(mine.status, "open");
  assert.equal(mine.messages.length, 3);

  // Nobody else can touch it.
  const other = await syncUser(db, { sub: "auth0|other", email: "other@example.com" });
  assert.equal(await changeMySupport(db, other.id, mine.id, { reply: "Hi" }), null);
  assert.deepEqual(await listMySupport(db, other.id), []);

  mine = (await changeMySupport(db, user.id, mine.id, { close: true }))!;
  assert.equal(mine.status, "closed");
  assert.equal(await replyToTicket(db, admin.id, mine.id, "Too late"), null);
});
