import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { eventsSince, latestEventId, publishEvent, pruneEvents, shouldPrune } from "../src/lib/realtime/channel";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

async function setup() {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|a", email: "a@example.com" });
  const other = await ensureWorkspace(db, { sub: "auth0|b", email: "b@example.com" });
  return { db, ws, other };
}

test("a stream reads the events published after it opened, in order and once", async () => {
  const { db, ws } = await setup();
  await publishEvent(db, { workspaceId: ws, projectId: "harbour", type: "TASK_TOGGLED", data: { taskId: "old", done: true } });

  // A fresh stream starts from what is already there, so it never replays old changes.
  const start = await latestEventId(db, ws, "harbour");
  assert.deepEqual((await eventsSince(db, ws, "harbour", start)).events, []);

  await publishEvent(db, { workspaceId: ws, projectId: "harbour", type: "TASK_TOGGLED", phaseKey: "discovery", origin: "tab-1", data: { taskId: "t1", done: true } });
  await publishEvent(db, { workspaceId: ws, projectId: "harbour", type: "WAITING_ON_TOGGLED", data: "client" });

  const first = await eventsSince(db, ws, "harbour", start);
  assert.deepEqual(first.events.map((e) => e.type), ["TASK_TOGGLED", "WAITING_ON_TOGGLED"]);
  assert.equal(first.events[0].phaseKey, "discovery");
  assert.equal(first.events[0].origin, "tab-1");
  assert.deepEqual(first.events[0].data, { taskId: "t1", done: true });
  assert.equal(first.events[1].data, "client");

  // Looking again from where it got to returns nothing twice.
  assert.deepEqual((await eventsSince(db, ws, "harbour", first.cursor)).events, []);
});

test("a stream hears only its own workspace and project", async () => {
  const { db, ws, other } = await setup();
  const start = await latestEventId(db, ws, "harbour");
  await publishEvent(db, { workspaceId: other, projectId: "harbour", type: "TASK_TOGGLED", data: { taskId: "theirs", done: true } });
  await publishEvent(db, { workspaceId: ws, projectId: "kloof", type: "TASK_TOGGLED", data: { taskId: "elsewhere", done: true } });
  await publishEvent(db, { workspaceId: ws, projectId: "harbour", type: "TASK_TOGGLED", data: { taskId: "mine", done: true } });

  const { events } = await eventsSince(db, ws, "harbour", start);
  assert.deepEqual(events.map((e) => (e.data as { taskId: string }).taskId), ["mine"]);
});

test("events past their life are cleared, and the rest stay readable", async () => {
  const { db, ws } = await setup();
  const start = await latestEventId(db, ws, "harbour");
  await publishEvent(db, { workspaceId: ws, projectId: "harbour", type: "TASK_TOGGLED", data: { taskId: "stale", done: true } });
  await db.query("UPDATE realtime_events SET created_at = NOW() - INTERVAL '1 hour'");
  await publishEvent(db, { workspaceId: ws, projectId: "harbour", type: "TASK_TOGGLED", data: { taskId: "fresh", done: true } });

  await pruneEvents(db);
  const { events } = await eventsSince(db, ws, "harbour", start);
  assert.deepEqual(events.map((e) => (e.data as { taskId: string }).taskId), ["fresh"]);

  // Tidying up happens on a small share of publishes, not on every one.
  assert.equal(shouldPrune(0.01), true);
  assert.equal(shouldPrune(0.5), false);
});
