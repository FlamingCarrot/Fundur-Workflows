import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, FIRST_LEVEL_ID, type EditResult, type Plan } from "../src/lib/plan/geometry";
import { addDraft, drafts, setDrawingLayer, type Draft } from "../src/lib/plan/drafting";
import { divideAlong, drawOrder, matchProperties, removeDuplicates, similarDrafts } from "../src/lib/plan/draft-tools";
import { applyDraftOps } from "../src/lib/ai/tools/drafting";
import { parseCommand } from "../src/lib/plan/command";

const L = FIRST_LEVEL_ID;
const ok = (r: EditResult) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as Extract<EditResult, { ok: true }>;
};
const P = (x: number, y: number) => ({ x, y });
function draw(plan: Plan, d: Omit<Draft, "id" | "levelId">): { plan: Plan; id: string } {
  const r = ok(addDraft(plan, { ...d, levelId: L }));
  return { plan: r.plan, id: r.id! };
}

test("match properties, draw order and select similar", () => {
  let plan = ok(setDrawingLayer(emptyPlan(), { name: "Joinery" })).plan;
  const src = draw(plan, { shape: "polyline", points: [P(0, 0), P(1000, 0), P(1000, 1000)], closed: true, layer: "joinery", color: "#aa0000", linetype: "dashed", fill: { pattern: "tiles", scale: 600, angle: 0 } });
  plan = src.plan;
  const box = draw(plan, { shape: "polyline", points: [P(2000, 0), P(3000, 0), P(3000, 1000)], closed: true, weight: 0.5 });
  plan = box.plan;
  const line = draw(plan, { shape: "line", points: [P(0, 2000), P(1000, 2000)] });
  plan = line.plan;
  const m = ok(matchProperties(plan, src.id, [box.id, line.id]));
  const [, b2, l2] = drafts(m.plan);
  assert.equal(b2.layer, "joinery");
  assert.equal(b2.color, "#aa0000");
  assert.equal(b2.weight, undefined);
  assert.equal(b2.fill?.pattern, "tiles");
  assert.equal(l2.linetype, "dashed");
  assert.equal(l2.fill, undefined);
  // Draw order.
  const back = ok(drawOrder(plan, [line.id], "back"));
  assert.equal(drafts(back.plan)[0].id, line.id);
  assert.equal(drafts(ok(drawOrder(back.plan, [line.id], "front")).plan).at(-1)!.id, line.id);
  // Similar: the two closed shapes once on one layer.
  assert.deepEqual(similarDrafts(m.plan, src.id).sort(), [src.id, box.id].sort());
});

test("remove duplicates clears shapes drawn twice and lines lying on longer ones", () => {
  let plan = emptyPlan();
  plan = draw(plan, { shape: "line", points: [P(0, 0), P(3000, 0)] }).plan;
  plan = draw(plan, { shape: "line", points: [P(3000, 0), P(0, 0)] }).plan;
  plan = draw(plan, { shape: "line", points: [P(1000, 0), P(2000, 0)] }).plan;
  plan = draw(plan, { shape: "circle", points: [P(500, 500)], radius: 100 }).plan;
  plan = draw(plan, { shape: "circle", points: [P(500, 500)], radius: 100 }).plan;
  plan = draw(plan, { shape: "line", points: [P(1000, 0), P(2000, 0)], color: "#ff0000" }).plan;
  const r = ok(removeDuplicates(plan, L));
  assert.equal(drafts(r.plan).length, 3);
  assert.match(r.summary, /3 duplicate shapes removed/);
  assert.equal(ok(removeDuplicates(r.plan, L)).summary, "");
});

test("divide and measure place points or items along a shape", () => {
  const line = draw(emptyPlan(), { shape: "line", points: [P(0, 0), P(4000, 0)] });
  const d = ok(divideAlong(line.plan, line.id, { count: 4 }));
  assert.deepEqual(drafts(d.plan).slice(1).map((x) => x.points[0].x), [1000, 2000, 3000]);
  const m = ok(divideAlong(line.plan, line.id, { every: 1500 }, { item: "chair", align: true }));
  assert.deepEqual(m.plan.items.map((i) => i.at.x), [1500, 3000]);
  const circle = draw(emptyPlan(), { shape: "circle", points: [P(0, 0)], radius: 1000 });
  const round = ok(divideAlong(circle.plan, circle.id, { count: 6 }, { item: "chair", align: true }));
  assert.equal(round.plan.items.length, 6);
  assert.equal(round.plan.items[0].rotation, 90);
  assert.equal(divideAlong(line.plan, line.id, { count: 1 }).ok, false);
});

test("the assistant matches, orders, cleans and divides, and MA picks Match", () => {
  const line = draw(emptyPlan(), { shape: "line", points: [P(0, 0), P(4000, 0)], color: "#00aa00" });
  const other = draw(line.plan, { shape: "line", points: [P(0, 1000), P(4000, 1000)] });
  const out = applyDraftOps(other.plan, L, [
    { op: "match", from: line.id, draftIds: [other.id] },
    { op: "draw_order", draftIds: [line.id], to: "front" },
    { op: "divide", draftId: line.id, count: 2 },
    { op: "remove_duplicates" },
  ]);
  assert.ok(out.ok, out.ok ? "" : out.error);
  if (out.ok) {
    assert.equal(drafts(out.plan).find((x) => x.id === other.id)!.color, "#00aa00");
    assert.equal(drafts(out.plan).length, 3);
  }
  assert.deepEqual(parseCommand("ma"), { kind: "tool", tool: "match" });
});

test("revision clouds, splines and construction lines", async () => {
  const { revisionCloud, splineThrough, constructionLine, CONSTRUCTION_REACH } = await import("../src/lib/plan/draft-tools");
  const { draftArea, isClosed } = await import("../src/lib/plan/drafting");
  const square = [P(0, 0), P(3000, 0), P(3000, 3000), P(0, 3000)];
  const cloud = revisionCloud(square, 300)!;
  assert.equal(cloud.points.length, 40);
  // Bulging outwards: more area than the square it rings, either way round.
  const area = (c: typeof cloud) => draftArea({ id: "c", levelId: L, ...c } as Draft) / 1e6;
  assert.ok(area(cloud) > 9 && isClosed({ id: "c", levelId: L, ...cloud } as Draft));
  assert.ok(area(revisionCloud([...square].reverse(), 300)!) > 9);
  // A spline passes through its points.
  const pts = [P(0, 0), P(1000, 1000), P(2000, 0), P(3000, 1000)];
  const curve = splineThrough(pts);
  for (const p of pts) assert.ok(curve.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1), `misses ${p.x},${p.y}`);
  assert.ok(curve.length > 30);
  const [a, b] = constructionLine(P(0, 0), P(0, 10))!;
  assert.deepEqual([a, b], [P(0, -CONSTRUCTION_REACH), P(0, CONSTRUCTION_REACH)]);
  // Through the assistant: the construction line goes on its own layer.
  const out = applyDraftOps(emptyPlan(), L, [
    { op: "revision_cloud", from: P(0, 0), to: P(2000, 1000) },
    { op: "spline", points: pts },
    { op: "construction_line", through: P(0, 0), towards: P(1, 1) },
  ]);
  assert.ok(out.ok, out.ok ? "" : out.error);
  if (out.ok) {
    const lineDraft = drafts(out.plan).find((d) => d.shape === "line")!;
    assert.equal(out.plan.drawingLayers?.find((l) => l.id === lineDraft.layer)?.name, "Construction lines");
  }
});
