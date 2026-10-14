import { test } from "node:test";
import assert from "node:assert/strict";
import { bounds, byId, connectorPoints, hits, snapBox, simplify, topAt, withAttached } from "../src/lib/whiteboard/geometry";
import * as ops from "../src/lib/whiteboard/ops";
import { boardElementSchema, elementSchema, type WbElement } from "../src/lib/whiteboard/types";
import { boardElements, placeCard, splitElements, withElements } from "../src/lib/whiteboard/board";
import { designDataSchema, type DesignBoard } from "../src/lib/design/schema";

const valid = (els: WbElement[]) => els.forEach((e) => assert.ok(elementSchema.safeParse(e).success, `${e.kind} ${JSON.stringify(elementSchema.safeParse(e).error?.issues)}`));

test("factories make valid elements of every kind", () => {
  const a = ops.sticky({ x: 0, y: 0 }, 1);
  const b = ops.shape("star", { x: 300, y: 0, w: 120, h: 120 }, 2);
  const t = ops.text({ x: 0, y: 300 }, 3, { text: "Hello" });
  const f = ops.frame({ x: -100, y: -100, w: 800, h: 600 }, 0);
  const c = ops.connector({ id: a.id, x: 0, y: 0 }, { id: b.id, x: 0, y: 0 }, 4);
  const p = ops.pen([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }], 5);
  const els = ops.syncConnectors([a, b, t, f, c, p]);
  valid(els);
  for (const e of els.filter((e) => e.kind !== "card")) assert.ok(boardElementSchema.safeParse(e).success);
});

test("connectors follow what they join, and go when it goes", () => {
  const a = ops.sticky({ x: 100, y: 100 }, 1);
  const b = ops.sticky({ x: 600, y: 100 }, 2);
  let els = ops.syncConnectors([a, b, ops.connector({ id: a.id, x: 0, y: 0 }, { id: b.id, x: 0, y: 0 }, 3, { route: "straight" })]);
  const before = connectorPoints(els[2] as Extract<WbElement, { kind: "connector" }>, byId(els));
  els = ops.move(els, [b.id], 0, 300);
  const after = connectorPoints(els[2] as Extract<WbElement, { kind: "connector" }>, byId(els));
  assert.notDeepEqual(before.at(-1), after.at(-1));
  assert.ok(after.at(-1)!.y > before.at(-1)!.y);
  valid(els);
  assert.equal(ops.remove(els, [a.id]).length, 1, "the connector goes with its sticky");
});

test("elbow connectors route square corners between side points", () => {
  const a = ops.shape("rect", { x: 0, y: 0, w: 100, h: 100 }, 1);
  const b = ops.shape("rect", { x: 400, y: 300, w: 100, h: 100 }, 2);
  const els = ops.syncConnectors([a, b, ops.connector({ id: a.id, side: "right", x: 0, y: 0 }, { id: b.id, side: "left", x: 0, y: 0 }, 3)]);
  const pts = connectorPoints(els[2] as Extract<WbElement, { kind: "connector" }>, byId(els));
  assert.deepEqual(pts[0], { x: 100, y: 50 });
  assert.deepEqual(pts.at(-1), { x: 400, y: 350 });
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, "each leg is straight across or down");
});

test("frames carry what is inside them; groups move together", () => {
  const f = ops.frame({ x: 0, y: 0, w: 1000, h: 800 }, 0);
  const inside = ops.sticky({ x: 200, y: 200 }, 1);
  const out = ops.sticky({ x: 2000, y: 200 }, 2);
  const els = [f, inside, out];
  assert.deepEqual(new Set(withAttached([f.id], els)), new Set([f.id, inside.id]));
  const grouped = ops.group(els, [inside.id, out.id]);
  assert.deepEqual(new Set(withAttached([out.id], grouped)), new Set([inside.id, out.id]));
  assert.ok(ops.ungroup(grouped, [out.id]).every((e) => !e.groupId));
});

test("hit testing picks the top element, and frames only by their edge or title", () => {
  const f = ops.frame({ x: 0, y: 0, w: 1000, h: 800 }, 0);
  const s = ops.sticky({ x: 300, y: 300 }, 1);
  const els = [f, s];
  assert.equal(topAt(els, { x: 300, y: 300 }, 4)?.id, s.id);
  assert.equal(topAt(els, { x: 700, y: 600 }, 4), null, "empty space in a frame pans or selects a box");
  assert.equal(topAt(els, { x: 20, y: -15 }, 4)?.id, f.id, "the frame's title picks it");
  assert.ok(hits(s, { x: 300, y: 300 }, 0, byId(els)));
});

