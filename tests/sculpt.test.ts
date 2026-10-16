import { test } from "node:test";
import assert from "node:assert/strict";
import { blankBlueprint, editPoints } from "../src/lib/blueprints/edit";
import { meshPoints, sculptStroke, toMesh, type SculptBrush } from "../src/lib/blueprints/mesh";
import { partSchema } from "../src/lib/blueprints/schema";
import "../src/lib/ai/tools/library";
import { getTool } from "../src/lib/ai/tools/registry";

test("sculpt dabs preserve topology, leave vertices outside the brush unchanged and produce valid geometry", () => {
  const bp = blankBlueprint("Sculpt");
  const part = toMesh(bp.parts[0]);
  assert.ok(typeof part !== "string");
  const before = meshPoints(part);
  for (const brush of ["inflate", "deflate", "smooth", "flatten", "pinch"] as SculptBrush[]) {
    const next = sculptStroke(part, { brush, center: before[0], radius: 300, strength: .4 });
    assert.ok(typeof next !== "string");
    assert.ok(partSchema.safeParse(next).success);
    assert.equal(next.mesh!.v.length, part.mesh!.v.length);
    assert.deepEqual(next.mesh!.f, part.mesh!.f);
    const after = meshPoints(next);
    before.forEach((point, i) => {
      if (Math.hypot(point.x - before[0].x, point.y - before[0].y, point.z - before[0].z) >= 300) {
        assert.ok(Math.hypot(after[i].x - point.x, after[i].y - point.y, after[i].z - point.z) < .01);
      }
    });
  }
  const inflated = sculptStroke(part, { brush: "inflate", center: before[0], radius: 300, strength: .4 });
  const carved = sculptStroke(part, { brush: "deflate", center: before[0], radius: 300, strength: .4 });
  assert.ok(typeof inflated !== "string" && typeof carved !== "string");
  const a = meshPoints(inflated)[0], b = meshPoints(carved)[0];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 40);
});

test("invalid strokes, nested parts and empty brush regions are rejected without mutating the input", () => {
  const bp = blankBlueprint("Sculpt");
  const original = structuredClone(bp);
  assert.equal(typeof sculptStroke(bp.parts[0], { brush: "inflate", center: { x: 0, y: 0, z: 0 }, radius: 0, strength: .2 }), "string");
  assert.equal(typeof sculptStroke(bp.parts[0], { brush: "inflate", center: { x: Infinity, y: 0, z: 0 }, radius: 100, strength: .2 }), "string");
  assert.equal(typeof sculptStroke(bp.parts[0], { brush: "inflate", center: { x: 5000, y: 5000, z: 5000 }, radius: 10, strength: .2 }), "string");
  assert.equal(typeof sculptStroke({ ...bp.parts[0], blueprintId: "child" }, { brush: "inflate", center: { x: 0, y: 0, z: 0 }, radius: 100, strength: .2 }), "string");
  assert.deepEqual(bp, original);
});

test("sculpt editing keeps blueprint metadata and is available to the AI with subdivision", () => {
  const bp = { ...blankBlueprint("Sculpt"), id: "sculpt", revision: 1 };
  const center = meshPoints(toMesh(bp.parts[0]) as typeof bp.parts[number])[0];
  const result = editPoints(bp, bp.parts[0].id, { op: "sculpt", brush: "smooth", center, radius: 500, strength: .2 });
  assert.ok(result.ok);
  assert.equal(result.blueprint.id, bp.id);
  assert.equal(result.partId, bp.parts[0].id);
  const input = getTool("edit_blueprint")!.input;
  assert.ok(input.safeParse({ blueprint: "sculpt", operations: [{ op: "sculpt", part: "part", brush: "inflate", center, radius: 500, strength: .2, symmetry: ["x", "y"] }, { op: "subdivide", part: "part" }] }).success);
});
