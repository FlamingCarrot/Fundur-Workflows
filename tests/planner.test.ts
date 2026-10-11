import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { applyPlannerOp, columnFor, emptyPlanner, PlannerError, todoRef, type PlannerOp, type PlannerState } from "../src/lib/planner/state";
import { changePlanner, getPlanner } from "../src/lib/planner/store";
import { addWorkDays, dayIn, isWorkDay, onOrNextWorkDay, workWeekInput, zonedTime, type WorkWeek } from "../src/lib/planner/workweek";
import { availableSlots, bookingLinkInput } from "../src/lib/planner/booking";
import { buildIcs } from "../src/lib/planner/ics";
import { book, BookingError, cancelBooking, createLink, feedOwner, listBookings, publicLink, removeFeed, resetFeed, setLinkActive } from "../src/lib/planner/booking-store";

const NOW = "2026-10-07T08:00:00.000Z";
const run = (state: PlannerState, ...ops: PlannerOp[]) => ops.reduce((s, op) => applyPlannerOp(s, op, NOW), state);

test("to-dos land on the main list or a list of their own, and go with their list", () => {
  let s = run(emptyPlanner(), { type: "addList", id: "site", name: "Site visits" });
  s = run(s, { type: "addTodo", id: "a", title: "Call the plasterer" }, { type: "addTodo", id: "b", title: "Measure lounge", listId: "site", due: "2026-10-09" });
  assert.equal(s.todos.find((t) => t.id === "a")?.listId, null);
  assert.equal(s.todos.find((t) => t.id === "b")?.due, "2026-10-09");
  s = run(s, { type: "removeList", id: "site" });
  assert.deepEqual(s.todos.map((t) => t.id), ["a"]);
  assert.throws(() => run(s, { type: "addTodo", id: "c", title: "x", listId: "gone" }), PlannerError);
});

test("moving a to-do card into a done column ticks it, and out again reopens it", () => {
  let s = run(emptyPlanner(), { type: "addTodo", id: "a", title: "Order samples" });
  const ref = todoRef("a");
  assert.equal(columnFor(s, ref, false).id, "todo");
  s = run(s, { type: "placeCard", ref, columnId: "done", index: 0, shown: [] });
  assert.equal(s.todos[0].done, true);
  assert.equal(columnFor(s, ref, true).id, "done");
  s = run(s, { type: "placeCard", ref, columnId: "doing", index: 0, shown: [] });
  assert.equal(s.todos[0].done, false);
  assert.equal(columnFor(s, ref, false).id, "doing");
});

test("columns can be added, renamed, reordered and removed, never the last one", () => {
  let s = run(emptyPlanner(), { type: "addColumn", id: "review", name: "Client review" }, { type: "moveColumn", id: "review", index: 1 });
  assert.deepEqual(s.columns.map((c) => c.id), ["todo", "review", "doing", "done"]);
  s = run(s, { type: "updateColumn", id: "review", name: "With client" });
  assert.equal(s.columns[1].name, "With client");
  s = run(s, { type: "removeColumn", id: "review" }, { type: "removeColumn", id: "doing" }, { type: "removeColumn", id: "done" });
  assert.throws(() => run(s, { type: "removeColumn", id: "todo" }), PlannerError);
});

test("working days: steps roll forward off weekends, and the week must make sense", () => {
  assert.equal(isWorkDay("2026-10-10"), false); // Saturday
  assert.equal(onOrNextWorkDay("2026-10-10"), "2026-10-12");
  assert.equal(onOrNextWorkDay("2026-10-10", [6]), "2026-10-10");
  assert.equal(addWorkDays("2026-10-09", 1), "2026-10-12");
  assert.equal(workWeekInput.safeParse({ days: [1], start: "17:00", end: "08:00", timeZone: "Africa/Johannesburg" }).success, false);
  assert.equal(workWeekInput.safeParse({ days: [1], start: "08:00", end: "17:00", timeZone: "Mars/Olympus" }).success, false);
  assert.equal(zonedTime("2026-10-07", 9 * 60, "Africa/Johannesburg").toISOString(), "2026-10-07T07:00:00.000Z");
  assert.equal(zonedTime("2026-07-07", 9 * 60, "America/New_York").toISOString(), "2026-07-07T13:00:00.000Z");
  assert.equal(dayIn(new Date("2026-10-07T23:30:00Z"), "Africa/Johannesburg"), "2026-10-08");
});

const WEEK: WorkWeek = { days: [1, 2, 3, 4, 5], start: "09:00", end: "11:00", timeZone: "Africa/Johannesburg" };

