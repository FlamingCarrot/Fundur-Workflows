import { test } from "node:test";
import assert from "node:assert/strict";
import { addWall, emptyPlan, FIRST_LEVEL_ID, type EditResult, type Plan } from "../src/lib/plan/geometry";
import { addDraft, draftArea, draftLength, drafts, segmentsOf, type Draft } from "../src/lib/plan/drafting";
import { breakDraft, explodeDraft, extendDraft, filletCorners, filletLines, joinDrafts, offsetDraft, trimDraft } from "../src/lib/plan/draft-modify";
import { polarArrayMany, scaleMany } from "../src/lib/plan/selection";
import { planSchema } from "../src/lib/plan/schema";

const L = FIRST_LEVEL_ID;
const ok = (r: EditResult) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as Extract<EditResult, { ok: true }>;
};
const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const P = (x: number, y: number) => ({ x, y });

function draw(plan: Plan, d: Omit<Draft, "id" | "levelId">): { plan: Plan; id: string } {
  const r = ok(addDraft(plan, { ...d, levelId: L }));
  return { plan: r.plan, id: r.id! };
}
const get = (plan: Plan, id: string) => drafts(plan).find((d) => d.id === id)!;

test("trim cuts a line back to the shapes crossing it, and a circle into an arc", () => {
  let plan = emptyPlan();
  const line = draw(plan, { shape: "line", points: [P(0, 0), P(3000, 0)] });
  plan = line.plan;
  plan = draw(plan, { shape: "line", points: [P(1000, -500), P(1000, 500)] }).plan;
  plan = draw(plan, { shape: "line", points: [P(2000, -500), P(2000, 500)] }).plan;
  // Trimming the middle leaves two pieces either side.
  const mid = ok(trimDraft(plan, line.id, P(1500, 10)));
  const lines = drafts(mid.plan).filter((d) => d.points[0].y === 0 && d.points[1].y === 0);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((d) => Math.round(draftLength(d))).sort(), [1000, 1000]);
  // Trimming an end takes it back to the first crossing.
  const end = ok(trimDraft(plan, line.id, P(2800, 0)));
  near(draftLength(get(end.plan, line.id)), 2000);
  // Nothing crossing: refuse.
  const lone = draw(emptyPlan(), { shape: "line", points: [P(0, 0), P(100, 0)] });
  assert.equal(trimDraft(lone.plan, lone.id, P(50, 0)).ok, false);
  // A circle crossed by a line loses the part picked.
  let c = draw(emptyPlan(), { shape: "circle", points: [P(0, 0)], radius: 1000 });
  const circleId = c.id;
  c = draw(c.plan, { shape: "line", points: [P(-2000, 0), P(2000, 0)] });
  const half = ok(trimDraft(c.plan, circleId, P(0, 1000)));
  const arc = get(half.plan, circleId);
  assert.equal(arc.shape, "arc");
  near(arc.start!, 180);
  near(arc.end!, 0);
  near(draftLength(arc), Math.PI * 1000, 1);
  assert.ok(planSchema.safeParse(half.plan).success);
});

test("trim stops at wall faces too", () => {
  let plan = ok(addWall(emptyPlan(), P(1000, -1000), P(1000, 1000), 100, L, "wall")).plan;
  const line = draw(plan, { shape: "line", points: [P(0, 0), P(2000, 0)] });
  plan = ok(trimDraft(line.plan, line.id, P(1800, 0))).plan;
  // The near face is crossed on the way, so it stops at the far face, as CAD does.
  near(draftLength(get(plan, line.id)), 1050);
});

test("extend runs a line on to the next shape or wall, and an arc round its circle", () => {
  let plan = draw(emptyPlan(), { shape: "line", points: [P(2000, -500), P(2000, 500)] }).plan;
  const line = draw(plan, { shape: "line", points: [P(0, 0), P(1000, 0)] });
  const r = ok(extendDraft(line.plan, line.id, P(900, 0)));
  near(get(r.plan, line.id).points[1].x, 2000);
  assert.match(r.summary, /extended 1.000 mm/);
  // The start end, picked near it, has nothing ahead.
  assert.equal(extendDraft(line.plan, line.id, P(100, 0)).ok, false);
  // An arc from 0° to 90° of radius 1000 runs on to a line at x = -1000 ... it meets y-axis line x = -500 at 120°.
  plan = draw(emptyPlan(), { shape: "line", points: [P(-500, 0), P(-500, 2000)] }).plan;
  const arc = draw(plan, { shape: "arc", points: [P(0, 0)], radius: 1000, start: 0, end: 90 });
  const e = ok(extendDraft(arc.plan, arc.id, P(0, 1000)));
  near(get(e.plan, arc.id).end!, 120, 0.2);
});

