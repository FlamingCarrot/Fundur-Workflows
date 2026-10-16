import { test } from "node:test";
import assert from "node:assert/strict";
import { blankBlueprint } from "../src/lib/blueprints/edit";
import { meshPoints, sculptStroke, symmetricBrushCenters, toBlueprint, toMesh, toPart, type SculptBrush } from "../src/lib/blueprints/mesh";
import { SculptSession } from "../src/lib/blueprints/sculpt-session";
import { partSchema } from "../src/lib/blueprints/schema";

const sphere = () => {
  const source = { ...blankBlueprint("Symmetry").parts[0], shape: "sphere" as const, rotation: 37, at: { x: 1250, y: -620, z: 80 } };
  const part = toMesh(source);
  assert.ok(typeof part !== "string");
  return part;
};
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((n, i) => n - b[i]));

test("local symmetry follows translated rotated parts and generates unique axis combinations", () => {
  const part = sphere();
  const center = toBlueprint(part, [80, 60, 50]);
  const points = symmetricBrushCenters(part, center, ["x", "y", "z"]);
  assert.equal(points.length, 8);
  const expected = [80, -80].flatMap(x => [60, -60].flatMap(y => [50, part.size.h - 50].map(z => [x, y, z])));
  for (const point of points) assert.ok(expected.some(p => distance(p, toPart(part, point)) < .005));
  assert.equal(symmetricBrushCenters(part, toBlueprint(part, [0, 0, part.size.h / 2]), ["x", "y", "z"]).length, 1);
  assert.equal(symmetricBrushCenters(part, center, ["x", "x"]).length, 2);
});

test("all sculpt brushes preserve bilateral symmetry and topology on a rotated mesh", () => {
  const part = sphere();
  const local = meshPoints(part).map(p => toPart(part, p));
  const center = toBlueprint(part, [part.size.w * .3, part.size.d * .25, part.size.h * .65]);
  for (const brush of ["inflate", "deflate", "smooth", "flatten", "pinch"] as SculptBrush[]) {
    const result = sculptStroke(part, { brush, center, radius: 260, strength: .25, symmetry: ["x"] });
    assert.ok(typeof result !== "string", brush);
    assert.ok(partSchema.safeParse(result).success);
    assert.deepEqual(result.mesh!.f, part.mesh!.f);
    const after = meshPoints(result).map(p => toPart(part, p));
    local.forEach((point, i) => {
      const partner = local.findIndex(p => distance([-point[0], point[1], point[2]], p) < .01);
      assert.ok(partner >= 0);
      assert.ok(distance([-after[i][0], after[i][1], after[i][2]], after[partner]) < .03, brush + " symmetry at " + i);
    });
    assert.notDeepEqual(result.mesh!.v, part.mesh!.v);
  }
});

test("overlapping mirrored influences do not double brush strength, including centerline dabs", () => {
  const part = sphere();
  const center = toBlueprint(part, [0, 0, part.size.h]);
  for (const brush of ["inflate", "deflate", "smooth", "flatten", "pinch"] as SculptBrush[]) {
    const stroke = { brush, center, radius: 220, strength: .3 };
    const single = sculptStroke(part, stroke);
    const duplicate = sculptStroke(part, { ...stroke, mirrorCenters: [center, center] });
    const mirrored = sculptStroke(part, { ...stroke, symmetry: ["x", "y"] });
    assert.deepEqual(duplicate, single);
    assert.deepEqual(mirrored, single);
  }
});

test("a symmetric session keeps its original planes after refitting, and cancels or commits once", () => {
  const part = sphere();
  const bp = { ...blankBlueprint("Symmetry"), id: "symmetry-test", revision: 1, parts: [part] };
  const session = new SculptSession(bp, part.id);
  const frame = structuredClone(session.frame);
  const center = toBlueprint(frame, [part.size.w * .4, 0, part.size.h / 2]);
  for (let i = 0; i < 6; i++) assert.equal(session.dab(center, { brush: "inflate", radius: 180, strength: .2, symmetry: ["x"] }, { pressure: 1, smooth: false, inverse: false }), null);
  assert.deepEqual(session.frame, frame);
  assert.equal(session.dabs, 6);
  assert.equal(session.finish(false), session.current);
  assert.equal(session.finish(false), null);
  assert.deepEqual(session.before, bp);
  const cancelled = new SculptSession(bp, part.id);
  cancelled.dab(center, { brush: "smooth", radius: 180, strength: .2, symmetry: ["x", "y"] }, { pressure: 1, smooth: false, inverse: false });
  assert.equal(cancelled.finish(true), null);
});

test("invalid mirrored inputs are rejected without modifying geometry", () => {
  const part = sphere(), original = structuredClone(part);
  const stroke = { brush: "inflate" as const, center: meshPoints(part)[0], radius: 100, strength: .2 };
  assert.equal(typeof sculptStroke(part, { ...stroke, mirrorCenters: Array(8).fill(stroke.center) }), "string");
  assert.equal(typeof sculptStroke(part, { ...stroke, mirrorCenters: [{ x: NaN, y: 0, z: 0 }] }), "string");
  assert.deepEqual(part, original);
});
