import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, FIRST_LEVEL_ID, type Plan } from "../src/lib/plan/geometry";
import { gapBetween, measure } from "../src/lib/plan/measure";

const plan = (): Plan => ({
  ...emptyPlan(),
  walls: [{ id: "w1", levelId: FIRST_LEVEL_ID, a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 100, kind: "wall" }],
  items: [
    { id: "desk", levelId: FIRST_LEVEL_ID, type: "desk", at: { x: 1000, y: 1000 }, width: 1600, depth: 800, height: 750, rotation: 0 },
    { id: "chair", levelId: FIRST_LEVEL_ID, type: "chair", at: { x: 1000, y: 1900 }, width: 500, depth: 500, height: 900, rotation: 0 },
    { id: "turned", levelId: FIRST_LEVEL_ID, type: "chair", at: { x: 3000, y: 1000 }, width: 600, depth: 600, height: 900, rotation: 45 },
  ],
});

test("the clear gap between two things is measured between their outlines", () => {
  const m = measure(plan(), { kind: "item", id: "desk" }, { kind: "item", id: "chair" });
  assert.ok(typeof m !== "string");
  assert.equal(m.gap, 250); // desk front at y 1400, chair back at y 1650
  assert.equal(m.centres, 900);
  const wall = measure(plan(), { kind: "wall", id: "w1" }, { kind: "item", id: "desk" });
  assert.ok(typeof wall !== "string");
  assert.equal(wall.gap, 550); // wall face at y 50, desk back at y 600
  // A turned item: its corner comes nearest.
  const turned = measure(plan(), { kind: "item", id: "desk" }, { kind: "item", id: "turned" });
  assert.ok(typeof turned !== "string");
  assert.equal(turned.gap, Math.round((3000 - 300 * Math.SQRT2 - 1800) * 10) / 10);
});

test("touching, overlapping and points", () => {
  assert.equal(gapBetween([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [{ x: 5, y: 5 }]).gap, 0);
  const p = measure(plan(), { x: 1000, y: 3000 }, { kind: "item", id: "chair" });
  assert.ok(typeof p !== "string");
  assert.equal(p.gap, 850);
  assert.match(String(measure(plan(), { kind: "item", id: "nope" }, { x: 0, y: 0 })), /no item nope/);
});
