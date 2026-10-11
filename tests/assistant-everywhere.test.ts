import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { choose, effectiveRoleModels, nameTier, setAutoModels } from "../src/lib/ai/auto-models";
import { modelsForTier } from "../src/lib/ai/routing";
import { addEnabledModel, saveProviderKey, saveRoleModel, storeModelList, type EnabledModel } from "../src/lib/ai/settings";
import type { ModelOption } from "../src/lib/ai/catalog";
import { applyAction, canApplyDirectly, parseAction, undoFor } from "../src/lib/ai/actions";
import { listMessages } from "../src/lib/ai/chat-store";
import type { ChatFn, ChatRequest, ChatResult } from "../src/lib/ai/chat-stream";
import { describeContext, selectionSummary } from "../src/lib/ai/context";
import { projectAiCosts, withoutMoney } from "../src/lib/ai/costs";
import { nextSteps } from "../src/lib/ai/next-steps";
import { runTurn, type StreamEvent } from "../src/lib/ai/orchestrator";
import { applyOperations, undoPlanEdit } from "../src/lib/ai/tools/plan-edit";
import { getProject, createProject, projectDbId, listProjects } from "../src/lib/projects/store";
import { getPlanState } from "../src/lib/plan/store";
import { emptyPlan, FIRST_LEVEL_ID, wallLength } from "../src/lib/plan/geometry";
import { DEFAULT_WORKFLOW_ID, getWorkflow } from "../src/lib/workflow";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

const TOP = { provider: "openrouter" as const, model: "top/model", inputUsdPerMTok: 5, outputUsdPerMTok: 25, zarPerUsd: 18 };

async function setup() {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|designer" });
  await createProject(db, ws, {
    id: "harbour-house",
    name: "Harbour House",
    client: "Harbour Holdings",
    workflowId: DEFAULT_WORKFLOW_ID,
    startDate: "2026-10-01T00:00:00.000Z",
    swatch: "sage",
  });
  const user = await syncUser(db, { sub: "auth0|designer", email: "designer@example.com", email_verified: true, name: "Designer" });
  const projectId = (await projectDbId(db, ws, "harbour-house"))!;
  await saveProviderKey(db, "openrouter", "sk-or-test-key-1234", "auth0|admin");
  await saveRoleModel(db, "orchestrator", TOP, "auth0|admin");
  return { db, ws, projectId, userId: user.id };
}

/** A model stand-in: each turn's answer from a script, every request kept. */
function scriptedChat(script: ((req: ChatRequest) => Partial<ChatResult> & { stream?: string[] })[]) {
  const requests: ChatRequest[] = [];
  const fn: ChatFn = async (_p, _k, req, onText) => {
    requests.push(JSON.parse(JSON.stringify(req)));
    const step = script[Math.min(requests.length - 1, script.length - 1)](req);
    for (const piece of step.stream ?? []) onText?.(piece);
    return { text: (step.stream ?? []).join(""), toolCalls: [], inputTokens: 1_000, outputTokens: 100, ...step };
  };
  return { fn, requests };
}

async function turn(env: Awaited<ReturnType<typeof setup>>, chat: ChatFn, input: Partial<Parameters<typeof runTurn>[1]> & { text: string }, isAdmin = true) {
  const project = (await getProject(env.db, env.ws, "harbour-house"))!;
  const events: StreamEvent[] = [];
  await runTurn(
    { db: env.db, workspaceId: env.ws, projectId: env.projectId, userId: env.userId, project, readFile: async () => null, chat, isAdmin },
    { attachments: [], ...input },
    (e) => events.push(e)
  );
  return events;
}

const enabled = (provider: EnabledModel["provider"], model: string, input: number, output: number, addedAt = "2026-01-01T00:00:00Z"): EnabledModel => ({
  provider,
  model,
  name: model,
  inputUsdPerMTok: input,
  outputUsdPerMTok: output,
  contextLength: null,
  addedAt,
});