test("resize scales pen strokes and text, duplicate and copies re-join connectors", () => {
  const p = ops.pen([{ x: 0, y: 0 }, { x: 100, y: 50 }], 1);
  const t = ops.text({ x: 0, y: 100 }, 2, { text: "Big" });
  const box = { x: 0, y: 0, w: 200, h: 200 };
  const grown = ops.resize([p, t], [p.id, t.id], box, { x: 0, y: 0, w: 400, h: 400 });
  const gp = grown[0] as Extract<WbElement, { kind: "pen" }>;
  assert.equal(gp.w, p.w * 2);
  assert.equal(Math.max(...gp.points), Math.max(...p.points) * 2);
  assert.ok((grown[1] as Extract<WbElement, { kind: "text" }>).fontSize > t.fontSize);
  valid(grown);

  const a = ops.sticky({ x: 0, y: 0 }, 1);
  const b = ops.sticky({ x: 500, y: 0 }, 2);
  const els = ops.syncConnectors([a, b, ops.connector({ id: a.id, x: 0, y: 0 }, { id: b.id, x: 0, y: 0 }, 3)]);
  const dup = ops.duplicate(els, els.map((e) => e.id));
  assert.equal(dup.els.length, 6);
  const copyC = dup.els.find((e) => e.kind === "connector" && dup.made.includes(e.id)) as Extract<WbElement, { kind: "connector" }>;
  assert.ok(dup.made.includes(copyC.from.id!) && dup.made.includes(copyC.to.id!), "the copied line joins the copies");
});

test("align, distribute, tidy and reorder", () => {
  const els = [ops.sticky({ x: 0, y: 0 }, 1), ops.sticky({ x: 333, y: 90 }, 2), ops.sticky({ x: 1000, y: 40 }, 3)];
  const ids = els.map((e) => e.id);
  const top = ops.align(els, ids, "top");
  assert.ok(top.every((e) => e.y === top[0].y));
  const spread = ops.distribute(els, ids, "x");
  const xs = spread.map((e) => e.x).sort((a, b) => a - b);
  assert.equal(Math.round(xs[1] - xs[0]), Math.round(xs[2] - xs[1]));
  const tidy = ops.tidy(els, ids);
  assert.equal(new Set(tidy.map((e) => e.y)).size, 1, "three stickies tidy into one row");
  const front = ops.reorder(els, [els[0].id], "front");
  assert.ok(front[0].z > Math.max(front[1].z, front[2].z));
});

test("snapping lines a box up with its neighbours and shows a guide", () => {
  const snap = snapBox({ x: 103, y: 500, w: 100, h: 100 }, [{ x: 100, y: 0, w: 100, h: 100 }], 6);
  assert.equal(snap.dx, -3);
  assert.ok(snap.guides.some((g) => g.axis === "x" && g.at === 100));
  assert.deepEqual(snapBox({ x: 150, y: 500, w: 100, h: 100 }, [{ x: 0, y: 0, w: 10, h: 10 }], 6).dx, 0);
});

test("pen strokes are smoothed down to the points that matter", () => {
  const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: i % 2 ? 0.1 : 0 }));
  assert.equal(simplify(line, 0.5).length, 2);
});

test("growFrom makes a joined sticky beside the one selected", () => {
  const a = ops.sticky({ x: 0, y: 0 }, 1, { text: "First" });
  const grown = ops.growFrom([a], a.id, "right")!;
  const made = grown.els.find((e) => e.id === grown.made)!;
  assert.equal(made.kind, "sticky");
  assert.ok(made.x > a.x + a.w);
  assert.equal((made as Extract<WbElement, { kind: "sticky" }>).text, "");
  assert.equal(grown.els.filter((e) => e.kind === "connector").length, 1);
});

