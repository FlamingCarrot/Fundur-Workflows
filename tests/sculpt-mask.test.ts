import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { blankBlueprint, editPoints, joinParts, separatePart } from "../src/lib/blueprints/edit";
import { editMask } from "../src/lib/blueprints/mask";
import { meshPoints, sculptStroke, subdivideFaces, splitEdges, deletePoints, extrudeFaces, insetFaces, addVertexOnFace, toMesh, type SculptBrush } from "../src/lib/blueprints/mesh";
import { SculptSession } from "../src/lib/blueprints/sculpt-session";
import { blueprintBody, partSchema } from "../src/lib/blueprints/schema";
import { paintFaces } from "../src/lib/blueprints/paint";
import { resolver } from "../src/lib/blueprints/resolve";
import { exportGameGLTF } from "../src/lib/game-assets/export";
import { geometryFor, materialFor } from "../src/components/plan/three/build";
import type { Solid } from "../src/lib/plan/scene";
import type { Part } from "../src/lib/blueprints/types";
import "../src/lib/ai/tools/library";
import { getTool } from "../src/lib/ai/tools/registry";

const part = () => { const result = toMesh(blankBlueprint("Mask").parts[0]); assert.ok(typeof result !== "string"); return result; };
const good = (result: Part | string): Part => { assert.ok(typeof result !== "string", String(result)); assert.ok(partSchema.safeParse(result).success); return result; };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < .01, a + " != " + b);

test("mask strokes change only protection, with soft falloff and unchanged vertices outside the brush", () => {
  const p = part(), before = structuredClone(p), points = meshPoints(p);
  const painted = good(editMask(p, { action: "paint", center: points[0], radius: 300, strength: .6 }));
  assert.deepEqual(p, before);
  assert.deepEqual(meshPoints(painted), points);
  assert.equal(painted.mesh!.mask![0], .6);
  points.forEach((v, i) => { if (Math.hypot(v.x - points[0].x, v.y - points[0].y, v.z - points[0].z) >= 300) assert.equal(painted.mesh!.mask![i], 0); });
  const erased = good(editMask(painted, { action: "erase", center: points[0], radius: 300, strength: .5 }));
  assert.equal(erased.mesh!.mask![0], .3);
  const mirror = good(editMask(p, { action: "paint", center: points[0], radius: 300, strength: .6, symmetry: ["x"] }));
  assert.equal(mirror.mesh!.mask![0], mirror.mesh!.mask![1]);
});

test("full protection prevents every sculpt brush and partial protection scales displacement", () => {
  const p = part(), center = meshPoints(p)[0];
  const all = good(editMask(p, { action: "all" }));
  const half = { ...p, mesh: { ...p.mesh!, mask: p.mesh!.v.map(() => .5) } };
  for (const brush of ["inflate", "deflate", "smooth", "flatten", "pinch"] as SculptBrush[]) {
    const stroke = { brush, center, radius: 700, strength: .3 };
    assert.equal(sculptStroke(all, stroke), all);
    const free = good(sculptStroke(p, stroke)), protectedPart = good(sculptStroke(half, stroke));
    const before = meshPoints(p), a = meshPoints(free), b = meshPoints(protectedPart);
    before.forEach((q, i) => { for (const axis of ["x", "y", "z"] as const) close(b[i][axis] - q[axis], (a[i][axis] - q[axis]) / 2); });
    assert.deepEqual(protectedPart.mesh!.mask, half.mesh.mask);
  }
});

test("global mask adjustments retain geometry, validate and survive JSON persistence", () => {
  const p = part(), center = meshPoints(p)[0];
  const painted = good(editMask(p, { action: "paint", center, radius: 20, strength: 1 }));
  const blurred = good(editMask(painted, { action: "blur" }));
  assert.ok(blurred.mesh!.mask![0] < 1 && blurred.mesh!.mask!.some((v, i) => i > 0 && v > 0));
  const sharp = good(editMask(blurred, { action: "sharpen" }));
  assert.deepEqual(meshPoints(sharp), meshPoints(p));
  const inverse = good(editMask(painted, { action: "invert" }));
  assert.equal(inverse.mesh!.mask![0], 0);
  assert.equal(inverse.mesh!.mask![1], 1);
  const cleared = good(editMask(inverse, { action: "clear" }));
  assert.equal(cleared.mesh!.mask, undefined);
  const bp = { ...blankBlueprint("Mask"), parts: [painted] };
  const saved = blueprintBody.parse(JSON.parse(JSON.stringify(bp)));
  assert.deepEqual(saved.parts[0].mesh!.mask, painted.mesh!.mask);
  assert.equal(partSchema.safeParse({ ...p, mesh: { ...p.mesh!, mask: [1] } }).success, false);
  assert.equal(partSchema.safeParse({ ...p, mesh: { ...p.mesh!, mask: p.mesh!.v.map(() => NaN) } }).success, false);
});

test("subdivision interpolates protection and supported topology edits keep masks aligned", () => {
  const p = part(), center = meshPoints(p)[0];
  const painted = good(editMask(p, { action: "paint", center, radius: 20, strength: 1 }));
  const sub = good(subdivideFaces(painted));
  assert.equal(sub.mesh!.mask!.length, sub.mesh!.v.length);
  assert.ok(sub.mesh!.mask!.includes(.5));
  assert.ok(sub.mesh!.mask!.includes(.25));
  const split = splitEdges(painted, [0, 1]); assert.ok(typeof split !== "string");
  assert.equal(split.part.mesh!.mask![split.added[0]], .5);
  const removed = good(deletePoints(painted, [1]));
  meshPoints(removed).forEach((q, i) => {
    const original = meshPoints(painted).findIndex(v => Math.hypot(v.x - q.x, v.y - q.y, v.z - q.z) < .01);
    assert.equal(removed.mesh!.mask![i], painted.mesh!.mask![original]);
  });
  for (const result of [extrudeFaces(painted, [0], 20), insetFaces(painted, [0], 20), addVertexOnFace(painted, 0)]) {
    assert.ok(typeof result !== "string");
    const edited = good(result.part);
    assert.equal(edited.mesh!.mask!.length, edited.mesh!.v.length);
  }
});

