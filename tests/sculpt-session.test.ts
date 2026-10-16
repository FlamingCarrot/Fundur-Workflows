import { test } from "node:test";
import assert from "node:assert/strict";
import { blankBlueprint } from "../src/lib/blueprints/edit";
import { meshPoints, toMesh } from "../src/lib/blueprints/mesh";
import { SculptSession, brushRadiusPixels } from "../src/lib/blueprints/sculpt-session";
import type { Part } from "../src/lib/blueprints/types";
import { blueprintBody } from "../src/lib/blueprints/schema";

const setup = () => {
  const bp = { ...blankBlueprint("Stroke test"), id: "stroke", revision: 1 };
  return { bp, partId: bp.parts[0].id, center: meshPoints(toMesh(bp.parts[0]) as Part)[0] };
};
const settings = { brush: "inflate" as const, radius: 300, strength: .4 };
const modifiers = { pressure: 1, smooth: false, inverse: false };

test("a complete brush gesture retains one immutable before state and one final draft", () => {
  const { bp, partId, center } = setup();
  const original = structuredClone(bp);
  const session = new SculptSession(bp, partId);
  for (let i = 0; i < 8; i++) assert.equal(session.dab(center, settings, modifiers), null);
  assert.equal(session.dabs, 8);
  assert.equal(session.before, bp);
  assert.deepEqual(session.before, original);
  assert.notDeepEqual(session.current.parts, bp.parts);
  assert.equal(session.current.parts.length, bp.parts.length);
  assert.ok(blueprintBody.safeParse(session.current).success);
  assert.equal(session.finish(false), session.current);
  assert.equal(session.finish(false), null, "a gesture can be committed only once");
});

test("cancelled gestures return no history entry and retain the original model", () => {
  const { bp, partId, center } = setup();
  const original = structuredClone(bp);
  const session = new SculptSession(bp, partId);
  session.dab(center, settings, modifiers);
  assert.equal(session.finish(true), null);
  assert.deepEqual(session.before, original);
  assert.match(session.dab(center, settings, modifiers)!, /ended/);
});

test("stylus pressure changes displacement, Shift smooths and inverse switches inflate/carve", () => {
  const { bp, partId, center } = setup();
  const full = new SculptSession(bp, partId), half = new SculptSession(bp, partId), inverse = new SculptSession(bp, partId), smooth = new SculptSession(bp, partId);
  full.dab(center, settings, modifiers);
  half.dab(center, settings, { ...modifiers, pressure: .5 });
  inverse.dab(center, settings, { ...modifiers, inverse: true });
  smooth.dab(center, settings, { ...modifiers, smooth: true });
  const point = (s: SculptSession) => meshPoints(s.current.parts[0])[0];
  const delta = (s: SculptSession) => { const p = point(s); return Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z); };
  assert.ok(Math.abs(delta(full) / delta(half) - 2) < .01);
  const a = point(full), b = point(inverse);
  assert.ok((a.x - center.x) * (b.x - center.x) < 0);
  assert.notDeepEqual(point(smooth), point(full));
  const noPressure = new SculptSession(bp, partId);
  assert.equal(noPressure.dab(center, settings, { ...modifiers, pressure: 0 }), null);
  assert.equal(noPressure.current, bp);
  assert.equal(noPressure.dabs, 0);
});

test("invalid surface strokes do not change the draft and nested parts are rejected", () => {
  const { bp, partId, center } = setup();
  const session = new SculptSession(bp, partId);
  assert.match(session.dab(center, { ...settings, radius: 0 }, modifiers)!, /positive radius/);
  assert.equal(session.current, bp);
  assert.equal(session.dabs, 0);
  assert.throws(() => new SculptSession({ ...bp, parts: [{ ...bp.parts[0], blueprintId: "nested" }] }, partId), /editable shape/);
});

test("brush cursor scales with zoom and remains consistent across projections", () => {
  assert.equal(brushRadiusPixels(100, 1000, { kind: "orthographic", span: 2 }), 50);
  assert.ok(Math.abs(brushRadiusPixels(100, 1000, { kind: "perspective", depth: 1, fov: 90 }) - 50) < .0001);
  assert.equal(brushRadiusPixels(100, 1000, { kind: "orthographic", span: 1 }), 100);
  assert.equal(brushRadiusPixels(0, 1000, { kind: "orthographic", span: 2 }), 0);
});