test("model names sort into flagship, standard and small", () => {
  assert.equal(nameTier("anthropic/claude-opus-5-5"), 3);
  assert.equal(nameTier("claude-fable-5-1"), 3);
  assert.equal(nameTier("google/gemini-2.5-pro"), 3);
  assert.equal(nameTier("anthropic/claude-sonnet-5-5"), 2);
  assert.equal(nameTier("claude-haiku-4-5"), 1);
  assert.equal(nameTier("openai/gpt-5-mini"), 1);
});

test("the automatic choice: most capable on top, cheapest capable as worker, fallbacks from another provider", () => {
  const picks = choose([
    { enabled: enabled("anthropic", "claude-opus-5-5", 5, 25) },
    { enabled: enabled("anthropic", "claude-sonnet-5-5", 3, 15) },
    { enabled: enabled("anthropic", "claude-haiku-4-5", 1, 5) },
    { enabled: enabled("openrouter", "google/gemini-2.5-pro", 1.25, 10) },
    { enabled: enabled("openrouter", "openai/gpt-5-nano", 0.05, 0.4) },
    // Cannot call tools, so never picked.
    { enabled: enabled("openrouter", "acme/ultra-text", 50, 50), option: { id: "acme/ultra-text", name: "Ultra", features: ["reasoning"] } as ModelOption },
  ]);
  const by = Object.fromEntries(picks.map((p) => [p.role, p.model]));
  assert.equal(by.orchestrator, "claude-opus-5-5");
  // The fallback is the next best from another provider, so one outage does not stop both.
  assert.equal(by.orchestrator_fallback, "google/gemini-2.5-pro");
  // The worker is the cheapest model that is not one of the small ones (nano and haiku are passed over).
  assert.equal(by.worker, "google/gemini-2.5-pro");
  assert.ok(by.worker_fallback && by.worker_fallback !== by.worker);
  assert.ok(picks.every((p) => p.reason.length > 10));
});

test("models are picked from the shortlist automatically unless the Admin turns it off", async () => {
  const { db } = await setup();
  // Nothing on the shortlist: the roles the Admin set are used.
  assert.equal((await modelsForTier(db, "top"))[0].model, "top/model");

  const list: ModelOption[] = [
    { id: "acme/opus-x", name: "Acme Opus X", inputUsdPerMTok: 5, outputUsdPerMTok: 25, features: ["tools", "reasoning"] },
    { id: "acme/sonnet-x", name: "Acme Sonnet X", inputUsdPerMTok: 3, outputUsdPerMTok: 15, features: ["tools"] },
  ];
  await storeModelList(db, "openrouter", list);
  for (const m of list) await addEnabledModel(db, "openrouter", m, "auth0|admin");
  let effective = await effectiveRoleModels(db);
  assert.equal(effective.auto, true);
  assert.equal(effective.roles.orchestrator?.model, "acme/opus-x");
  assert.equal(effective.roles.worker?.model, "acme/sonnet-x");
  assert.equal((await modelsForTier(db, "top"))[0].model, "acme/opus-x");
  assert.equal((await modelsForTier(db, "worker"))[0].model, "acme/sonnet-x");

  await setAutoModels(db, false, "auth0|admin");
  effective = await effectiveRoleModels(db);
  assert.equal(effective.auto, false);
  assert.equal(effective.roles.orchestrator?.model, "top/model");
});