test("offset copies lines, circles and polylines the picked side", () => {
  const line = draw(emptyPlan(), { shape: "line", points: [P(0, 0), P(1000, 0)] });
  const up = ok(offsetDraft(line.plan, line.id, 200, P(500, 50)));
  const copy = get(up.plan, up.id!);
  near(copy.points[0].y, 200);
  near(copy.points[1].y, 200);
  const down = ok(offsetDraft(line.plan, line.id, 200, P(500, -50)));
  near(get(down.plan, down.id!).points[0].y, -200);

  const c = draw(emptyPlan(), { shape: "circle", points: [P(0, 0)], radius: 500 });
  const ring = ok(offsetDraft(c.plan, c.id, 100, P(0, 900)));
  near(get(ring.plan, ring.id!).radius!, 600);
  assert.equal(offsetDraft(c.plan, c.id, 600, P(0, 10)).ok, false);

  // A hatched 2 x 1 m box offset 100 outwards is 2.2 x 1.2 m, unhatched, corners kept sharp.
  const box = draw(emptyPlan(), { shape: "polyline", points: [P(0, 0), P(2000, 0), P(2000, 1000), P(0, 1000)], closed: true, fill: { pattern: "tiles", scale: 600, angle: 0 } });
  const out = ok(offsetDraft(box.plan, box.id, 100, P(3000, 500)));
  const big = get(out.plan, out.id!);
  near(draftArea(big) / 1e6, 2.2 * 1.2, 0.001);
  assert.equal(big.points.length, 4);
  assert.equal(big.fill, undefined);
  const ins = ok(offsetDraft(box.plan, box.id, 100, P(1000, 500)));
  const inner = get(ins.plan, ins.id!);
  near(draftArea(inner) / 1e6, 1.8 * 0.8, 0.001);
});

test("fillet and chamfer two lines, and round a polyline's corners", () => {
  let plan = emptyPlan();
  const a = draw(plan, { shape: "line", points: [P(0, 0), P(1200, 0)] });
  const b = draw(a.plan, { shape: "line", points: [P(1000, -300), P(1000, 1000)] });
  plan = b.plan;
  // Keep the left of a and the top of b: an L with a 200 mm round corner.
  const f = ok(filletLines(plan, a.id, P(200, 0), b.id, P(1000, 800), { radius: 200 }));
  near(get(f.plan, a.id).points[1].x, 800);
  near(get(f.plan, b.id).points[1].y, 200);
  const arc = get(f.plan, f.id!);
  assert.equal(arc.shape, "arc");
  near(arc.radius!, 200);
  near(arc.points[0].x, 800);
  near(arc.points[0].y, 200);
  near(draftLength(arc), (Math.PI / 2) * 200, 1);
  // Radius 0 meets them at a sharp corner.
  const sharp = ok(filletLines(plan, a.id, P(200, 0), b.id, P(1000, 800), { radius: 0 }));
  near(get(sharp.plan, a.id).points[1].x, 1000);
  near(get(sharp.plan, b.id).points[1].y, 0);
  assert.equal(drafts(sharp.plan).length, 2);
  // A chamfer joins them with a straight line.
  const ch = ok(filletLines(plan, a.id, P(200, 0), b.id, P(1000, 800), { chamfer: [100, 300] }));
  const joint = get(ch.plan, ch.id!);
  assert.equal(joint.shape, "line");
  near(draftLength(joint), Math.hypot(100, 300));
  // Too big for the lines.
  assert.equal(filletLines(plan, a.id, P(200, 0), b.id, P(1000, 800), { radius: 5000 }).ok, false);

  // Every corner of a 2 x 1 m box rounded at 100 mm.
  const box = draw(emptyPlan(), { shape: "polyline", points: [P(0, 0), P(2000, 0), P(2000, 1000), P(0, 1000)], closed: true });
  const round = ok(filletCorners(box.plan, box.id, { radius: 100 }));
  const rb = get(round.plan, box.id);
  assert.equal(rb.points.length, 8);
  near(draftArea(rb), 2000 * 1000 - (4 - Math.PI) * 100 * 100, 5);
  assert.ok(segmentsOf(rb).filter((s) => s.t === "arc").length === 4);
  // One corner chamfered.
  const one = ok(filletCorners(box.plan, box.id, { chamfer: [200, 200] }, 2));
  near(draftArea(get(one.plan, box.id)), 2000 * 1000 - 200 * 200 / 2, 1);
  assert.ok(planSchema.safeParse(round.plan).success);
});

