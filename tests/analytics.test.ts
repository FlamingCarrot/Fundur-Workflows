import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { routeOf, usageBatchSchema } from "../src/lib/analytics/events";
import { heatmap, liveView, pruneUsage, recordEvents, trackedUser, usageOverview } from "../src/lib/analytics/store";
import {
  addResearch,
  advicePrompt,
  gatherEvidence,
  generateAdvice,
  listSuggestions,
  parseAdvice,
  setSuggestionStatus,
} from "../src/lib/analytics/advisor";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

async function setup() {
  const db = await freshDb();
  const dee = { sub: "auth0|dee", email: "dee@example.com", name: "Dee" };
  await syncUser(db, dee);
  const ws = await ensureWorkspace(db, dee);
  const admin = { sub: "auth0|andre", email: "andre1.swanepoel1@gmail.com", email_verified: true, name: "Andre" };
  await syncUser(db, admin);
  await ensureWorkspace(db, admin);
  return { db, ws };
}

const batch = (sessionId: string, events: unknown[]) => usageBatchSchema.parse({ sessionId, events });

test("pages are grouped with their ids taken out", () => {
  assert.equal(routeOf("/projects/harbour-house/phases/discovery"), "/projects/:project/phases/:phase");
  assert.equal(routeOf("/projects/new"), "/projects/new");
  assert.equal(routeOf("/projects/harbour-house/plan?x=1"), "/projects/:project/plan");
  assert.equal(routeOf("/"), "/");
  assert.equal(routeOf("/settings/tickets/"), "/settings/tickets");
  assert.equal(routeOf("/files/0b6c2f8e-4c1e-4b8a-9f0e-0a1b2c3d4e5f"), "/files/:id");
});

test("a batch is stored against the person and their workspace, and the Admin is marked", async () => {
  const { db, ws } = await setup();
  const dee = await trackedUser(db, "auth0|dee");
  assert.equal(dee.workspaceId, ws);
  assert.equal(dee.isAdmin, false);
  assert.equal((await trackedUser(db, "auth0|andre")).isAdmin, true);
  assert.equal((await trackedUser(db, "auth0|nobody")).userId, null);

  await recordEvents(db, dee, batch("sess-dee-0001", [
    { type: "page_view", path: "/projects/harbour-house", vw: 1440, vh: 900, ageMs: 2000 },
    { type: "click", path: "/projects/harbour-house", target: "Complete phase", x: 700, y: 420, vw: 1440, vh: 900, data: { sel: "main > button", ox: 0.5, oy: 0.5 } },
  ]));
  const rows = await db.query<{ route: string; device: string; user_id: string }>("SELECT route, device, user_id FROM usage_events ORDER BY id");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].route, "/projects/:project");
  assert.equal(rows[0].device, "desktop");
  assert.equal(rows[0].user_id, "auth0|dee");
});

test("oversized or malformed batches are refused", () => {
  assert.throws(() => batch("x", [{ type: "page_view", path: "/" }]));
  assert.throws(() => batch("sess-ok-0001", [{ type: "keystroke", path: "/" }]));
  assert.throws(() => batch("sess-ok-0001", Array.from({ length: 101 }, () => ({ type: "heartbeat", path: "/" }))));
  // Long labels are cut, not refused.
  assert.equal(batch("sess-ok-0001", [{ type: "click", path: "/", target: "a".repeat(1000) }]).events[0].target!.length, 300);
});

test("the live view shows who is online where, and the stream leaves out the Admin by default", async () => {
  const { db } = await setup();
  await recordEvents(db, await trackedUser(db, "auth0|dee"), batch("sess-dee-0001", [
    { type: "page_view", path: "/", vw: 390 },
    { type: "page_view", path: "/projects/harbour-house", vw: 390 },
    { type: "heartbeat", path: "/projects/harbour-house", vw: 390 },
  ]));
  await recordEvents(db, await trackedUser(db, "auth0|andre"), batch("sess-andre-001", [{ type: "page_view", path: "/settings/usage", vw: 1440 }]));

  const live = await liveView(db);
  assert.equal(live.online.length, 1);
  assert.equal(live.online[0].user?.name, "Dee");
  assert.equal(live.online[0].route, "/projects/:project");
  assert.equal(live.online[0].device, "phone");
  // Heartbeats keep someone online but are not shown as events.
  assert.deepEqual(live.events.map((e) => e.path), ["/projects/harbour-house", "/"]);

  const withAdmin = await liveView(db, { includeAdmin: true });
  assert.equal(withAdmin.online.length, 2);
  const after = await liveView(db, { afterId: live.lastId, includeAdmin: true });
  assert.equal(after.events.length, 0);
});