test("a mood board's cards and whiteboard elements round-trip and validate", () => {
  const board: DesignBoard = {
    id: crypto.randomUUID(),
    key: "concept",
    cards: [{ id: crypto.randomUUID(), title: "Oak", body: "", tags: [], group: "", documentId: null, color: "#f6f2e8", x: 0, y: 0, width: 260 }],
  };
  const els = boardElements(board);
  assert.equal(els[0].kind, "card");
  assert.ok(els[0].h > 0, "an old card without a height gets one");
  const s = ops.sticky({ x: 400, y: 0 }, 5);
  const next = withElements(board, ops.move([...els, s], [els[0].id], -5000, 20));
  assert.equal(next.cards[0].x, -5000, "cards can sit anywhere on the endless board");
  assert.equal(next.elements?.length, 1);
  const { cards, elements } = splitElements(boardElements(next));
  assert.deepEqual(cards, next.cards);
  assert.deepEqual(elements, next.elements);
  const data = { version: 1 as const, boards: [next], items: [], currency: "ZAR", budgetCents: null, installOrder: [] };
  assert.ok(designDataSchema.safeParse(data).success, JSON.stringify(designDataSchema.safeParse(data).error?.issues));
  const clash = { ...data, boards: [{ ...next, elements: [{ ...s, id: next.cards[0].id }] }] };
  assert.equal(designDataSchema.safeParse(clash).success, false, "ids are unique across a board");
  const spot = placeCard(next);
  const placed = { x: spot.x, y: spot.y, w: 260, h: 240 };
  const clear = boardElements(next).every((e) => {
    const b = bounds(e);
    return placed.x >= b.x + b.w || placed.x + placed.w <= b.x || placed.y >= b.y + b.h || placed.y + placed.h <= b.y;
  });
  assert.ok(clear, "new cards land clear of what is there");
});

// The assistant on the board.
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { saveProviderKey, saveRoleModel } from "../src/lib/ai/settings";
import type { ChatFn, ChatRequest, ChatResult } from "../src/lib/ai/chat-stream";
import { runTurn, type StreamEvent } from "../src/lib/ai/orchestrator";
import { parseAction } from "../src/lib/ai/actions";
import { describeContext } from "../src/lib/ai/context";
import { undoBoardEdit } from "../src/lib/ai/tools/board";
import { createProject, getProject, projectDbId } from "../src/lib/projects/store";
import { getDesign } from "../src/lib/design/store";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";
import { applyBoardOps, describeBoard } from "../src/lib/whiteboard/ai";

process.env.AUTH0_SECRET ??= "test-secret-for-key-derivation-0123456789";

async function boardEnv() {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  const ws = await ensureWorkspace(db, { sub: "auth0|designer" });
  await createProject(db, ws, { id: "harbour-house", name: "Harbour House", client: "Harbour Holdings", workflowId: DEFAULT_WORKFLOW_ID, startDate: "2026-10-01T00:00:00.000Z", swatch: "sage" });
  const user = await syncUser(db, { sub: "auth0|designer", email: "designer@example.com", email_verified: true, name: "Designer" });
  await saveProviderKey(db, "openrouter", "sk-or-test-key-1234", "auth0|admin");
  await saveRoleModel(db, "orchestrator", { provider: "openrouter", model: "top/model", inputUsdPerMTok: 5, outputUsdPerMTok: 25, zarPerUsd: 18 }, "auth0|admin");
  return { db, ws, projectId: (await projectDbId(db, ws, "harbour-house"))!, userId: user.id };
}

test("board steps place, frame, join and refuse what cannot be done", () => {
  const r = applyBoardOps([], [
    { op: "add_frame", ref: "f", title: "Materials" },
    { op: "add_stickies", texts: ["Oak", "Lime plaster", "Brass"], frame: "f", color: "green", refs: ["oak", "lime", "brass"] },
    { op: "add_shape", ref: "entry", shape: "rounded", text: "Entry" },
    { op: "connect", from: "oak", to: "entry", label: "floor" },
    { op: "add_text", text: "Concept", fontSize: 48, bold: true, x: 0, y: -200 },
  ]);
  valid(r.els);
  const frame = r.els.find((e) => e.kind === "frame")!;
  const notes = r.els.filter((e) => e.kind === "sticky");
  assert.equal(notes.length, 3);
  assert.ok(notes.every((s) => s.x >= frame.x && s.x + s.w <= frame.x + frame.w && s.y + s.h <= frame.y + frame.h), "the frame holds its stickies");
  assert.ok(notes.every((s) => s.kind === "sticky" && s.color === "#b9fbc0"));
  const line = r.els.find((e) => e.kind === "connector") as Extract<WbElement, { kind: "connector" }>;
  assert.equal(line.from.id, r.made.oak);
  assert.equal(line.to.id, r.made.entry);
  assert.match(describeBoard(r.els), /frame "Materials"/);
  assert.throws(() => applyBoardOps(r.els, [{ op: "connect", from: "nope", to: r.made.oak }]), /no element \[nope\]/);
  assert.throws(() => applyBoardOps(r.els, [{ op: "add_image", documentId: crypto.randomUUID() }], { images: new Set() }), /not an image in this project/);
  const locked = applyBoardOps(r.els, [{ op: "update", id: r.made.entry, locked: true }]).els;
  assert.throws(() => applyBoardOps(locked, [{ op: "remove", ids: [r.made.entry] }]), /locked/);
});