test("break, join and explode", () => {
  const line = draw(emptyPlan(), { shape: "line", points: [P(0, 0), P(3000, 0)] });
  const two = ok(breakDraft(line.plan, line.id, P(1000, 0)));
  assert.equal(drafts(two.plan).length, 2);
  const gap = ok(breakDraft(line.plan, line.id, P(1000, 0), P(1500, 0)));
  assert.deepEqual(drafts(gap.plan).map((d) => Math.round(draftLength(d))), [1000, 1500]);
  // Join the two halves back with an arc on the end into one polyline.
  let plan = two.plan;
  const arc = draw(plan, { shape: "arc", points: [P(3000, 500)], radius: 500, start: 270, end: 90 });
  plan = arc.plan;
  const joined = ok(joinDrafts(plan, drafts(plan).map((d) => d.id)));
  const poly = drafts(joined.plan);
  assert.equal(poly.length, 1);
  assert.equal(poly[0].shape, "polyline");
  near(draftLength(poly[0]), 3000 + Math.PI * 500, 1);
  // Explode it back into lines and an arc.
  const ex = ok(explodeDraft(joined.plan, poly[0].id));
  assert.deepEqual(drafts(ex.plan).map((d) => d.shape).sort(), ["arc", "line", "line"]);
  // A closed box breaks open at a point, keeping its length.
  const box = draw(emptyPlan(), { shape: "polyline", points: [P(0, 0), P(2000, 0), P(2000, 1000), P(0, 1000)], closed: true });
  const open = get(ok(breakDraft(box.plan, box.id, P(1000, 0))).plan, box.id);
  assert.equal(open.closed, undefined);
  near(draftLength(open), 6000);
  assert.equal(explodeDraft(line.plan, line.id).ok, false);
});

test("polar array and scale", () => {
  const chair = draw(emptyPlan(), { shape: "polyline", points: [P(900, -200), P(1300, -200), P(1300, 200), P(900, 200)], closed: true });
  const r = ok(polarArrayMany(chair.plan, [{ kind: "draft", id: chair.id }], 6, P(0, 0)));
  assert.equal(drafts(r.plan).length, 6);
  assert.match(r.summary, /6 times round a centre, 60° apart/);
  const third = get(r.plan, r.created![1].id);
  // The second copy is 120° round.
  const cx = third.points.reduce((s, p) => s + p.x, 0) / 4;
  const cy = third.points.reduce((s, p) => s + p.y, 0) / 4;
  near(Math.atan2(cy, cx) * (180 / Math.PI), 120, 0.2);
  const big = ok(scaleMany(chair.plan, [{ kind: "draft", id: chair.id }], 2, P(900, -200)));
  near(draftArea(get(big.plan, chair.id)), 4 * 400 * 400, 1);
  assert.equal(scaleMany(chair.plan, [], 2).ok, false);
});

test("the assistant's modify operations", async () => {
  const { applyDraftOps } = await import("../src/lib/ai/tools/drafting");
  const r = applyDraftOps(emptyPlan(), L, [
    { op: "line", from: P(0, 0), to: P(1200, 0), ref: "a" },
    { op: "line", from: P(1000, -300), to: P(1000, 1000), ref: "b" },
    { op: "fillet", draftId: "a", at: P(200, 0), otherId: "b", otherAt: P(1000, 800), radius: 200 },
    { op: "offset", draftId: "a", distance: 600, side: P(100, 100), ref: "c" },
    { op: "extend", draftId: "c", end: P(700, 600) },
    { op: "rectangle", corner: P(3000, 0), to: P(4000, 1000), ref: "box" },
    { op: "fillet", draftId: "box", at: P(3000, 0), radius: 100, allCorners: true },
    { op: "polar_array", draftIds: ["box"], count: 4, centre: P(0, 0) },
  ]);
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(drafts(r.plan).length, 5 + 3);
  // The offset line ran on to the upright line at x = 1000.
  near(drafts(r.plan).find((d) => d.id === r.made.c)!.points[1].x, 1000);
  const bad = applyDraftOps(emptyPlan(), L, [{ op: "trim", draftId: "nope", at: P(0, 0) }]);
  assert.equal(bad.ok, false);
});

test("intersection, perpendicular and tangent snaps", async () => {
  const { snapPoint } = await import("../src/lib/plan/snaps");
  let plan = draw(emptyPlan(), { shape: "line", points: [P(0, 0), P(2000, 0)] }).plan;
  plan = draw(plan, { shape: "line", points: [P(1000, -1000), P(1000, 1000)] }).plan;
  plan = draw(plan, { shape: "circle", points: [P(5000, 0)], radius: 500 }).plan;
  const x = snapPoint(plan, P(1020, 15), 50);
  assert.equal(x?.kind, "intersection");
  near(x!.point.x, 1000);
  near(x!.point.y, 0);
  // From a point above the long line, the foot of the perpendicular.
  const perp = snapPoint(plan, P(1520, 20), 50, [], undefined, P(1500, 800));
  assert.equal(perp?.kind, "perpendicular");
  near(perp!.point.x, 1500);
  near(perp!.point.y, 0);
  // From (5000, 1000), the tangents to the circle touch it at y = 250.
  const tan = snapPoint(plan, P(5440, 260), 60, [], undefined, P(5000, 1000));
  assert.equal(tan?.kind, "tangent");
  near(tan!.point.y, 250);
  near(tan!.point.x, 5000 + Math.sqrt(500 * 500 - 250 * 250));
});