test("booking slots sit inside working hours on working days, after the notice, around busy times", () => {
  const slots = availableSlots({
    workWeek: WEEK,
    fromDate: "2026-10-07",
    toDate: "2026-10-12",
    durationMinutes: 60,
    busy: [{ start: new Date("2026-10-08T07:30:00Z"), end: new Date("2026-10-08T08:00:00Z") }],
    now: new Date("2026-10-07T05:00:00Z"), // 07:00 there; two hours' notice leaves 09:00
  });
  assert.deepEqual(slots.map((s) => s.toISOString()), [
    "2026-10-07T07:00:00.000Z",
    "2026-10-07T08:00:00.000Z",
    "2026-10-08T08:00:00.000Z", // 09:00 is busy until 10:00 there
    "2026-10-09T07:00:00.000Z",
    "2026-10-09T08:00:00.000Z",
    "2026-10-12T07:00:00.000Z", // the weekend is skipped
    "2026-10-12T08:00:00.000Z",
  ]);
  assert.equal(bookingLinkInput.safeParse({ title: "Intro", durationMinutes: 30, fromDate: "2026-10-09", toDate: "2026-10-08" }).success, false);
  assert.equal(bookingLinkInput.safeParse({ title: "Intro", durationMinutes: 31, fromDate: "2026-10-08", toDate: "2026-10-09" }).success, false);
});

test("the calendar feed is valid iCalendar with escaped, folded lines", () => {
  const ics = buildIcs("Dee's work", [
    { uid: "a@fundur", title: "Measure, then quote; check", day: "2026-10-09", done: true },
    { uid: "b@fundur", title: "Intro call", start: new Date("2026-10-08T07:00:00Z"), end: new Date("2026-10-08T07:30:00Z"), description: "x".repeat(200) },
  ], new Date(NOW));
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /DTSTART;VALUE=DATE:20261009\r\nDTEND;VALUE=DATE:20261010/);
  assert.ok(ics.includes(String.raw`SUMMARY:✓ Measure\, then quote\; check` + "\r\n"));
  assert.match(ics, /DTSTART:20261008T070000Z/);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

async function setup() {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  const who = { sub: "auth0|dee", email: "dee@example.com", name: "Dee" };
  const user = await syncUser(db, who);
  const ws = await ensureWorkspace(db, who);
  return { db, ws, userId: user.id };
}

test("the planner is saved per person and refuses a bad change whole", async () => {
  const { db, ws, userId } = await setup();
  assert.equal((await getPlanner(db, ws, userId)).revision, 0);
  const saved = await changePlanner(db, ws, userId, [{ type: "addTodo", id: "a", title: "Order samples" }]);
  assert.equal(saved.revision, 1);
  await assert.rejects(changePlanner(db, ws, userId, [{ type: "addTodo", id: "b", title: "x" }, { type: "updateTodo", id: "nope", done: true }]), PlannerError);
  const after = await getPlanner(db, ws, userId);
  assert.deepEqual(after.state.todos.map((t) => t.id), ["a"]);
});

test("a feed token opens only its owner's feed, and resetting or turning off retires it", async () => {
  const { db, ws, userId } = await setup();
  const first = await resetFeed(db, ws, userId);
  assert.deepEqual(await feedOwner(db, first), { workspaceId: ws, userId });
  const second = await resetFeed(db, ws, userId);
  assert.equal(await feedOwner(db, first), null);
  await removeFeed(db, ws, userId);
  assert.equal(await feedOwner(db, second), null);
  assert.equal(await feedOwner(db, "short"), null);
});

test("a client books an offered time once; a taken, closed or cancelled time behaves as it should", async () => {
  const { db, ws, userId } = await setup();
  await changePlanner(db, ws, userId, [{ type: "setWorkWeek", workWeek: WEEK }]);
  const link = await createLink(db, ws, userId, { title: "Intro", durationMinutes: 60, fromDate: "2026-10-08", toDate: "2026-10-08" });
  const now = new Date("2026-10-07T08:00:00Z");
  const offer = await publicLink(db, link.token, now);
  assert.equal(offer.owner, "Dee");
  assert.deepEqual(offer.slots, ["2026-10-08T07:00:00.000Z", "2026-10-08T08:00:00.000Z"]);

  const client = { start: offer.slots[0], name: "Pat", email: "pat@example.com" };
  const booked = await book(db, link.token, client, now);
  assert.equal(booked.title, "Intro with Pat");
  await assert.rejects(book(db, link.token, client, now), (e: unknown) => e instanceof BookingError && e.status === 409);
  await assert.rejects(book(db, link.token, { ...client, start: "2026-10-08T07:30:00Z" }, now), BookingError);
  assert.deepEqual((await publicLink(db, link.token, now)).slots, ["2026-10-08T08:00:00.000Z"]);

  await cancelBooking(db, ws, userId, booked.id);
  assert.equal((await listBookings(db, ws, userId, new Date("2026-10-01"), new Date("2026-10-30"))).length, 0);
  assert.equal((await publicLink(db, link.token, now)).slots.length, 2);

  await setLinkActive(db, ws, userId, link.id, false);
  await assert.rejects(publicLink(db, link.token, now), (e: unknown) => e instanceof BookingError && e.status === 404);
});
