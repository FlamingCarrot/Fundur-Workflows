import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, resolvePoint } from "../src/lib/plan/command";

test("the command line reads tools, amounts, actions and points as AutoCAD does", () => {
  assert.deepEqual(parseCommand("L"), { kind: "tool", tool: "line" });
  assert.deepEqual(parseCommand(" rec "), { kind: "tool", tool: "rectangle" });
  assert.deepEqual(parseCommand("O 250"), { kind: "tool", tool: "offset", amount: 250 });
  assert.deepEqual(parseCommand("f 0"), { kind: "tool", tool: "fillet", amount: 0 });
  assert.deepEqual(parseCommand("pol 8"), { kind: "tool", tool: "polygon", amount: 8 });
  assert.equal(parseCommand("o 0").kind, "error");
  assert.equal(parseCommand("L 5").kind, "error");
  assert.deepEqual(parseCommand("x"), { kind: "action", action: "explode" });
  assert.deepEqual(parseCommand("1200,-300"), { kind: "point", spec: { abs: { x: 1200, y: -300 } } });
  assert.deepEqual(parseCommand("@500,0"), { kind: "point", spec: { rel: { x: 500, y: 0 } } });
  assert.deepEqual(parseCommand("@1000<90"), { kind: "point", spec: { polar: { length: 1000, angle: 90 } } });
  assert.deepEqual(parseCommand("750"), { kind: "point", spec: { length: 750 } });
  assert.equal(parseCommand("blah").kind, "error");
  assert.equal(parseCommand("").kind, "error");
});

test("typed points land where they should", () => {
  const last = { x: 100, y: 100 };
  assert.deepEqual(resolvePoint({ abs: { x: 5, y: 6 } }, undefined, null), { x: 5, y: 6 });
  assert.equal(resolvePoint({ rel: { x: 5, y: 6 } }, undefined, null), null);
  assert.deepEqual(resolvePoint({ rel: { x: 50, y: -20 } }, last, null), { x: 150, y: 80 });
  const p = resolvePoint({ polar: { length: 1000, angle: 90 } }, last, null)!;
  assert.ok(Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y - 1100) < 1e-9);
  const q = resolvePoint({ length: 500 }, last, { x: 100, y: -900 })!;
  assert.ok(Math.abs(q.x - 100) < 1e-9 && Math.abs(q.y + 400) < 1e-9);
});
