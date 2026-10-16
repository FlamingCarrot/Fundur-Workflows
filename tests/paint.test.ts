import { test } from "node:test";
import assert from "node:assert/strict";
import { blankBlueprint } from "../src/lib/blueprints/edit";
import { toMesh, meshPoints } from "../src/lib/blueprints/mesh";
import { paintFaces } from "../src/lib/blueprints/paint";
import { blueprintBody } from "../src/lib/blueprints/schema";
import { inspectGameAsset } from "../src/lib/game-assets/quality";
import { resolver } from "../src/lib/blueprints/resolve";

test("face painting preserves every surface exactly once and keeps all geometry in place", () => {
  const bp = { ...blankBlueprint("Paint"), id: "paint", revision: 1 };
  bp.parts[0].rotation = 30;
  bp.parts[0].tilt = { x: 15, y: -10 };
  const before = toMesh(bp.parts[0]);
  assert.ok(typeof before !== "string");
  const original = structuredClone(bp);
  const result = paintFaces(bp, bp.parts[0].id, [0, 0, 2], "std:terracotta-paint");
  assert.ok(result.ok);
  assert.ok(blueprintBody.safeParse(result.blueprint).success);
  assert.equal(result.blueprint.parts.length, 2);
  assert.equal(result.blueprint.parts[1].mesh!.f.length, 2);
  assert.equal(result.blueprint.parts[1].material, "std:terracotta-paint");
  assert.equal(result.blueprint.parts.reduce((n, p) => n + p.mesh!.f.length, 0), before.mesh!.f.length);
  const points = meshPoints(before);
  for (const part of result.blueprint.parts) assert.deepEqual(meshPoints(part), points);
  assert.equal(inspectGameAsset(resolver(), result.blueprint).triangles, inspectGameAsset(resolver(), bp).triangles);
  assert.deepEqual(bp, original);
});

test("whole part painting avoids a new patch; invalid face IDs are rejected", () => {
  const bp = { ...blankBlueprint("Paint"), id: "paint", revision: 1 };
  const result = paintFaces(bp, bp.parts[0].id, [0, 1, 2, 3, 4, 5], "std:white-paint");
  assert.ok(result.ok);
  assert.equal(result.blueprint.parts.length, 1);
  assert.equal(result.blueprint.parts[0].shape, "box");
  assert.equal(result.blueprint.parts[0].material, "std:white-paint");
  assert.equal(paintFaces(bp, bp.parts[0].id, [-1], "std:white-paint").ok, false);
  assert.equal(paintFaces(bp, bp.parts[0].id, [], "std:white-paint").ok, false);
  assert.equal(paintFaces(bp, "missing", [0], "std:white-paint").ok, false);
});