test("small changes apply at once with an undo; deleting waits for her", async () => {
  const env = await setup();
  const project = (await getProject(env.db, env.ws, "harbour-house"))!;
  const step = getWorkflow(project).phases[0].checklist[0];
  const chat = scriptedChat([
    () => ({
      toolCalls: [
        { id: "a", name: "add_task", input: { title: "Call the landlord", due: "2026-10-09" } },
        { id: "b", name: "set_step_done", input: { itemId: step.id } },
      ],
    }),
    () => ({ stream: ["Done both."] }),
  ]);
  const events = await turn(env, chat.fn, { text: "Add a task and tick the first step" });
  const after = (await getProject(env.db, env.ws, "harbour-house"))!;
  assert.equal(after.tasks.find((t) => !t.stepItemId)?.title, "Call the landlord");
  assert.equal(after.checks[step.id], true);
  assert.ok(events.some((e) => e.type === "project"));
  const proposals = events.flatMap((e) => (e.type === "proposal" ? [e.proposal] : []));
  assert.deepEqual(proposals.map((p) => [p.status, p.direct, p.undoable]), [["applied", true, true], ["applied", true, true]]);

  // Undo puts each back.
  const rows = await env.db.query<{ undo: unknown }>("SELECT undo FROM ai_proposals ORDER BY created_at");
  for (const r of rows.reverse()) await applyAction(env.db, env.ws, "harbour-house", parseAction(r.undo)!);
  const undone = (await getProject(env.db, env.ws, "harbour-house"))!;
  assert.equal(undone.tasks.filter((t) => !t.stepItemId).length, 0);
  assert.equal(!!undone.checks[step.id], false);

  // Deleting a task never applies by itself.
  const task = { type: "addTask" as const, id: crypto.randomUUID(), phaseKey: project.currentPhase, title: "Keep me" };
  await applyAction(env.db, env.ws, "harbour-house", task);
  const del = scriptedChat([() => ({ toolCalls: [{ id: "d", name: "delete_task", input: { taskId: task.id } }] }), () => ({ stream: ["Waiting for you."] })]);
  const delEvents = await turn(env, del.fn, { text: "Delete it" });
  assert.equal((await getProject(env.db, env.ws, "harbour-house"))!.tasks.some((t) => t.id === task.id), true);
  assert.equal(delEvents.flatMap((e) => (e.type === "proposal" ? [e.proposal.status] : []))[0], "pending");
});

test("bulk moves need confirming, a few changes do not", async () => {
  const { db, ws } = await setup();
  const project = (await getProject(db, ws, "harbour-house"))!;
  const move = { type: "setPhaseStart" as const, phaseKey: getWorkflow(project).phases[1].key, start: "2026-12-01" };
  assert.ok(canApplyDirectly(project, move));
  assert.ok(canApplyDirectly(project, { type: "batch", mutations: [move, move] }));
  assert.equal(canApplyDirectly(project, { type: "batch", mutations: Array(6).fill(move) }), false);
  assert.equal(canApplyDirectly(project, { type: "completePhase", phaseKey: project.currentPhase }), false);
  // Moving a phase back to where it started puts the later ones back too.
  const undo = undoFor(project, move)!;
  await applyAction(db, ws, "harbour-house", move);
  await applyAction(db, ws, "harbour-house", undo);
  const { phaseSpans } = await import("../src/lib/studio/timeline");
  assert.deepEqual(phaseSpans((await getProject(db, ws, "harbour-house"))!).map((s) => s.start), phaseSpans(project).map((s) => s.start));
});

