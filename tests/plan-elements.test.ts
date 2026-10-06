import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addItem,
  addLevel,
  addNote,
  calibrateUnderlay,
  copyLevel,
  duplicate,
  enclosureAt,
  moveBy,
  removeLevel,
  roomAt,
  rotateItem,
  setUnderlay,
  updateItem,
  updateLevel,
  updateWall,
  wallHeight,
} from "../src/lib/plan/elements";
import { LIBRARY, libraryItem } from "../src/lib/plan/library";
import {
  addWall,
  emptyPlan,
  itemName,
  m2,
  mm,
  normalizePlan,
  onLevel,
  polygonArea,
  removeItem,
  samplePlan,
  setWallLength,
  updateOpening,
  wallLength,
  type EditResult,
  type Plan,
  type Point,
} from "../src/lib/plan/geometry";

const p = (x: number, y: number): Point => ({ x, y });

function ok(r: EditResult): Extract<EditResult, { ok: true }> {
  if (!r.ok) assert.fail(r.error);
  return r;
}

test("every library item has a name, a size and a drawing", () => {
  const types = new Set<string>();
  for (const item of LIBRARY) {
    assert.ok(!types.has(item.type), `duplicate ${item.type}`);
    types.add(item.type);
    assert.ok(item.width > 0 && item.depth > 0 && item.height > 0);
    assert.ok(item.draw(item.width, item.depth).length > 0);
  }
  assert.equal(libraryItem("no-such-thing").type, "box");
});

test("furniture is placed, resized, turned, copied and named in the log", () => {
  let plan = emptyPlan();
  const placed = ok(addItem(plan, "desk", p(1_000, 1_000)));
  plan = placed.plan;
  assert.equal(placed.summary, "Desk placed");
  const id = placed.id!;
  const resized = ok(updateItem(plan, id, { width: 1_400, label: "D12" }));
  assert.ok(resized.summary.includes(`${mm(1_400)} by ${mm(800)}`));
  assert.match(resized.summary, /labelled "D12"/);
  plan = resized.plan;
  assert.equal(itemName(plan.items[0]), "Desk D12");
  plan = ok(rotateItem(plan, { kind: "item", id })).plan;
  plan = ok(rotateItem(plan, { kind: "item", id }, 300)).plan;
  assert.equal(plan.items[0].rotation, 30);
  assert.equal(updateItem(plan, id, { width: 0 }).ok, false);
  const copy = ok(duplicate(plan, { kind: "item", id }));
  assert.equal(copy.plan.items.length, 2);
  assert.deepEqual(copy.plan.items[1].at, p(1_500, 500));
  plan = ok(removeItem(copy.plan, { kind: "item", id })).plan;
  assert.equal(plan.items.length, 1);
});

test("dragging moves furniture freely, slides a door along its wall, and moves a wall square to itself", () => {
  let plan = samplePlan();
  plan = ok(addItem(plan, "sofa", p(10_000, 3_000))).plan;
  const sofa = plan.items[0].id;
  plan = ok(moveBy(plan, { kind: "item", id: sofa }, p(250, -100))).plan;
  assert.deepEqual(plan.items[0].at, p(10_250, 2_900));

  const door = plan.openings.find((o) => o.kind === "door" && o.width === 1_800)!;
  const slid = ok(moveBy(plan, { kind: "opening", id: door.id }, p(500, 300)));
  assert.equal(slid.plan.openings.find((o) => o.id === door.id)!.at, door.at + 500);
  assert.equal(moveBy(plan, { kind: "opening", id: door.id }, p(9_000, 0)).ok, false, "a door cannot slide off its wall");

  // The meeting room's east wall moves 500 east: the walls joined to it stretch, the meeting room grows.
  const east = plan.walls.find((w) => w.a.x === 5_000 && w.b.x === 5_000)!;
  const meeting = plan.rooms.find((r) => r.name === "Meeting room")!;
  const moved = ok(moveBy(plan, { kind: "wall", id: east.id }, p(500, 40)));
  const after = moved.plan.rooms.find((r) => r.id === meeting.id)!;
  assert.equal(polygonArea(after.points) / 1e6, 5.5 * 4.5);
  assert.equal(moved.summary, `Wall moved ${mm(500)} sideways`);
});

test("a wall can be made a partition and given its own height", () => {
  let plan = samplePlan();
  const wall = plan.walls[5];
  plan = ok(updateWall(plan, wall.id, { kind: "partition", height: 1_200 })).plan;
  const changed = plan.walls.find((w) => w.id === wall.id)!;
  assert.equal(changed.kind, "partition");
  assert.equal(wallHeight(plan, changed), 1_200);
  plan = ok(updateWall(plan, wall.id, { height: null })).plan;
  assert.equal(wallHeight(plan, plan.walls.find((w) => w.id === wall.id)!), 2_700);
  assert.equal(updateWall(plan, wall.id, { height: 10 }).ok, false);
});