test("the assistant draws on the open board as one step that can be undone", async () => {
  const env = await boardEnv();
  const requests: ChatRequest[] = [];
  const script: (Partial<ChatResult>)[] = [
    { toolCalls: [{ id: "b", name: "edit_board", input: { steps: [{ op: "add_frame", ref: "f", title: "Brutalist planters" }, { op: "add_stickies", texts: ["Board-formed concrete", "Olive tree"], frame: "f" }] } }] },
    { text: "Done." },
  ];
  const chat: ChatFn = async (_p, _k, req) => {
    requests.push(JSON.parse(JSON.stringify(req)));
    return { text: "", toolCalls: [], inputTokens: 100, outputTokens: 10, ...script[Math.min(requests.length - 1, script.length - 1)] };
  };
  const project = (await getProject(env.db, env.ws, "harbour-house"))!;
  const events: StreamEvent[] = [];
  await runTurn(
    { db: env.db, workspaceId: env.ws, projectId: env.projectId, userId: env.userId, project, readFile: async () => null, chat, isAdmin: true },
    { attachments: [], text: "Start a planter board here", context: { page: "board", selection: [], boardKey: "moodboard" } },
    (e) => events.push(e)
  );
  assert.ok(requests[0].tools?.some((t) => t.name === "edit_board"), "the board tools are offered");
  const shown = events.find((e) => e.type === "board") as Extract<StreamEvent, { type: "board" }>;
  assert.ok(shown, JSON.stringify(events.filter((e) => e.type === "tool")));
  assert.equal(shown.key, "moodboard");
  const saved = await getDesign(env.db, env.ws, "harbour-house");
  assert.equal(saved.revision, shown.revision);
  assert.equal(saved.data.boards.find((b) => b.key === "moodboard")?.elements?.length, 3);
  const proposal = events.flatMap((e) => (e.type === "proposal" ? [e.proposal] : []))[0];
  assert.deepEqual([proposal.status, proposal.undoable], ["applied", true]);

  const [row] = await env.db.query<{ mutation: unknown; undo: unknown }>("SELECT mutation, undo FROM ai_proposals WHERE id = $1", [proposal.id]);
  const back = await undoBoardEdit(env.db, env.ws, env.userId, "harbour-house", parseAction(row.mutation) as never, row.undo);
  assert.equal(back.board, null, "the board was empty before");
  assert.equal((await getDesign(env.db, env.ws, "harbour-house")).data.boards.length, 0);
});

test("the open board and its selection reach the assistant", () => {
  const text = describeContext({ page: "board", selection: [], boardKey: "moodboard", boardSelection: ["a1", "b2"] }, null);
  assert.match(text, /mood board "moodboard" open/);
  assert.match(text, /\[a1\], \[b2\]/);
});

test("every template is valid board content, centred where asked, and the AI can add one", async () => {
  const { template, TEMPLATES } = await import("../src/lib/whiteboard/templates");
  const { boardElementSchema } = await import("../src/lib/whiteboard/types");
  const { applyBoardOps } = await import("../src/lib/whiteboard/ai");
  for (const t of TEMPLATES) {
    const els = template(t.key, { x: 500, y: 300 }, 10, t.key === "rooms" ? ["Lounge", "Study"] : []);
    assert.ok(els.length > 2, t.key);
    for (const e of els) assert.ok(boardElementSchema.safeParse(e).success, `${t.key}: ${JSON.stringify(boardElementSchema.safeParse(e).error?.issues[0])}`);
    assert.equal(new Set(els.map((e) => e.id)).size, els.length);
  }
  const rooms = template("rooms", { x: 0, y: 0 }, 1, ["Lounge", "Study"]);
  assert.deepEqual(rooms.filter((e) => e.kind === "frame").map((e) => (e as { title: string }).title), ["Lounge", "Study"]);
  const r = applyBoardOps([], [{ op: "add_template", template: "mindmap", labels: ["Coastal lounge", "Linen", "Oak"], x: 100, y: 100 }]);
  assert.equal(r.els.filter((e) => e.kind === "connector").length, 2);
  assert.match(r.changes[0], /mind map/);
});