test("the assistant draws on the plan live, saved as one step that can be undone", async () => {
  const env = await setup();
  const chat = scriptedChat([
    () => ({
      toolCalls: [
        {
          id: "p",
          name: "edit_plan",
          input: {
            operations: [
              { op: "box", corner: { x: 0, y: 0 }, width: 6000, depth: 4000, name: "Studio", ref: "studio" },
              { op: "opening", wallId: "studio.bottom", kind: "door", at: 1000 },
              { op: "item", type: "desk", at: { x: 3000, y: 2000 }, ref: "desk" },
              { op: "copy", target: { kind: "item", id: "desk" }, offset: { x: 0, y: 1000 } },
            ],
          },
        },
      ],
    }),
    () => ({ stream: ["Drawn."] }),
  ]);
  const events = await turn(env, chat.fn, { text: "Draw a 6 by 4 studio with a door and two desks", context: { page: "plan", selection: [] } });
  const planEvent = events.find((e) => e.type === "plan") as Extract<StreamEvent, { type: "plan" }>;
  assert.ok(planEvent);
  const state = (await getPlanState(env.db, env.ws, "harbour-house"))!;
  assert.equal(state.revision, planEvent.revision);
  assert.equal(state.plan!.walls.length, 4);
  assert.equal(state.plan!.openings.length, 1);
  assert.equal(state.plan!.items.length, 2);
  assert.equal(state.plan!.rooms[0].name, "Studio");
  assert.ok(state.corrections.some((c) => c.summary.startsWith("Fundur:")));
  const proposal = events.flatMap((e) => (e.type === "proposal" ? [e.proposal] : []))[0];
  assert.deepEqual([proposal.kind, proposal.status, proposal.undoable], ["planEdit", "applied", true]);
  const done = events.at(-1) as Extract<StreamEvent, { type: "done" }>;
  assert.ok(done.suggestions.includes("Check the plan for problems"));

  // Undo puts the plan back as it was (empty), as a new saved revision.
  const [row] = await env.db.query<{ mutation: unknown; undo: unknown }>("SELECT mutation, undo FROM ai_proposals WHERE id = $1", [proposal.id]);
  const back = await undoPlanEdit(env.db, env.ws, env.userId, "harbour-house", parseAction(row.mutation) as never, row.undo);
  assert.equal(back.plan.walls.length, 0);
  assert.equal((await getPlanState(env.db, env.ws, "harbour-house"))!.revision, planEvent.revision + 1);
});

test("plan operations are all or nothing, and refs name what was made", () => {
  const start = emptyPlan();
  const okResult = applyOperations(start, FIRST_LEVEL_ID, [
    { op: "wall", from: { x: 0, y: 0 }, to: { x: 5000, y: 0 }, ref: "w" },
    { op: "opening", wallId: "w", kind: "window", width: 1200 },
    { op: "set_wall", wallId: "w", length: 4000 },
  ]);
  assert.ok(okResult.ok);
  if (okResult.ok) {
    assert.equal(wallLength(okResult.plan.walls[0]), 4000);
    assert.equal(okResult.made.w, okResult.plan.walls[0].id);
  }
  const bad = applyOperations(start, FIRST_LEVEL_ID, [
    { op: "wall", from: { x: 0, y: 0 }, to: { x: 5000, y: 0 } },
    { op: "item", type: "spaceship", at: { x: 0, y: 0 } },
  ]);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.error, /Operation 2 \(item\) failed: There is no furniture type "spaceship"/);
});