test("door options are kept and logged", () => {
  const plan = samplePlan();
  const door = plan.openings.find((o) => o.kind === "door")!;
  const r = ok(updateOpening(plan, door.id, { style: "double", hinge: "end", side: -1 }));
  assert.match(r.summary, /now a double door/);
  assert.match(r.summary, /hinged on the other side/);
  assert.match(r.summary, /opens the other way/);
  const updated = r.plan.openings.find((o) => o.id === door.id)!;
  assert.equal(updated.style, "double");
  assert.equal(updateOpening(plan, door.id, { height: 50 }).ok, false);
});

test("floors: added above, copied with their walls, edited separately, removed with what is on them", () => {
  let plan = samplePlan();
  const ground = plan.levels[0].id;
  const copied = ok(copyLevel(plan, ground));
  plan = copied.plan;
  const first = copied.id!;
  assert.equal(plan.levels.length, 2);
  assert.equal(plan.levels[1].elevation, 2_700);
  assert.equal(onLevel(plan, first).walls.length, onLevel(plan, ground).walls.length);
  assert.equal(onLevel(plan, first).openings.length, onLevel(plan, ground).openings.length);
  assert.equal(onLevel(plan, first).rooms.length, 0, "rooms are not copied; each floor's are its own");

  // Lengthening a wall on the new floor leaves the ground floor as it was.
  const south = onLevel(plan, first).walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  const groundBefore = JSON.stringify(onLevel(plan, ground).walls);
  plan = ok(setWallLength(plan, south.id, 19_000)).plan;
  assert.equal(JSON.stringify(onLevel(plan, ground).walls), groundBefore);
  assert.equal(wallLength(plan.walls.find((w) => w.id === south.id)!), 19_000);

  plan = ok(updateLevel(plan, first, { name: "First floor", height: 3_000 })).plan;
  plan = ok(addNote(plan, p(1_000, 1_000), "Check the riser", first)).plan;
  const removed = ok(removeLevel(plan, first));
  assert.equal(removed.plan.levels.length, 1);
  assert.equal(removed.plan.notes.length, 0);
  assert.equal(removed.plan.walls.length, onLevel(plan, ground).walls.length);
  assert.equal(removeLevel(removed.plan, ground).ok, false, "the last floor stays");
  assert.equal(ok(addLevel(removed.plan)).plan.levels.length, 2);
});

test("a plan saved before floors existed opens on the ground floor", () => {
  const old = {
    version: 1 as const,
    walls: [{ id: "w", a: p(0, 0), b: p(1_000, 0), thickness: 110 }],
    openings: [],
    columns: [],
    rooms: [],
    reference: [],
  };
  const plan = normalizePlan(old);
  assert.equal(plan.levels.length, 1);
  assert.equal(plan.walls[0].levelId, plan.levels[0].id);
  assert.equal(plan.walls[0].kind, "wall");
  assert.deepEqual(plan.items, []);
});

test("a room is found from the walls around a click", () => {
  const plan = samplePlan();
  const level = plan.levels[0].id;
  const meeting = enclosureAt(plan, p(2_000, 9_000), level)!;
  assert.equal(polygonArea(meeting) / 1e6, 22.5);
  const open = enclosureAt(plan, p(3_000, 3_000), level)!;
  assert.equal(open.length, 8);
  assert.equal(polygonArea(open) / 1e6, 18 * 12 - 22.5 - 15.75 - 20);
  const refused = roomAt(plan, p(2_000, 9_000), level);
  assert.equal(refused.ok, false, "the meeting room is already there");

  // An open-ended room cannot be closed by clicking.
  let gappy: Plan = emptyPlan();
  for (const [a, b] of [
    [p(0, 0), p(4_000, 0)],
    [p(4_000, 0), p(4_000, 3_000)],
    [p(4_000, 3_000), p(0, 3_000)],
  ]) {
    gappy = ok(addWall(gappy, a, b)).plan;
  }
  assert.equal(enclosureAt(gappy, p(2_000, 1_500), gappy.levels[0].id), null);
  gappy = ok(addWall(gappy, p(0, 3_000), p(0, 0))).plan;
  const found = ok(roomAt(gappy, p(2_000, 1_500), gappy.levels[0].id));
  assert.ok(found.summary.endsWith(m2(12)));
});

test("a tracing image is scaled by two picked points and a true distance", () => {
  let plan = emptyPlan();
  const level = plan.levels[0].id;
  plan = ok(setUnderlay(plan, { levelId: level, name: "scan.png", at: p(0, 0), width: 1_000, pixelWidth: 2_000, pixelHeight: 1_000, opacity: 0.5 })).plan;
  // The picked line is 100 mm on the unscaled image; it is truly 5 000 mm.
  plan = ok(calibrateUnderlay(plan, level, p(100, 100), p(200, 100), 5_000)).plan;
  assert.equal(plan.underlays[0].width, 50_000);
  assert.deepEqual(plan.underlays[0].at, p(100 - 100 * 50, 100 - 100 * 50));
});
