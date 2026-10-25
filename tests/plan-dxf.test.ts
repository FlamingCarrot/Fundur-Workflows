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
  const text = dxf([], [...line("0", 0, 0, 1_000, 0), "0", "INSERT", "8", "FURN", "2", "DESK", "10", "0", "20", "0", "0", "ARC", "8", "0", "10", "0", "20", "0", "40", "500", "50", "0", "51", "90"]);
  const { warnings, plan } = importDxf(text);
  assert.ok(warnings.some((w) => /units/.test(w)), "unknown units are flagged");
  assert.ok(warnings.some((w) => /block/.test(w)));
  assert.deepEqual(plan.drafts?.map((d) => d.shape), ["arc"], "an arc comes in as a drawn arc");
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

test("curved polyline segments keep a room's true shape, and curved walls are kept for reference with a note", () => {
  const room = [
    "0", "LWPOLYLINE", "8", "A-AREA", "90", "4", "70", "1",
    "10", "0", "20", "0", "10", "4000", "20", "0", "10", "4000", "20", "2000", "42", "1", "10", "0", "20", "2000",
  ];
  const curvedWall = ["0", "LWPOLYLINE", "8", "A-WALL", "90", "2", "70", "0", "10", "0", "20", "6000", "42", "0.5", "10", "4000", "20", "6000"];
  const text = dxf(["9", "$INSUNITS", "70", "4"], [...room, ...curvedWall, ...line("A-WALL", 0, 0, 4_000, 0)]);
  const { plan, warnings } = importDxf(text);
  const area = roomArea(plan.rooms[0]);
  const truth = 8 + (Math.PI * 2 * 2) / 2;
  assert.ok(Math.abs(area - truth) / truth < 0.005, `room area ${area} close to ${truth}`);
  assert.equal(plan.walls.length, 1, "the curved wall is not made a straight wall");
  assert.ok(plan.reference.length > 4);
  assert.ok(warnings.some((w) => /curved/.test(w)));
});

test("line work, text, curves and dimensions on other layers come in as drawn shapes on drawing layers", async () => {
  const { drafts, drawingLayers, dimensionLabel } = await import("../src/lib/plan/drafting");
  const tables = [
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER",
    "0", "LAYER", "2", "A-FLOR-PATT", "70", "0", "62", "5", "6", "DASHED2",
    "0", "LAYER", "2", "A-CLNG", "70", "4", "62", "-3", "6", "CONTINUOUS",
    "0", "ENDTAB", "0", "ENDSEC",
  ];
  const entities = [
    ...line("A-WALL", 0, 0, 6_000, 0),
    ...line("A-FLOR-PATT", 0, 500, 6_000, 500),
    "0", "LWPOLYLINE", "8", "A-FLOR-PATT", "90", "2", "70", "1", "10", "1000", "20", "1000", "42", "1", "10", "2000", "20", "1000", "42", "1",
    "0", "CIRCLE", "8", "A-CLNG", "10", "3000", "20", "3000", "40", "300",
    "0", "TEXT", "8", "A-ANNO", "10", "100", "20", "2000", "40", "200", "1", "Feature wall",
    "0", "MTEXT", "8", "A-ANNO", "10", "100", "20", "4000", "40", "100", "1", "Line one\\PLine two",
    "0", "DIMENSION", "8", "A-DIMS", "70", "0", "10", "3000", "20", "-800", "13", "0", "23", "0", "14", "6000", "24", "0", "50", "0",
    "0", "SPLINE", "8", "A-FURN", "70", "0", "11", "0", "21", "5000", "11", "1000", "21", "5500", "11", "2000", "21", "5000",
  ];
  const text = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC", ...tables, "0", "SECTION", "2", "ENTITIES", ...entities, "0", "ENDSEC", "0", "EOF"].join("\n");
  const { plan, warnings } = importDxf(text);
  assert.equal(plan.walls.length, 1);
  assert.equal(plan.reference.length, 0);
  const shapes = drafts(plan);
  assert.deepEqual(shapes.map((d) => d.shape), ["line", "polyline", "circle", "dimension", "polyline", "text", "text"]);
  const layers = drawingLayers(plan);
  const patt = layers.find((l) => l.name === "A-FLOR-PATT")!;
  assert.equal(patt.linetype, "dashed");
  assert.equal(patt.color, "#1e4fd8");
  const clng = layers.find((l) => l.name === "A-CLNG")!;
  assert.equal(clng.hidden, true);
  assert.equal(clng.locked, true);
  assert.equal(shapes[1].closed, true);
  assert.deepEqual(shapes[1].bulges, [1, 1]);
  assert.equal(dimensionLabel(shapes[3]), "6000");
  assert.equal(shapes[5].text, "Feature wall");
  assert.equal(shapes[5].height, 200);
  assert.ok(warnings.some((w) => /spline/.test(w)));
});

test("drawn shapes round-trip through the app's own DXF", async () => {
  const { addDraft, drafts, drawingLayers } = await import("../src/lib/plan/drafting");
  let plan = samplePlan();
  const L = plan.levels[0].id;
  const add = (d: Parameters<typeof addDraft>[1]) => {
    const r = addDraft(plan, d);
    if (!r.ok) assert.fail(r.error);
    plan = r.plan;
  };
  add({ levelId: L, shape: "line", points: [{ x: 500, y: 500 }, { x: 2500, y: 500 }], layer: "joinery" });
  add({ levelId: L, shape: "circle", points: [{ x: 9000, y: 6000 }], radius: 600, layer: "ceiling" });
  add({ levelId: L, shape: "arc", points: [{ x: 9000, y: 6000 }], radius: 900, start: 0, end: 90 });
  add({ levelId: L, shape: "polyline", points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }], bulges: [0, 0.5] });
  add({ levelId: L, shape: "text", points: [{ x: 600, y: 1300 }], text: "Oak bench", height: 200 });
  const { plan: back, warnings } = importDxf(exportDxf(plan), "sample.dxf");
  assert.deepEqual(warnings, []);
  assert.equal(back.walls.length, plan.walls.length);
  const shapes = drafts(back);
  assert.deepEqual(shapes.map((d) => d.shape).sort(), ["arc", "circle", "line", "polyline", "text"]);
  assert.equal(shapes.find((d) => d.shape === "line")!.layer, "joinery");
  assert.equal(shapes.find((d) => d.shape === "circle")!.layer, "ceiling");
  assert.deepEqual(shapes.find((d) => d.shape === "polyline")!.bulges, [0, 0.5]);
  assert.equal(drawingLayers(back).find((l) => l.id === "ceiling")!.linetype, "dashed");
});
