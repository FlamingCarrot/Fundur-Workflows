import { test } from "node:test";
import assert from "node:assert/strict";
import { deletePoints, extrudeFaces, facesWithin, makeFace, meshEdges, meshPoints, mergePoints, movePoints, setPoint, splitEdges, toMesh, triangulate } from "../src/lib/blueprints/mesh";
import { editPoints, mirrorPart, transformParts } from "../src/lib/blueprints/edit";
import { partSchema } from "../src/lib/blueprints/schema";
import { flatten, STANDARD, topView } from "../src/lib/blueprints/resolve";
import { previewFaces } from "../src/lib/blueprints/preview";
import type { Blueprint, Part } from "../src/lib/blueprints/types";

const box: Part = { id: "a", shape: "box", at: { x: 100, y: 0, z: 0 }, size: { w: 1000, d: 500, h: 400 }, rotation: 0 };
const mesh = (p: Part | string) => {
  assert.equal(typeof p, "object", String(p));
  return p as Part;
};
const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("any shape turns into a mesh that keeps its size and place", () => {
  for (const shape of ["box", "wedge", "cylinder", "sphere", "lathe", "extrude"] as const) {
    const part: Part = { ...box, shape, ...(shape === "lathe" ? { profile: [[0.6, 0], [1, 0.5], [0.4, 1]] } : shape === "extrude" ? { profile: [[0, 0], [1, 0], [0.5, 1]] } : {}) };
    const m = mesh(toMesh(part));
    assert.equal(m.shape, "mesh");
    assert.ok(partSchema.safeParse(m).success, `${shape}: ${JSON.stringify(partSchema.safeParse(m).error?.issues?.[0])}`);
    near(m.size.h, 400);
    near(m.at.z, 0);
    if (shape === "box" || shape === "wedge") {
      near(m.size.w, 1000);
      near(m.at.x, 100);
    }
  }
  const b = mesh(toMesh(box));
  assert.equal(b.mesh!.v.length, 8);
  assert.equal(b.mesh!.f.length, 6);
  assert.equal(meshEdges(b.mesh!).length, 12);
});

test("points move and land exactly, in millimetres, and the box refits", () => {
  const b = mesh(toMesh(box));
  const pts = meshPoints(b);
  const top = pts.map((p, i) => (p.z > 399 ? i : -1)).filter((i) => i >= 0);
  assert.equal(top.length, 4);
  const raised = mesh(movePoints(b, top, { x: 0, y: 0, z: 150 }));
  near(raised.size.h, 550);
  const one = pts.findIndex((p) => p.x < -399 && p.y < -249 && p.z < 1);
  const placed = mesh(setPoint(b, one, { x: -500.5, y: -300, z: -20 }));
  const after = meshPoints(placed)[one];
  near(after.x, -500.5, 0.001);
  near(after.y, -300, 0.001);
  near(after.z, -20, 0.001);
  near(placed.at.z, -20);
  // Turned parts take moves in the blueprint's frame.
  const turned = mesh(toMesh({ ...box, rotation: 90 }));
  const moved = mesh(movePoints(turned, [0], { x: 0, y: 0, z: 0 }));
  const p0 = meshPoints(turned)[0];
  const pm = mesh(setPoint(turned, 0, { x: p0.x + 10 }));
  near(meshPoints(pm)[0].x, p0.x + 10, 0.001);
  near(meshPoints(pm)[0].y, p0.y, 0.001);
  assert.ok(moved);
});

test("edges split, points merge and go, faces are made and pushed", () => {
  const b = mesh(toMesh(box));
  const [a, c] = meshEdges(b.mesh!)[0];
  const split = splitEdges(b, [a, c]);
  assert.ok(typeof split !== "string");
  assert.equal(split.part.mesh!.v.length, 9);
  assert.equal(split.added.length, 1);
  assert.equal(split.part.mesh!.f.filter((f) => f.length === 5).length, 2, "both faces on that edge gain the point");
  const merged = mesh(mergePoints(b, [0, 1]));
  assert.equal(merged.mesh!.v.length, 7);
  const gone = mesh(deletePoints(b, [0]));
  assert.equal(gone.mesh!.v.length, 7);
  assert.ok(gone.mesh!.f.every((f) => f.length >= 3));
  const top = facesWithin(b.mesh!, meshPoints(b).flatMap((p, i) => (p.z > 399 ? [i] : [])));
  assert.equal(top.length, 1);
  const pushed = extrudeFaces(b, top, 200);
  assert.ok(typeof pushed !== "string");
  near(pushed.part.size.h, 600);
  assert.equal(pushed.part.mesh!.f.length, 10, "the top moves up and four sides join it");
  assert.equal(pushed.points.length, 4);
  const pulled = extrudeFaces(b, top, -100);
  assert.ok(typeof pulled !== "string");
  near(pulled.part.size.h, 400);
  assert.equal(typeof makeFace(b, [0, 1]), "string");
  assert.equal(mesh(makeFace(b, [0, 2, 4])).mesh!.f.length, 7);
});

test("concave faces split into triangles without overlap", () => {
  // An L shape, flat on the floor.
  const L: [number, number, number][] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
  const tris = triangulate(L);
  assert.equal(tris.length, 4);
  const area = tris.reduce((s, [a, b, c]) => s + Math.abs((L[b][0] - L[a][0]) * (L[c][1] - L[a][1]) - (L[b][1] - L[a][1]) * (L[c][0] - L[a][0])) / 2, 0);
  near(area, 3, 1e-9);
});

test("a mesh part draws, previews, shows from above and mirrors in a blueprint", () => {
  const m = mesh(toMesh({ ...box, shape: "wedge" }));
  const bp: Blueprint = { id: "x", name: "Ramp", kind: "object", category: "Other", type: "box", size: { w: 1200, d: 600, h: 400 }, parts: [m], symbol: "parts", revision: 0 };
  const prims = flatten(STANDARD, bp);
  assert.equal(prims[0].shape, "mesh");
  assert.ok(prims[0].mesh);
  const outline = topView(prims)[0];
  assert.equal(outline.t, "poly");
  assert.ok(previewFaces(prims, () => "#888888").faces.length >= 2);
  const mirrored = mirrorPart(bp, m.id, "x");
  assert.ok(mirrored.ok);
  if (mirrored.ok) {
    const copy = mirrored.blueprint.parts.at(-1)!;
    assert.ok(partSchema.safeParse(copy).success);
    near(meshPoints(copy)[0].x, -meshPoints(m)[0].x, 0.01);
  }
  const grown = transformParts(bp, [m.id], { move: { x: 0, y: 0, z: 0 }, turn: 0, scale: { x: 2, y: 1, z: 1 } });
  assert.ok(grown.ok);
});

test("point edits go through the blueprint edit, with the points to keep selected", () => {
  const bp: Blueprint = { id: "x", name: "Box", kind: "object", category: "Other", type: "box", size: { w: 1000, d: 500, h: 400 }, parts: [box], symbol: "parts", revision: 0 };
  const converted = editPoints(bp, "a", { op: "convert" });
  assert.ok(converted.ok);
  if (!converted.ok) return;
  const split = editPoints(converted.blueprint, "a", { op: "split", points: [0, 1] });
  assert.ok(split.ok && split.points?.length === 1);
  const bad = editPoints(converted.blueprint, "a", { op: "move", points: [99], by: { x: 1, y: 0, z: 0 } });
  assert.equal(bad.ok, false);
});
