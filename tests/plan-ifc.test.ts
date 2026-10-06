import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem, copyLevel, updateWall } from "../src/lib/plan/elements";
import { samplePlan, updateOpening, type EditResult } from "../src/lib/plan/geometry";
import { exportIfc, globalId } from "../src/lib/plan/ifc";

const count = (text: string, entity: string) => text.split("\n").filter((l) => new RegExp(`^#\\d+=${entity}\\(`).test(l)).length;

function plan() {
  let plan = samplePlan();
  const step = (r: EditResult) => {
    if (!r.ok) assert.fail(r.error);
    plan = r.plan;
  };
  step(addItem(plan, "desk", { x: 10_000, y: 3_000 }));
  step(addItem(plan, "wc", { x: 15_000, y: 9_000 }));
  const door = plan.openings.find((o) => o.kind === "door")!;
  step(updateOpening(plan, door.id, { style: "opening" }));
  step(updateWall(plan, plan.walls[5].id, { kind: "partition" }));
  step(copyLevel(plan, plan.levels[0].id));
  return plan;
}

test("IFC export has a storey per floor, walls with openings, doors, windows, spaces, columns and furniture", () => {
  const p = plan();
  const text = exportIfc(p, { projectName: "Sample", now: new Date("2026-10-06T00:00:00Z") });
  assert.match(text, /^ISO-10303-21;\nHEADER;/);
  assert.match(text, /FILE_SCHEMA\(\('IFC4'\)\);/);
  assert.equal(count(text, "IFCBUILDINGSTOREY"), 2);
  assert.equal(count(text, "IFCWALL"), p.walls.length);
  assert.equal(count(text, "IFCOPENINGELEMENT"), p.openings.length);
  assert.equal(count(text, "IFCRELVOIDSELEMENT"), p.openings.length);
  // A plain opening is cut but has no door in it.
  assert.equal(count(text, "IFCDOOR"), p.openings.filter((o) => o.kind === "door").length - 2);
  assert.equal(count(text, "IFCWINDOW"), p.openings.filter((o) => o.kind === "window").length);
  assert.equal(count(text, "IFCSPACE"), p.rooms.length);
  assert.equal(count(text, "IFCCOLUMN"), p.columns.length);
  assert.equal(count(text, "IFCFURNITURE"), 1);
  assert.equal(count(text, "IFCSANITARYTERMINAL"), 1);
  assert.match(text, /\.PARTITIONING\.\)/);
  assert.match(text, /IFCQUANTITYAREA\('NetFloorArea',\$,\$,22\.5,\$\)/);
});

test("the same plan exports with the same ids, and names are safely encoded", () => {
  const p = plan();
  const named = { ...p, rooms: p.rooms.map((r, i) => (i === 0 ? { ...r, name: "Ella's room – Å\\" } : r)) };
  const now = new Date("2026-10-06T00:00:00Z");
  assert.equal(exportIfc(named, { projectName: "X", now }), exportIfc(named, { projectName: "X", now }));
  const text = exportIfc(named, { projectName: "X", now });
  assert.ok(text.includes("'Ella''s room \\X2\\2013\\X0\\ \\X2\\00C5\\X0\\\\\\'"));
  assert.equal(globalId("a").length, 22);
  assert.notEqual(globalId("a"), globalId("b"));
  assert.match(globalId("wall:x"), /^[0-3][0-9A-Za-z_$]{21}$/);
});
