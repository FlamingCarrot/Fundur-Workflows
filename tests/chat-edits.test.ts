import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { addMessage, createProposal, listMessages, replaceFrom } from "../src/lib/ai/chat-store";
import { createProject, projectDbId } from "../src/lib/projects/store";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";
import { speakable } from "../src/hooks/useVoice";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";

async function setup() {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  const ws = await ensureWorkspace(db, { sub: "auth0|designer" });
  await createProject(db, ws, { id: "harbour", name: "Harbour", client: "H", workflowId: DEFAULT_WORKFLOW_ID, startDate: "2026-10-01T00:00:00.000Z", swatch: "sage" });
  const projectId = (await projectDbId(db, ws, "harbour"))!;
  let minute = 0;
  /** Adds a message a minute after the last, so the order is certain. */
  const say = async (userId: string, role: "user" | "assistant", content: string) => {
    const id = await addMessage(db, ws, projectId, { userId, role, content });
    await db.query(`UPDATE ai_chat_messages SET created_at = '2026-10-13T08:00:00Z'::timestamptz + ($2 || ' minutes')::interval WHERE id = $1`, [id, String(minute++)]);
    return id;
  };
  return { db, ws, projectId, say };
}

const draft = (summary: string) => ({ summary, mutation: { type: "update_project", changes: { name: summary } } }) as never;

test("editing a message replaces it and the replies after it, and keeps their changes undoable", async () => {
  const { db, ws, projectId, say } = await setup();
  await say("me", "user", "Hi");
  await say("me", "assistant", "Hello");
  const ask = await say("me", "user", "Rename it");
  const reply = await say("me", "assistant", "Renamed");
  await createProposal(db, ws, projectId, reply, draft("Renamed the project"), { undo: { type: "update_project", changes: { name: "Harbour" } }, userId: "me" });
  const waiting = await createProposal(db, ws, projectId, reply, draft("Also rename the client"));

  assert.equal(await replaceFrom(db, ws, projectId, "me", ask), true);
  // The replacement, as the orchestrator would add it.
  const again = await say("me", "user", "Rename it to Harbour House");

  const list = await listMessages(db, ws, projectId, 100, { viewerId: "me" });
  assert.deepEqual(list.map((m) => m.content), ["Hi", "Hello", "Rename it to Harbour House"]);
  assert.equal(list[2].id, again);
  assert.equal(list[2].mine, true);
  assert.deepEqual(list[2].kept?.map((p) => [p.summary, p.undoable]), [["Renamed the project", true]]);
  // What the replaced reply only proposed no longer waits.
  const [row] = await db.query<{ status: string }>("SELECT status FROM ai_proposals WHERE id = $1", [waiting.id]);
  assert.equal(row.status, "dismissed");
  // Already replaced messages can't be replaced again.
  assert.equal(await replaceFrom(db, ws, projectId, "me", ask), false);
});

test("only her own message can be replaced, and never over a teammate's later message", async () => {
  const { db, ws, projectId, say } = await setup();
  const mine = await say("me", "user", "Plan the kitchen");
  await say("me", "assistant", "Done");
  const theirs = await say("teammate", "user", "And the lounge");
  assert.equal(await replaceFrom(db, ws, projectId, "me", theirs), false);
  assert.equal(await replaceFrom(db, ws, projectId, "me", mine), false);
  assert.equal(await replaceFrom(db, ws, projectId, "teammate", theirs), true);
  const list = await listMessages(db, ws, projectId, 100, { viewerId: "me" });
  assert.deepEqual(list.map((m) => [m.content, m.mine]), [["Plan the kitchen", true], ["Done", true]]);
});

test("replies are read aloud without Markdown, tables or links", () => {
  assert.equal(
    speakable("**Done.** See [the plan](https://x.y/z)\n- one\n2. two\n| a | b |\n## Next"),
    "Done. See the plan\none\ntwo\nNext"
  );
});
