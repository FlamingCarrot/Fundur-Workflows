import { test } from "node:test";
import assert from "node:assert/strict";
import { exportDxf, importDxf } from "../src/lib/plan/dxf";
import { roomArea, samplePlan, usableArea, type EditResult } from "../src/lib/plan/geometry";
import { addDimension, addItem, addNote, updateWall } from "../src/lib/plan/elements";

function dxf(header: string[], entities: string[]): string {
  return ["0", "SECTION", "2", "HEADER", ...header, "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC", "0", "EOF"].join("\n");
}

const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
  ["0", "LINE", "8", layer, "10", String(x1), "20", String(y1), "11", String(x2), "21", String(y2)];

test("a plan exported and read back keeps its walls, openings, columns and rooms", () => {
  const plan = samplePlan();
  const { plan: back, warnings } = importDxf(exportDxf(plan), "sample.dxf");
  assert.deepEqual(warnings, []);
  assert.equal(back.walls.length, plan.walls.length);
  assert.equal(back.openings.length, plan.openings.length);
  assert.equal(back.columns.length, plan.columns.length);
  assert.deepEqual(back.rooms.map((r) => r.name).sort(), plan.rooms.map((r) => r.name).sort());
  for (const room of plan.rooms) {
    assert.equal(roomArea(back.rooms.find((r) => r.name === room.name)!), roomArea(room));
  }
  assert.equal(back.source?.name, "sample.dxf");
});

test("drawing units are converted to millimetres", () => {
  const text = dxf(["9", "$INSUNITS", "70", "6"], [...line("A-WALL", 0, 0, 4.5, 0), ...line("A-WALL", 4.5, 0, 4.5, 3)]);
  const { plan, warnings } = importDxf(text);
  assert.deepEqual(plan.walls.map((w) => w.b), [{ x: 4_500, y: 0 }, { x: 4_500, y: 3_000 }]);
  assert.ok(warnings.some((w) => /metres/.test(w)));
});

test("rooms are named by the text inside them, and doors land on their wall", () => {
  const room = [
    "0", "LWPOLYLINE", "8", "A-AREA", "90", "4", "70", "1",
    "10", "0", "20", "0", "10", "5000", "20", "0", "10", "5000", "20", "4000", "10", "0", "20", "4000",
  ];
  const label = ["0", "TEXT", "8", "A-AREA-IDEN", "10", "2000", "20", "2000", "40", "250", "1", "Boardroom"];
  const area = ["0", "TEXT", "8", "A-AREA-IDEN", "10", "2000", "20", "1500", "40", "250", "1", "20.00 m2"];
  const text = dxf(
    ["9", "$INSUNITS", "70", "4"],
    [...line("A-WALL", 0, 0, 5_000, 0), ...line("A-DOOR", 1_000, 0, 1_900, 0), ...room, ...area, ...label, ...line("FURNITURE", 100, 100, 900, 100)]
  );
  const { plan } = importDxf(text);
  assert.equal(plan.rooms[0].name, "Boardroom");
  assert.equal(usableArea(plan), 20);
  assert.equal(plan.openings.length, 1);
  assert.equal(plan.openings[0].kind, "door");
  assert.equal(plan.openings[0].at, 1_450);
  assert.equal(plan.openings[0].width, 900);
  assert.equal(plan.reference.length, 1, "lines on other layers are kept for reference");
});

test("what cannot be read yet is listed, not silently dropped", () => {
  const text = dxf([], [...line("0", 0, 0, 1_000, 0), "0", "INSERT", "8", "FURN", "2", "DESK", "10", "0", "20", "0", "0", "ARC", "8", "0", "10", "0", "20", "0", "40", "500"]);
  const { warnings } = importDxf(text);
  assert.ok(warnings.some((w) => /units/.test(w)), "unknown units are flagged");
  assert.ok(warnings.some((w) => /block/.test(w)));
  assert.ok(warnings.some((w) => /curve/.test(w)));
  assert.ok(warnings.some((w) => /No layer is named for walls/.test(w)));
});

test("a file that is not DXF is refused", () => {
  assert.throws(() => importDxf("%PDF-1.7 binary"), /not a text DXF/);
  assert.throws(() => importDxf(dxf([], [])), /No drawing/);
});

test("partitions, notes, furniture, door swings and dimensions are exported, and partitions and notes read back", () => {
  let plan = samplePlan();
  const step = (r: EditResult) => {
    if (!r.ok) assert.fail(r.error);
    plan = r.plan;
  };
  step(updateWall(plan, plan.walls[5].id, { kind: "partition" }));
  step(addNote(plan, { x: 11_000, y: 2_000 }, "Raised floor here"));
  step(addItem(plan, "meeting-table", { x: 2_500, y: 9_700 }));
  step(addDimension(plan, { x: 0, y: 0 }, { x: 18_000, y: 0 }, plan.levels[0].id, -800));
  const text = exportDxf(plan);
  for (const layer of ["PARTITIONS", "SWINGS", "FURNITURE", "NOTES", "DIMENSIONS"]) assert.ok(text.includes(`\r\n${layer}\r\n`), layer);
  assert.ok(text.includes("\r\n18000\r\n"), "the dimension shows its length");
  const { plan: back } = importDxf(text, "sample.dxf");
  assert.equal(back.walls.filter((w) => w.kind === "partition").length, 1);
  assert.deepEqual(back.notes.map((n) => n.text), ["Raised floor here"]);
  assert.equal(back.rooms.length, plan.rooms.length, "the note does not rename a room");
});
