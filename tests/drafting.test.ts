import { test } from "node:test";
import assert from "node:assert/strict";
import { addRoom, emptyPlan, FIRST_LEVEL_ID, removeItem, type EditResult, type Plan } from "../src/lib/plan/geometry";
import {
  addDraft,
  arcThrough,
  bulgeThrough,
  draftArea,
  draftLength,
  draftName,
  draftProblem,
  drawingLayers,
  removeDrawingLayer,
  setDrawingLayer,
  snapPointsOf,
  transformDraft,
  updateDraft,
  type Draft,
} from "../src/lib/plan/drafting";
import { copyOut, inBox, mirrorMany, moveMany, pasteIn, rotateMany } from "../src/lib/plan/selection";
import { planSchema } from "../src/lib/plan/schema";
import { snapPoint } from "../src/lib/plan/snaps";
import { exportDxf } from "../src/lib/plan/dxf";
import { hideThese, visiblePart } from "../src/lib/plan/hide";
import { applyDraftOps } from "../src/lib/ai/tools/drafting";

const L = FIRST_LEVEL_ID;
const ok = (r: EditResult) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as Extract<EditResult, { ok: true }>;
};
const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

test("every kind of shape goes on the plan, measures right and passes the server's check", () => {
  let plan = emptyPlan();
  const shapes: Omit<Draft, "id">[] = [
    { levelId: L, shape: "line", points: [{ x: 0, y: 0 }, { x: 3000, y: 4000 }] },
    { levelId: L, shape: "polyline", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 0, y: 1000 }], closed: true, fill: { pattern: "tiles", scale: 600, angle: 0 } },
    { levelId: L, shape: "circle", points: [{ x: 5000, y: 0 }], radius: 500 },
    { levelId: L, shape: "arc", points: [{ x: 0, y: 0 }], radius: 1000, start: 0, end: 90 },
    { levelId: L, shape: "ellipse", points: [{ x: 0, y: 0 }], radius: 600, radius2: 300, rotation: 30 },
    { levelId: L, shape: "text", points: [{ x: 100, y: 100 }], text: "Joinery by others", height: 150 },
    { levelId: L, shape: "leader", points: [{ x: 0, y: 0 }, { x: 500, y: 500 }, { x: 900, y: 500 }], text: "Oak veneer" },
  ];
  const ids: string[] = [];
  for (const s of shapes) {
    const r = ok(addDraft(plan, s));
    plan = r.plan;
    ids.push(r.id!);
  }
  const d = (i: number) => plan.drafts!.find((x) => x.id === ids[i])!;
  near(draftLength(d(0)), 5000);
  near(draftArea(d(1)), 2_000_000);
  assert.equal(draftName(d(1)), "Hatch");
  near(draftArea(d(2)), Math.PI * 250_000);
  near(draftLength(d(3)), (Math.PI / 2) * 1000);
  near(draftArea(d(4)), Math.PI * 600 * 300);
  assert.ok(planSchema.safeParse(plan).success, JSON.stringify(planSchema.safeParse(plan).error?.issues.slice(0, 2)));
  // Bad shapes are refused with a reason.
  assert.match(draftProblem(plan, { id: "x", levelId: L, shape: "line", points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] })!, /two different ends/);
  assert.match(draftProblem(plan, { id: "x", levelId: L, shape: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], fill: { pattern: "solid", scale: 100, angle: 0 } })!, /closed shapes/);
  assert.match(draftProblem(plan, { id: "x", levelId: L, shape: "circle", points: [{ x: 0, y: 0 }], layer: "nope" })!, /no drawing layer/);
  // Removing one.
  plan = ok(removeItem(plan, { kind: "draft", id: ids[0] })).plan;
  assert.equal(plan.drafts!.length, shapes.length - 1);
});

test("a polyline's arc segments: bulges, areas and arcs through three points", () => {
  // A half circle on a 2000 mm chord bulging below it.
  const b = bulgeThrough({ x: 0, y: 0 }, { x: 1000, y: -1000 }, { x: 2000, y: 0 });
  near(b, 1, 1e-6);
  const d: Draft = { id: "p", levelId: L, shape: "polyline", points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], bulges: [b, 0], closed: true };
  near(draftArea(d), (Math.PI * 1000 * 1000) / 2, 1);
  const arc = arcThrough({ x: 1000, y: 0 }, { x: 0, y: 1000 }, { x: -1000, y: 0 })!;
  near(arc.radius, 1000);
  near(arc.start, 0);
  near(arc.end, 180);
  // The other way round still runs anticlockwise, over the top.
  const back = arcThrough({ x: -1000, y: 0 }, { x: 0, y: 1000 }, { x: 1000, y: 0 })!;
  near(back.start, 0);
  near(back.end, 180);
});