test("the overview counts pages, exits, angry clicks, dead clicks, errors and the funnel", async () => {
  const { db } = await setup();
  const dee = await trackedUser(db, "auth0|dee");
  await recordEvents(db, dee, batch("sess-dee-0001", [
    { type: "page_view", path: "/", vw: 1440, ageMs: 60_000 },
    { type: "page_leave", path: "/", durationMs: 20_000, data: { scroll: 0.5 }, ageMs: 40_000 },
    { type: "page_view", path: "/projects/harbour-house", vw: 1440, ageMs: 40_000 },
    { type: "click", path: "/projects/harbour-house", target: "Upload", x: 1, y: 1, vw: 1440, ageMs: 3000 },
    { type: "click", path: "/projects/harbour-house", target: "Upload", x: 1, y: 1, vw: 1440, ageMs: 2800 },
    { type: "click", path: "/projects/harbour-house", target: "Upload", x: 1, y: 1, vw: 1440, ageMs: 2600 },
    { type: "click", path: "/projects/harbour-house", target: "Phase title", x: 5, y: 5, vw: 1440, data: { dead: true } },
    { type: "action", path: "/projects/harbour-house", target: "createProject" },
    { type: "error", path: "/projects/harbour-house", target: "TypeError: x is undefined" },
  ]));

  const o = await usageOverview(db, { days: 7 });
  assert.equal(o.totals.activeUsers, 1);
  assert.equal(o.totals.sessions, 1);
  assert.equal(o.totals.pageViews, 2);
  assert.equal(o.totals.errors, 1);
  assert.ok(o.totals.avgSessionMinutes >= 0.9);
  const project = o.pages.find((p) => p.route === "/projects/:project")!;
  assert.equal(project.exits, 1);
  assert.equal(project.rageClicks, 1);
  assert.equal(project.deadClicks, 1);
  const today = o.pages.find((p) => p.route === "/")!;
  assert.equal(today.avgSeconds, 20);
  assert.equal(today.avgScroll, 0.5);
  assert.deepEqual(o.rageClicks.map((r) => r.target), ["Upload"]);
  assert.deepEqual(o.deadClicks.map((r) => r.target), ["Phase title"]);
  assert.equal(o.errors[0].message, "TypeError: x is undefined");
  assert.deepEqual(o.funnel.map((f) => f.users), [1, 1, 1, 0, 0]);
  assert.equal(o.actions[0].name, "createProject");
  assert.equal(o.devices[0].device, "desktop");
});

test("the heat map returns clicks for a page and device, its top targets and scroll reach", async () => {
  const { db } = await setup();
  const dee = await trackedUser(db, "auth0|dee");
  await recordEvents(db, dee, batch("sess-dee-0001", [
    { type: "page_view", path: "/projects/harbour-house", vw: 1440 },
    { type: "click", path: "/projects/harbour-house", target: "Brief", x: 300, y: 200, vw: 1440, data: { sel: "#brief", ox: 0.2, oy: 0.4 } },
    { type: "click", path: "/projects/harbour-house", target: "Brief", x: 310, y: 210, vw: 1440 },
    { type: "click", path: "/projects/harbour-house", target: "Menu", x: 10, y: 10, vw: 390 },
    { type: "page_leave", path: "/projects/harbour-house", vw: 1440, durationMs: 1000, data: { scroll: 0.35 } },
    { type: "click", path: "/", target: "Today", x: 10, y: 10, vw: 1440 },
  ]));
  const h = await heatmap(db, { route: "/projects/:project", device: "desktop" });
  assert.equal(h.samplePath, "/projects/harbour-house");
  assert.equal(h.points.length, 2);
  assert.ok(h.points.some((p) => p.selector === "#brief" && p.ox === 0.2));
  assert.deepEqual(h.targets.map((t) => [t.target, t.clicks]), [["Brief", 2]]);
  assert.deepEqual(h.scrollReach.slice(0, 4), [1, 1, 1, 0]);
  assert.equal(h.routes[0].route, "/projects/:project");
  // With no page named, the most-clicked page is chosen.
  assert.equal((await heatmap(db)).route, "/projects/:project");
});

