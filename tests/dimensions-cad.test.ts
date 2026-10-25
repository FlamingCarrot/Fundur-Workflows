import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, FIRST_LEVEL_ID, type EditResult, type Plan } from "../src/lib/plan/geometry";
import { addDraft, chainDimensions, describeDraft, dimensionLabel, dimensionParts, dimensionValue, drafts, linearKind, transformDraft, type Draft } from "../src/lib/plan/drafting";
import { applyDraftOps } from "../src/lib/ai/tools/drafting";
import { planSchema } from "../src/lib/plan/schema";
import { exportDxf } from "../src/lib/plan/dxf";

const L = FIRST_LEVEL_ID;
const P = (x: number, y: number) => ({ x, y });
const near = (a: number, b: number, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const ok = (r: EditResult) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as Extract<EditResult, { ok: true }>;
};
const dim = (d: Omit<Draft, "id" | "levelId" | "shape">): Draft => ({ id: "d", levelId: L, shape: "dimension", ...d });

test("linear, aligned, angular, radius and diameter dimensions measure right", () => {
  const h = dim({ dim: "horizontal", points: [P(0, 0), P(1200, 500), P(600, -400)] });
  assert.equal(dimensionValue(h), 1200);
  assert.equal(dimensionLabel(h), "1200");
  const parts = dimensionParts(h);
  const line = parts.lines[parts.lines.length - 1];
  near(line[0].y, -400);
  near(line[1].y, -400);
  assert.equal(parts.ticks.length, 2);
  near(dimensionValue(dim({ dim: "vertical", points: [P(0, 0), P(1200, 500), P(-300, 0)] })), 500, 1e-6);
  near(dimensionValue(dim({ dim: "aligned", points: [P(0, 0), P(3000, 4000), P(0, 100)] })), 5000);
  const ang = dim({ dim: "angular", points: [P(0, 0), P(1000, 0), P(0, 1000), P(500, 500)] });
  near(dimensionValue(ang), 90, 0.01);
  assert.equal(dimensionLabel(ang), "90°");
  // Placed on the other side, it measures the outside angle.
  near(dimensionValue(dim({ dim: "angular", points: [P(0, 0), P(1000, 0), P(0, 1000), P(-500, -500)] })), 270, 0.01);
  assert.equal(dimensionLabel(dim({ dim: "radius", points: [P(0, 0), P(600, 0)] })), "R600");
  assert.equal(dimensionLabel(dim({ dim: "diameter", points: [P(0, 0), P(0, 600)], text: "<> TYP" })), "Ø1200 TYP");
  assert.equal(linearKind(P(0, 0), P(1000, 200), P(500, 900)), "horizontal");
  assert.equal(linearKind(P(0, 0), P(1000, 200), P(1600, 100)), "vertical");
});

test("dimensions go on the plan, turn with it, pass the server's check and export", () => {
  let plan: Plan = emptyPlan();
  const r = ok(addDraft(plan, { levelId: L, shape: "dimension", dim: "horizontal", points: [P(0, 0), P(2000, 0), P(1000, 500)] }));
  plan = r.plan;
  assert.match(describeDraft(drafts(plan)[0]), /Horizontal dimension, 2000 mm/);
  assert.equal(addDraft(plan, { levelId: L, shape: "dimension", dim: "horizontal", points: [P(0, 0), P(0, 2000), P(1000, 500)] }).ok, false);
  assert.equal(addDraft(plan, { levelId: L, shape: "dimension", dim: "radius", points: [P(0, 0)] }).ok, false);
  // A quarter turn: it still measures 2000, now up the page.
  const turned = transformDraft(drafts(plan)[0], (p) => ({ x: -p.y, y: p.x }));
  near(dimensionValue(turned), 2000);
  near(turned.rotation!, 90);
  assert.ok(planSchema.safeParse(plan).success);
  const chain = ok(chainDimensions(plan, { levelId: L, points: [P(0, 0), P(900, 0), P(900, 0), P(2400, 50), P(3000, 0)], at: P(0, -600) }));
  assert.equal(chain.created!.length, 3);
  assert.match(chain.summary, /3 horizontal dimensions/);
  const dxf = exportDxf(chain.plan);
  assert.match(dxf, /\n1500\r?\n|\r\n1500\r\n/);
});

test("the assistant draws dimensions", () => {
  const r = applyDraftOps(emptyPlan(), L, [
    { op: "circle", centre: P(0, 0), radius: 450, ref: "c" },
    { op: "dimension", kind: "diameter", draftId: "c", at: P(1000, 1000) },
    { op: "dimension", kind: "linear", from: P(0, 0), to: P(3000, 0), at: P(1500, -800), layer: "Annotation" },
    { op: "dimension", kind: "angular", vertex: P(0, 0), from: P(1000, 0), to: P(1000, 1000), at: P(800, 300) },
    { op: "dimension_chain", points: [P(0, 2000), P(1000, 2000), P(2500, 2000)], at: P(0, 2600) },
  ]);
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  const all = drafts(r.plan).filter((d) => d.shape === "dimension");
  assert.deepEqual(all.map(dimensionLabel), ["Ø900", "3000", "45°", "1000", "1500"]);
  assert.equal(all[1].layer, "annotation");
});
