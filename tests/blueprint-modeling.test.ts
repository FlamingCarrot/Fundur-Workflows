import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DETAILED_PRIMITIVES,
  createPrimitivePart,
} from "../src/lib/blueprints/generators";
import {
  addVertexOnFace,
  alignPoints,
  insetFaces,
  meshPoints,
  rotatePoints,
  scalePoints,
  smoothPoints,
  subdivideFaces,
  toMesh,
  triangulateFaces,
  weldPoints,
} from "../src/lib/blueprints/mesh";
import {
  alignParts,
  distributeParts,
  dropToFloor,
  joinParts,
  mirrorPartZ,
  radialArrayPart,
  separatePart,
} from "../src/lib/blueprints/edit";
import { exportToOBJ, exportToSTL, importFromOBJ } from "../src/lib/blueprints/export";
import { partSchema } from "../src/lib/blueprints/schema";
import { STANDARD } from "../src/lib/blueprints/resolve";
import type { Blueprint, Part } from "../src/lib/blueprints/types";

const near = (a: number, b: number, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("all detailed primitive generators produce valid meshes that satisfy partSchema", () => {
  for (const item of DETAILED_PRIMITIVES) {
    const mesh = item.generate();
    assert.ok(mesh.v.length >= 4, `${item.key} has vertices`);
    assert.ok(mesh.f.length >= 4, `${item.key} has faces`);

    // Verify all vertex coordinates are normalized within [0, 1]
    for (const [x, y, z] of mesh.v) {
      assert.ok(x >= -1e-4 && x <= 1.0001, `${item.key} x in range: ${x}`);
      assert.ok(y >= -1e-4 && y <= 1.0001, `${item.key} y in range: ${y}`);
      assert.ok(z >= -1e-4 && z <= 1.0001, `${item.key} z in range: ${z}`);
    }

    // Verify all faces reference valid vertex indices
    for (const f of mesh.f) {
      assert.ok(f.length >= 3, `${item.key} face has >= 3 vertices`);
      assert.ok(f.every((idx) => idx >= 0 && idx < mesh.v.length), `${item.key} valid vertex indices`);
    }

    const part = createPrimitivePart(item.key, { x: 0, y: 0, z: 0 });
    assert.ok(part, `${item.key} created part`);
    const parsed = partSchema.safeParse(part);
    assert.ok(parsed.success, `${item.key} matches partSchema: ${parsed.success ? "" : parsed.error.message}`);
  }
});

test("mesh detailing operations: inset, subdivide, align, and weld", () => {
  const box: Part = { id: "p1", shape: "box", at: { x: 0, y: 0, z: 0 }, size: { w: 1000, d: 800, h: 600 }, rotation: 0 };
  const m = toMesh(box);
  assert.equal(typeof m, "object");
  const meshPart = m as Part;

  // Inset top face
  const topFaceIdx = meshPart.mesh!.f.findIndex((f) => f.length === 4);
  const insetRes = insetFaces(meshPart, [topFaceIdx], 50);
  assert.ok(typeof insetRes !== "string", "inset succeeds");
  assert.ok(insetRes.part.mesh!.v.length > meshPart.mesh!.v.length, "inset adds inner vertices");
  assert.ok(insetRes.part.mesh!.f.length > meshPart.mesh!.f.length, "inset adds perimeter frame quads");

  // Subdivide
  const subRes = subdivideFaces(meshPart);
  assert.ok(typeof subRes !== "string", "subdivide succeeds");
  assert.ok((subRes as Part).mesh!.f.length > meshPart.mesh!.f.length, "subdivide multiplies faces");

  // Align points
  const alignRes = alignPoints(meshPart, [0, 1, 2], "z", "min");
  assert.ok(typeof alignRes !== "string", "align succeeds");
  const alignedPts = meshPoints(alignRes as Part);
  near(alignedPts[0].z, alignedPts[1].z);
  near(alignedPts[1].z, alignedPts[2].z);

  // Weld
  const weldRes = weldPoints(meshPart, 0.5);
  assert.ok(typeof weldRes !== "string", "weld succeeds");

  // Add vertex on face (Peak)
  const addVtRes = addVertexOnFace(meshPart, topFaceIdx, 60);
  assert.ok(typeof addVtRes !== "string", "addVertexOnFace succeeds");
  assert.ok(addVtRes.part.mesh!.v.length === meshPart.mesh!.v.length + 1, "adds 1 new vertex at centroid");
  assert.ok(addVtRes.part.mesh!.f.length === meshPart.mesh!.f.length + 3, "splits 1 quad into 4 triangles");

  // Scale points (Taper / Flare)
  const scaleRes = scalePoints(meshPart, [0, 1, 2, 3], 0.8);
  assert.ok(typeof scaleRes !== "string", "scalePoints succeeds");

  // Rotate points (Twist)
  const rotRes = rotatePoints(meshPart, [0, 1, 2, 3], "z", 30);
  assert.ok(typeof rotRes !== "string", "rotatePoints succeeds");

  // Smooth points (Laplacian relaxation)
  const smoothRes = smoothPoints(meshPart, [0, 1, 2, 3], 2, 0.5);
  assert.ok(typeof smoothRes !== "string", "smoothPoints succeeds");

  // Triangulate faces
  const triRes = triangulateFaces(meshPart);
  assert.ok(typeof triRes !== "string", "triangulateFaces succeeds");
  assert.ok((triRes as Part).mesh!.f.every((f) => f.length === 3), "all faces triangulated to triples");
});

test("part modeling tools: dropToFloor, alignParts, distributeParts, radialArray, and mirrorZ", () => {
  const p1: Part = { id: "a", shape: "box", at: { x: 100, y: 0, z: 50 }, size: { w: 200, d: 200, h: 300 }, rotation: 0 };
  const p2: Part = { id: "b", shape: "cylinder", at: { x: 400, y: 100, z: 120 }, size: { w: 200, d: 200, h: 300 }, rotation: 0 };
  const p3: Part = { id: "c", shape: "box", at: { x: 900, y: 0, z: 20 }, size: { w: 200, d: 200, h: 300 }, rotation: 0 };

  const bp: Blueprint = {
    id: "test-bp",
    name: "Test Blueprint",
    kind: "object",
    category: "Other",
    type: "box",
    size: { w: 1200, d: 600, h: 800 },
    parts: [p1, p2, p3],
    symbol: "parts",
    revision: 1,
  };

  // Drop to floor
  const dropped = dropToFloor(bp, ["a", "b", "c"]);
  assert.ok(dropped.ok);
  const minZ = Math.min(...dropped.blueprint.parts.map((p) => p.at.z));
  near(minZ, 0);

  // Align parts on X
  const aligned = alignParts(bp, ["a", "b", "c"], "x", "center");
  assert.ok(aligned.ok);
  assert.equal(aligned.blueprint.parts[0].at.x, aligned.blueprint.parts[1].at.x);

  // Distribute parts on X
  const distributed = distributeParts(bp, ["a", "b", "c"], "x");
  assert.ok(distributed.ok);
  const xs = distributed.blueprint.parts.map((p) => p.at.x);
  near(xs[1] - xs[0], xs[2] - xs[1]);

  // Radial array
  const radial = radialArrayPart(bp, "a", 4);
  assert.ok(radial.ok);
  assert.equal(radial.blueprint.parts.length, 3 + 3, "added 3 radial copies");

  // Mirror Z
  const mirrored = mirrorPartZ(bp, "a");
  assert.ok(mirrored.ok);
  assert.equal(mirrored.blueprint.parts.length, 4);
});

test("joinParts and separatePart compound modeling operations", () => {
  const p1: Part = { id: "p1", shape: "box", at: { x: -300, y: 0, z: 0 }, size: { w: 200, d: 200, h: 400 }, rotation: 0 };
  const p2: Part = { id: "p2", shape: "box", at: { x: 300, y: 0, z: 0 }, size: { w: 200, d: 200, h: 400 }, rotation: 0 };

  const bp: Blueprint = {
    id: "compound-bp",
    name: "Compound",
    kind: "object",
    category: "Other",
    type: "box",
    size: { w: 1000, d: 600, h: 500 },
    parts: [p1, p2],
    symbol: "parts",
    revision: 1,
  };

  const joined = joinParts(bp, ["p1", "p2"]);
  assert.ok(joined.ok);
  assert.equal(joined.blueprint.parts.length, 1, "two parts joined into 1 compound mesh part");
  const compound = joined.blueprint.parts[0];
  assert.equal(compound.shape, "mesh");
  assert.equal(compound.mesh!.v.length, 16, "both boxes points combined");
  assert.equal(compound.mesh!.f.length, 12, "both boxes faces combined");

  // Separate the disconnected pieces back out
  const separated = separatePart(joined.blueprint, compound.id);
  assert.ok(separated.ok);
  assert.equal(separated.blueprint.parts.length, 2, "separated back into 2 disconnected island parts");
});

test("exportToOBJ, exportToSTL, and importFromOBJ interchange round-trip", () => {
  const p1: Part = { id: "p1", shape: "box", at: { x: 0, y: 0, z: 0 }, size: { w: 500, d: 400, h: 300 }, rotation: 0 };
  const bp: Blueprint = {
    id: "export-bp",
    name: "Export Test",
    kind: "object",
    category: "Other",
    type: "box",
    size: { w: 500, d: 400, h: 300 },
    parts: [p1],
    symbol: "parts",
    revision: 1,
  };

  const obj = exportToOBJ(STANDARD, bp);
  assert.ok(obj.includes("o Box") || obj.includes("o Part") || obj.includes("v "));
  assert.ok(obj.includes("f "));

  const stl = exportToSTL(STANDARD, bp);
  assert.ok(stl.startsWith("solid"));
  assert.ok(stl.includes("facet normal"));
  assert.ok(stl.includes("vertex"));
  assert.ok(stl.endsWith("endsolid Export_Test"));

  const imported = importFromOBJ(obj, "Roundtrip Test");
  assert.equal(imported.name, "Roundtrip Test");
  assert.equal(imported.parts.length, 1);
  near(imported.parts[0].size.w, 500);
  near(imported.parts[0].size.d, 400);
  near(imported.parts[0].size.h, 300);
});