test("old events are pruned", async () => {
  const { db } = await setup();
  await recordEvents(db, await trackedUser(db, "auth0|dee"), batch("sess-dee-0001", [{ type: "page_view", path: "/" }]));
  await db.query("UPDATE usage_events SET created_at = NOW() - INTERVAL '500 days'");
  await pruneUsage(db);
  assert.equal((await db.query("SELECT 1 FROM usage_events")).length, 0);
});

const ADVICE = {
  summary: "Early days. People reach projects but stall on uploads.",
  suggestions: [
    { title: "Make Upload show progress", why: "People click it repeatedly.", evidence: "3 angry clicks on Upload", impact: "high", effort: "small", area: "Documents", steps: ["Show a progress bar"], basis: ["usage"] },
    { title: "Add a sample project", why: "New people have nothing to look at.", evidence: "General knowledge of Houzz Pro onboarding", impact: "medium", effort: "medium", area: "Today", steps: ["Seed one"], basis: ["competitors"] },
  ],
};

const fakeAi = async () => ({
  text: "```json\n" + JSON.stringify(ADVICE) + "\n```",
  inputTokens: 1000,
  outputTokens: 500,
  costUsd: 0.01,
  costZar: 0.18,
  model: "test-model",
  provider: "anthropic",
  fallback: false,
});

test("advice is stored ranked; the next one rises when the first is done; a new reading replaces what was waiting", async () => {
  const { db, ws } = await setup();
  await addResearch(db, "auth0|andre", { kind: "customer", title: "Call with Dee", body: "Uploading is confusing" });
  const ev = await gatherEvidence(db, 30);
  assert.equal(ev.research[0].title, "Call with Dee");
  assert.match(advicePrompt(ev), /Call with Dee/);
  assert.match(advicePrompt(ev), /very little usage data/);

  const { run, suggestions } = await generateAdvice(db, { workspaceId: ws, userId: "auth0|andre" }, { ai: fakeAi });
  assert.equal(run.model, "test-model");
  assert.equal(suggestions[0].title, "Make Upload show progress");
  assert.equal(suggestions[0].rank, 1);

  await setSuggestionStatus(db, suggestions[0].id, "done");
  let list = await listSuggestions(db);
  assert.equal(list.active[0].title, "Add a sample project");
  assert.equal(list.finished[0].title, "Make Upload show progress");

  // Something under way survives a new reading; what was only waiting is replaced.
  await setSuggestionStatus(db, list.active[0].id, "doing");
  await generateAdvice(db, { workspaceId: ws, userId: "auth0|andre" }, { ai: fakeAi });
  list = await listSuggestions(db);
  assert.equal(list.active[0].status, "doing");
  assert.equal(list.active.length, 3);
  // The finished one is told to the AI so it is not suggested again.
  assert.match(advicePrompt(await gatherEvidence(db, 30)), /done on \d{4}-\d{2}-\d{2}: Make Upload show progress/);
});

test("advice the AI got wrong is refused rather than stored half-read", () => {
  assert.throws(() => parseAdvice("I can't help with that"), /did not answer/);
  assert.throws(() => parseAdvice('{"summary": "x", "suggestions": []}'), /missing/);
  const odd = parseAdvice(JSON.stringify({ summary: "s", suggestions: [{ title: "T", impact: "huge" }] }));
  assert.equal(odd.suggestions[0].impact, "medium");
});

test("an AI call with no project is logged against the platform", async () => {
  const { db, ws } = await setup();
  await db.query(
    `INSERT INTO ai_runs (workspace_id, project_id, user_id, task_name, model_name, provider) VALUES ($1, NULL, 'auth0|andre', 'usage_advice', 'm', 'anthropic')`,
    [ws]
  );
  assert.equal((await db.query("SELECT 1 FROM ai_runs WHERE project_id IS NULL")).length, 1);
});