test("moving, turning, mirroring, copying and box-selecting take drawn shapes along", () => {
  let plan = emptyPlan();
  plan = ok(addDraft(plan, { levelId: L, shape: "arc", points: [{ x: 0, y: 0 }], radius: 1000, start: 0, end: 90 })).plan;
  const arcId = plan.drafts![0].id;
  plan = ok(addDraft(plan, { levelId: L, shape: "text", points: [{ x: 2000, y: 0 }], text: "Note" })).plan;
  const textId = plan.drafts![1].id;
  const sel = [{ kind: "draft" as const, id: arcId }, { kind: "draft" as const, id: textId }];
  const moved = ok(moveMany(plan, sel, { x: 100, y: 200 })).plan;
  assert.deepEqual(moved.drafts![0].points[0], { x: 100, y: 200 });
  // Mirrored left to right: the arc now runs from 90° to 180°, and the text still reads left to right.
  const mirrored = ok(mirrorMany(plan, sel, "left-right")).plan;
  const arc = mirrored.drafts!.find((d) => d.id === arcId)!;
  near(arc.start!, 90);
  near(arc.end!, 180);
  assert.equal(mirrored.drafts!.find((d) => d.id === textId)!.rotation ?? 0, 0);
  const turned = ok(rotateMany(plan, [{ kind: "draft", id: arcId }], 90, { x: 0, y: 0 })).plan;
  near(turned.drafts![0].start!, 90);
  const copy = ok(pasteIn(plan, copyOut(plan, sel), L, { x: 0, y: 5000 }));
  assert.equal(copy.plan.drafts!.length, 4);
  assert.equal(copy.created!.filter((t) => t.kind === "draft").length, 2);
  const boxed = inBox(plan, L, { minX: -10, minY: -10, maxX: 1010, maxY: 1010 }, false);
  assert.deepEqual(boxed.map((t) => t.id), [arcId]);
  // Hidden for now, then gone from what is drawn.
  assert.equal(visiblePart(plan, hideThese(null, "hide", [{ kind: "draft", id: arcId }]))!.drafts!.length, 1);
  // Mirrored bulges bend the other way.
  const bent: Draft = { id: "b", levelId: L, shape: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], bulges: [0.5] };
  assert.equal(transformDraft(bent, (p) => ({ x: -p.x, y: p.y })).bulges![0], -0.5);
});

test("drawing layers: add, restyle, hide, lock and remove, with shapes moving to Drafting", () => {
  let plan = emptyPlan();
  const added = ok(setDrawingLayer(plan, { name: "Lighting", color: "#c08a00", linetype: "dashed" }));
  plan = added.plan;
  assert.equal(drawingLayers(plan).length, 9);
  plan = ok(addDraft(plan, { levelId: L, shape: "circle", points: [{ x: 0, y: 0 }], radius: 80, layer: added.id! })).plan;
  assert.match(ok(setDrawingLayer(plan, { id: added.id!, hidden: true })).summary, /hidden/);
  assert.match(setDrawingLayer(plan, { id: added.id!, name: "joinery" }).ok ? "" : "dup", /dup/);
  const removed = ok(removeDrawingLayer(plan, added.id!));
  assert.equal(removed.plan.drafts![0].layer, undefined);
  assert.match(removed.summary, /1 shape moved to Drafting/);
  assert.equal(removeDrawingLayer(plan, "drafting").ok, false);
});

test("clicks snap to a drawn shape's ends, middles, centres and quadrants", () => {
  let plan = emptyPlan();
  plan = ok(addDraft(plan, { levelId: L, shape: "circle", points: [{ x: 1000, y: 1000 }], radius: 500 })).plan;
  plan = ok(addDraft(plan, { levelId: L, shape: "line", points: [{ x: 0, y: 0 }, { x: 600, y: 0 }] })).plan;
  assert.equal(snapPointsOf(plan.drafts![0]).filter((s) => s.kind === "quadrant").length, 4);
  assert.deepEqual(snapPoint(plan, { x: 1495, y: 1003 }, 20), { point: { x: 1500, y: 1000 }, kind: "quadrant" });
  assert.deepEqual(snapPoint(plan, { x: 298, y: 4 }, 20), { point: { x: 300, y: 0 }, kind: "middle" });
  assert.deepEqual(snapPoint(plan, { x: 598, y: 4 }, 20), { point: { x: 600, y: 0 }, kind: "end" });
  // A hidden layer is not snapped to.
  plan = ok(setDrawingLayer(plan, { id: "drafting", hidden: true })).plan;
  assert.equal(snapPoint(plan, { x: 598, y: 4 }, 20), null);
});