test("material patches, joined meshes and separated islands retain their mask weights", () => {
  const p = good(editMask(part(), { action: "all" }));
  const bp = { ...blankBlueprint("Mask"), id: "mask", revision: 1, parts: [p] };
  const paint = paintFaces(bp, p.id, [0], "std:warm-grey-paint"); assert.ok(paint.ok);
  assert.ok(paint.blueprint.parts.every(patch => patch.mesh!.mask!.every(w => w === 1)));
  const sibling = { ...part(), id: "other", at: { x: 2000, y: 0, z: 0 } };
  const joined = joinParts({ ...bp, parts: [p, sibling] }, [p.id, sibling.id]); assert.ok(joined.ok);
  assert.deepEqual(joined.blueprint.parts[0].mesh!.mask, [...p.mesh!.v.map(() => 1), ...sibling.mesh!.v.map(() => 0)]);
  const separated = separatePart(joined.blueprint, joined.partId!); assert.ok(separated.ok);
  assert.ok(separated.blueprint.parts.some(piece => piece.mesh!.mask!.every(w => w === 1)));
  assert.ok(separated.blueprint.parts.some(piece => piece.mesh!.mask!.every(w => w === 0)));
});

test("mask gestures have one final draft, pressure scaling, no deformation and reversible cancellation", () => {
  const p = part(), bp = { ...blankBlueprint("Mask"), id: "mask", revision: 1, parts: [p] };
  const session = new SculptSession(bp, p.id), center = meshPoints(p)[0];
  const settings = { brush: "inflate" as const, radius: 20, strength: 1, mode: "mask" as const };
  assert.equal(session.dab(center, settings, { pressure: .5, inverse: false, smooth: false }), null);
  assert.equal(session.current.parts[0].mesh!.mask![0], .5);
  assert.deepEqual(meshPoints(session.current.parts[0]), meshPoints(p));
  assert.equal(session.finish(false), session.current);
  assert.equal(session.finish(false), null);
  const cancelled = new SculptSession(bp, p.id);
  cancelled.dab(center, settings, { pressure: 1, inverse: false, smooth: false });
  assert.equal(cancelled.finish(true), null);
  assert.equal(cancelled.before, bp);
  const all = good(editMask(p, { action: "all" }));
  const protectedSession = new SculptSession({ ...bp, parts: [all] }, p.id);
  protectedSession.dab(center, { ...settings, mode: "sculpt" }, { pressure: 1, inverse: false, smooth: false });
  assert.equal(protectedSession.dabs, 0);
  assert.equal(protectedSession.finish(false), null);
});

test("mask visualization is opt-in, matches rendered triangle vertices, and never enters glTF materials", () => {
  const p = good(editMask(part(), { action: "all" }));
  const solid: Solid = { shape: "mesh", mesh: p.mesh, at: [0, 0, 0], size: [1, 1, 1], rotation: 0, color: "#ffffff", target: {} as Solid["target"], levelId: "test" };
  const geometry = geometryFor(solid);
  assert.equal(geometry.getAttribute("color").count, geometry.getAttribute("position").count);
  close(geometry.getAttribute("color").getX(0), .18);
  const look = { style: "clay" as const, lib: resolver({}), clipping: [], onTexture: () => {} };
  const visible = materialFor(solid, { ...look, showMask: true }) as THREE.MeshStandardMaterial;
  const hidden = materialFor(solid, look) as THREE.MeshStandardMaterial;
  assert.equal(visible.vertexColors, true); assert.equal(hidden.vertexColors, false);
  const bp = { ...blankBlueprint("Mask"), id: "mask", revision: 1, parts: [p] };
  const original = { ...bp, parts: [{ ...p, mesh: { v: p.mesh!.v, f: p.mesh!.f } }] };
  assert.equal(exportGameGLTF(look.lib, bp), exportGameGLTF(look.lib, original));
  geometry.dispose(); visible.dispose(); hidden.dispose();
});

test("AI tools accept mask operations and invalid inputs fail without changing a model", () => {
  const input = getTool("edit_blueprint")!.input;
  assert.ok(input.safeParse({ blueprint: "mask", operations: [{ op: "mask", part: "one", action: "all" }, { op: "mask", part: "one", action: "paint", center: { x: 0, y: 0, z: 0 }, radius: 10, strength: .5, symmetry: ["x"] }] }).success);
  const p = part(), snapshot = structuredClone(p), center = meshPoints(p)[0];
  assert.equal(typeof editMask(p, { action: "paint", center, radius: 0, strength: 1 }), "string");
  assert.equal(typeof editMask(p, { action: "paint", center: { ...center, x: NaN }, radius: 10, strength: 1 }), "string");
  assert.equal(typeof editMask({ ...p, blueprintId: "nested" }, { action: "all" }), "string");
  assert.deepEqual(p, snapshot);
  const bp = { ...blankBlueprint("Mask"), id: "mask", revision: 1, parts: [p] };
  const result = editPoints(bp, p.id, { op: "mask", action: "all" }); assert.ok(result.ok);
  assert.equal(result.blueprint.id, bp.id);
});
