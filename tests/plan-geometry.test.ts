import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addColumn,
  addOpening,
  addRoom,
  addWall,
  diffPlans,
  emptyPlan,
  isSimplePolygon,
  mm,
  removeItem,
  roomArea,
  samplePlan,
  setWallLength,
  setWallThickness,
  updateOpening,
  updateRoom,
  usableArea,
  wallLength,
  type Plan,
  type Point,
} from "../src/lib/plan/geometry";

const p = (x: number, y: number): Point => ({ x, y });

/** A 4 m by 3 m room with its four walls, corners shared. */
function box(): { plan: Plan; east: string; south: string; room: string } {
  let plan = emptyPlan();
  const ids: string[] = [];
  const corners = [p(0, 0), p(4_000, 0), p(4_000, 3_000), p(0, 3_000)];
  for (let i = 0; i < 4; i++) {
    const r = addWall(plan, corners[i], corners[(i + 1) % 4]);
    assert.ok(r.ok);
    plan = r.plan;
    ids.push(r.id!);
  }
  const room = addRoom(plan, corners, "Office");
  assert.ok(room.ok);
  return { plan: room.plan, south: ids[0], east: ids[1], room: room.id! };
}

test("a room's area comes from its corners", () => {
  const { plan } = box();
  assert.equal(roomArea(plan.rooms[0]), 12);
  assert.equal(usableArea(plan), 12);
});

test("typing a wall's true length moves everything beyond it, so walls stay square and the room grows", () => {
  const { plan, south, east } = box();
  const r = setWallLength(plan, south, 5_000);
  assert.ok(r.ok, !r.ok ? r.error : "");
  const after = r.plan;
  assert.equal(wallLength(after.walls.find((w) => w.id === south)!), 5_000);
  // The east wall moved over bodily, still upright.
  const eastWall = after.walls.find((w) => w.id === east)!;
  assert.deepEqual(eastWall.a, p(5_000, 0));
  assert.deepEqual(eastWall.b, p(5_000, 3_000));
  assert.equal(r.summary, `Wall changed from ${mm(4_000)} to ${mm(5_000)}`);
  // The north wall stretched with it, and the room is now 5 m by 3 m.
  assert.equal(roomArea(after.rooms[0]), 15);
});

test("keeping the other end moves the wall's start instead, and its openings stay put in the room", () => {
  const { plan, south } = box();
  const withDoor = addOpening(plan, south, "door", 1_000);
  assert.ok(withDoor.ok);
  const r = setWallLength(withDoor.plan, south, 4_500, "b");
  assert.ok(r.ok, !r.ok ? r.error : "");
  const wall = r.plan.walls.find((w) => w.id === south)!;
  assert.deepEqual(wall.a, p(-500, 0));
  assert.deepEqual(wall.b, p(4_000, 0));
  // Measured from the new start, so 500 mm further along: the same place on the floor.
  assert.equal(r.plan.openings[0].at, 1_500);
});

test("impossible values are refused with a reason", () => {
  const { plan, south, room } = box();
  for (const bad of [0, -10, 20, Number.NaN, 400_000]) {
    const r = setWallLength(plan, south, bad);
    assert.equal(r.ok, false, `length ${bad} should be refused`);
  }
  const withDoor = addOpening(plan, south, "door", 2_000, 1_000);
  assert.ok(withDoor.ok);
  const tooShort = setWallLength(withDoor.plan, south, 2_000);
  assert.equal(tooShort.ok, false);
  assert.match(!tooShort.ok ? tooShort.error : "", /door/);

  assert.equal(setWallThickness(plan, south, 5).ok, false);
  assert.equal(addOpening(plan, south, "window", 1_000, 5_000).ok, false, "wider than the wall");
  assert.equal(updateRoom(plan, room, { name: "  " }).ok, false);
});

test("two openings cannot overlap on a wall", () => {
  const { plan, south } = box();
  const first = addOpening(plan, south, "door", 1_000, 900);
  assert.ok(first.ok);
  const second = addOpening(first.plan, south, "window", 1_500, 1_200);
  assert.equal(second.ok, false);
  const clear = addOpening(first.plan, south, "window", 3_000, 1_200);
  assert.ok(clear.ok);
  const moved = updateOpening(clear.plan, first.id!, { at: 2_800 });
  assert.equal(moved.ok, false, "moving the door onto the window is refused");
});

test("a room's outline must not cross itself", () => {
  assert.equal(isSimplePolygon([p(0, 0), p(10, 10), p(10, 0), p(0, 10)]), false);
  assert.equal(addRoom(emptyPlan(), [p(0, 0), p(2_000, 2_000), p(2_000, 0), p(0, 2_000)]).ok, false);
  assert.equal(addRoom(emptyPlan(), [p(0, 0), p(100, 0), p(100, 100)]).ok, false, "too small to name");
});

test("a door on a wall that stretches stays where it is on the floor", () => {
  const { plan, south, east } = box();
  // The north wall runs from the east corner back to the west one.
  const north = plan.walls.find((w) => w.a.x === 4_000 && w.a.y === 3_000)!;
  const door = addOpening(plan, north.id, "door", 3_000);
  assert.ok(door.ok);
  const r = setWallLength(door.plan, south, 5_000);
  assert.ok(r.ok, !r.ok ? r.error : "");
  const moved = r.plan.openings[0];
  // It was 1 m from the west end and still is, now 4 m from the moved start.
  assert.equal(moved.at, 4_000);
  assert.ok(r.plan.walls.find((w) => w.id === east));
});

test("a column on the far wall moves with it; one in the room stays", () => {
  const { plan, south } = box();
  const onWall = addColumn(plan, p(4_000, 1_500));
  assert.ok(onWall.ok);
  const inRoom = addColumn(onWall.plan, p(1_000, 1_500));
  assert.ok(inRoom.ok);
  const r = setWallLength(inRoom.plan, south, 4_500);
  assert.ok(r.ok, !r.ok ? r.error : "");
  assert.deepEqual(r.plan.columns.map((c) => c.at.x), [4_500, 1_000]);
});

test("removing a wall takes its doors and windows with it", () => {
  const { plan, south } = box();
  const withDoor = addOpening(plan, south, "door", 1_000);
  assert.ok(withDoor.ok);
  const r = removeItem(withDoor.plan, { kind: "wall", id: south });
  assert.ok(r.ok);
  assert.equal(r.plan.walls.length, 3);
  assert.equal(r.plan.openings.length, 0);
  assert.match(r.summary, /with 1 opening/);
});

test("the sample floor plate adds up", () => {
  const plan = samplePlan();
  const total = plan.rooms.reduce((sum, r) => sum + roomArea(r), 0);
  assert.equal(total, 18 * 12, "rooms tile the whole 18 m by 12 m shell");
  assert.equal(usableArea(plan), 18 * 12 - 20, "the core does not count");
});

test("comparing two versions lists what changed and each room's area", () => {
  const { plan, south } = box();
  const r = setWallLength(plan, south, 5_000);
  assert.ok(r.ok);
  const diff = diffPlans(plan, r.plan);
  assert.equal(diff.walls.changed, 3, "the wall, the wall across from it, and the one between");
  assert.deepEqual(diff.rooms, [{ name: "Office", before: 12, after: 15 }]);
  assert.equal(diff.usableBefore, 12);
  assert.equal(diff.usableAfter, 15);
});