test("DXF keeps drawn shapes on their layers, with line types", () => {
  let plan = emptyPlan();
  plan = ok(addDraft(plan, { levelId: L, shape: "polyline", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }], bulges: [0, 0.4] })).plan;
  plan = ok(addDraft(plan, { levelId: L, shape: "arc", points: [{ x: 0, y: 0 }], radius: 300, start: 10, end: 80, layer: "ceiling" })).plan;
  plan = ok(addDraft(plan, { levelId: L, shape: "text", points: [{ x: 0, y: 0 }], text: "Two\nlines", linetype: "hidden" })).plan;
  const dxf = exportDxf(plan);
  assert.match(dxf, /LTYPE[\s\S]*DASHED/);
  assert.match(dxf, /\r\n {2}2\r\nCEILING\r\n/);
  assert.match(dxf, /\r\n 42\r\n0\.4\r\n/);
  assert.match(dxf, /ARC\r\n {2}8\r\nCEILING/);
  assert.equal((dxf.match(/\r\nTEXT\r\n/g) ?? []).length, 2);
});

test("the assistant drafts with shapes, layers and hatches, all or nothing", () => {
  let plan = emptyPlan();
  plan = ok(addRoom(plan, [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }], "Kitchen")).plan;
  const roomId = plan.rooms[0].id;
  const r = applyDraftOps(plan, L, [
    { op: "rectangle", corner: { x: 0, y: 2400 }, width: 3000, depth: 600, layer: "Joinery", ref: "bench" },
    { op: "line", from: { x: 0, y: 2100 }, to: { x: 3000, y: 2100 }, layer: "Bulkhead lines", linetype: "dashed" },
    { op: "circle", centre: { x: 2000, y: 1500 }, radius: 75, layer: "Lighting" },
    { op: "arc", from: { x: 0, y: 0 }, through: { x: 700, y: 300 }, to: { x: 1000, y: 1000 } },
    { op: "polygon", centre: { x: 1000, y: 1000 }, radius: 300, sides: 6 },
    { op: "text", at: { x: 100, y: 2500 }, text: "Bench, 600 deep" },
    { op: "leader", points: [{ x: 1500, y: 2700 }, { x: 2000, y: 3300 }], text: "Quartz top" },
    { op: "hatch", target: roomId, pattern: "herringbone", scale: 300 },
    { op: "hatch", target: "bench", pattern: "solid" },
    { op: "set", draftId: "bench", color: "#884422", weight: 0.5 },
    { op: "layer", name: "Lighting", color: "#d4a000", locked: true },
  ]);
  assert.ok(r.ok, r.ok ? "" : r.error);
  const p = r.plan;
  assert.equal(p.drafts!.length, 8);
  const bench = p.drafts!.find((d) => d.id === r.made.bench)!;
  assert.equal(bench.fill!.pattern, "solid");
  assert.equal(bench.color, "#884422");
  assert.ok(drawingLayers(p).some((l) => l.name === "Bulkhead lines"));
  assert.ok(drawingLayers(p).find((l) => l.name === "Lighting")!.locked);
  const floor = p.drafts!.find((d) => d.fill?.pattern === "herringbone")!;
  assert.equal(floor.layer, "hatch");
  assert.ok(r.changes.some((c) => /Hatch, 12.00 m² drawn/.test(c)));
  assert.ok(planSchema.safeParse(p).success);
  // One bad operation changes nothing.
  const bad = applyDraftOps(plan, L, [{ op: "line", from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }, { op: "hatch", target: "nothing", pattern: "solid" }]);
  assert.ok(!bad.ok && /Operation 2 \(hatch\)/.test(bad.error));
  // set takes a colour back to the layer's.
  const back = ok(updateDraft(p, bench.id, { color: null }));
  assert.equal(back.plan.drafts!.find((d) => d.id === bench.id)!.color, undefined);
});

export type { Plan };
