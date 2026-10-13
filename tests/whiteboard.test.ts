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