test("what she selected goes with her message, so 'this' means it", async () => {
  const env = await setup();
  const drawn = applyOperations(emptyPlan(), FIRST_LEVEL_ID, [
    { op: "item", type: "desk", at: { x: 1000, y: 1000 }, ref: "a" },
    { op: "item", type: "desk", at: { x: 3000, y: 1000 }, ref: "b" },
  ]);
  assert.ok(drawn.ok);
  if (!drawn.ok) return;
  const { savePlan } = await import("../src/lib/plan/store");
  await savePlan(env.db, env.ws, env.userId, "harbour-house", { plan: drawn.plan, baseRevision: null, changes: ["Two desks"] });
  const selection = [
    { kind: "item" as const, id: drawn.made.a },
    { kind: "item" as const, id: drawn.made.b },
  ];
  assert.equal(selectionSummary(drawn.plan, selection), "Desk, Desk");
  assert.match(describeContext({ page: "plan", levelId: FIRST_LEVEL_ID, selection }, drawn.plan), /these 2[\s\S]*\[item /);

  const chat = scriptedChat([() => ({ stream: ["Those are two desks."] })]);
  await turn(env, chat.fn, { text: "What are these?", context: { page: "plan", levelId: FIRST_LEVEL_ID, selection } });
  const sent = chat.requests[0].messages.at(-1) as { content: string };
  assert.match(sent.content, /<context>[\s\S]*She has selected these 2[\s\S]*<\/context>\s*What are these\?/);
  const [mine] = await listMessages(env.db, env.ws, env.projectId);
  assert.deepEqual(mine.events, [{ type: "context", text: "Desk, Desk" }]);
});

test("usage shows in tokens; the Admin also sees money, each call and the tools run", async () => {
  const env = await setup();
  const chat = scriptedChat([() => ({ toolCalls: [{ id: "r", name: "read_project", input: {} }] }), () => ({ stream: ["Here it is."] })]);
  const events = await turn(env, chat.fn, { text: "Read the project" }, false);
  const done = events.at(-1) as Extract<StreamEvent, { type: "done" }>;
  assert.equal(done.costZar, 0);
  assert.deepEqual(done.tokens, { input: 2_000, output: 200 });

  const asDesigner = await listMessages(env.db, env.ws, env.projectId);
  assert.equal(asDesigner[1].costZar, 0);
  assert.equal(asDesigner[1].breakdown, undefined);
  assert.deepEqual(asDesigner[1].tokens, { input: 2_000, output: 200 });

  const asAdmin = await listMessages(env.db, env.ws, env.projectId, 100, { isAdmin: true });
  assert.ok(asAdmin[1].costZar > 0);
  assert.equal(asAdmin[1].breakdown!.runs.length, 2);
  assert.equal(asAdmin[1].breakdown!.runs[0].model, "top/model");
  assert.deepEqual(asAdmin[1].breakdown!.tools.map((t) => t.name), ["read_project"]);

  const costs = await projectAiCosts(env.db, env.ws, env.projectId, { phase: (k) => k, task: (t) => t });
  assert.equal(costs.totalTokens, 2_200);
  assert.deepEqual(costs.byTool.map((t) => [t.key, t.calls]), [["read_project", 1]]);
  const hidden = withoutMoney(costs);
  assert.equal(hidden.totalZar, 0);
  assert.ok(hidden.byPhase.every((l) => l.zar === 0 && l.tokens > 0));
});

test("next steps follow the page, the selection and the project", async () => {
  const { db, ws } = await setup();
  const project = (await getProject(db, ws, "harbour-house"))!;
  const onEmptyPlan = nextSteps(project, null, { page: "plan", selection: [] });
  assert.match(onEmptyPlan[0], /Draw an 8 × 6 m office shell/);
  assert.ok(onEmptyPlan.length <= 4);

  const drawn = applyOperations(emptyPlan(), FIRST_LEVEL_ID, [{ op: "item", type: "desk", at: { x: 0, y: 0 }, ref: "d" }]);
  if (!drawn.ok) throw new Error(drawn.error);
  const selected = nextSteps(project, drawn.plan, { page: "plan", levelId: FIRST_LEVEL_ID, selection: [{ kind: "item", id: drawn.made.d }] });
  assert.match(selected[0], /Make 3 copies of Desk/);

  const overview = nextSteps(project, null, { page: "project", selection: [] }, {}, "2030-01-01");
  assert.ok(overview.some((s) => /overdue task/.test(s)));
});

test("a project the assistant starts waits for her, then opens as its own", async () => {
  const env = await setup();
  const chat = scriptedChat([
    () => ({ toolCalls: [{ id: "c", name: "create_project", input: { name: "Dune Road Offices", client: "Dune Co" } }] }),
    () => ({ stream: ["Ready for you to confirm."] }),
  ]);
  const events = await turn(env, chat.fn, { text: "Start a project for Dune Co" });
  const proposal = events.flatMap((e) => (e.type === "proposal" ? [e.proposal] : []))[0];
  assert.deepEqual([proposal.kind, proposal.status], ["createProject", "pending"]);
  assert.equal((await listProjects(env.db, env.ws)).length, 1);
  const [row] = await env.db.query<{ mutation: unknown }>("SELECT mutation FROM ai_proposals WHERE id = $1", [proposal.id]);
  const created = await applyAction(env.db, env.ws, "harbour-house", parseAction(row.mutation)!);
  assert.equal(created.name, "Dune Road Offices");
  assert.equal((await listProjects(env.db, env.ws)).length, 2);
});
