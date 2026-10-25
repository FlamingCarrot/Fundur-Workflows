import { test } from "node:test";
import assert from "node:assert/strict";
import { addOpening, addRoom, addWall, emptyPlan, FIRST_LEVEL_ID, roomArea, wallLength, type EditResult, type Plan } from "../src/lib/plan/geometry";
import { addItem } from "../src/lib/plan/elements";
import { addDraft, drafts } from "../src/lib/plan/drafting";
import { stretchIn } from "../src/lib/plan/selection";
import { applyDraftOps } from "../src/lib/ai/tools/drafting";

const L = FIRST_LEVEL_ID;
const ok = (r: EditResult) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as Extract<EditResult, { ok: true }>;
};
const P = (x: number, y: number) => ({ x, y });

/** A 4 m by 3 m room with walls, a door on the bottom wall, a sofa, and a joinery line along the right. */
function room(): Plan {
  let plan = emptyPlan();
  const corners = [P(0, 0), P(4000, 0), P(4000, 3000), P(0, 3000)];
  for (let i = 0; i < 4; i++) plan = ok(addWall(plan, corners[i], corners[(i + 1) % 4], 110, L)).plan;
  plan = ok(addRoom(plan, corners, "Lounge", L)).plan;
  plan = ok(addOpening(plan, plan.walls[0].id, "door", 1000)).plan;
  plan = ok(addItem(plan, "sofa", P(3500, 1500), L)).plan;
  plan = ok(addDraft(plan, { levelId: L, shape: "line", points: [P(3600, 500), P(3600, 2500)] })).plan;
  plan = ok(addDraft(plan, { levelId: L, shape: "polyline", points: [P(500, 2500), P(3800, 2500), P(3800, 2800)] })).plan;
  return plan;
}

test("stretch moves what is in the box and stretches what crosses it", () => {
  const plan = room();
  const r = ok(stretchIn(plan, L, { minX: 3000, minY: -500, maxX: 4500, maxY: 3500 }, P(1000, 0)));
  const walls = r.plan.walls;
  // Top and bottom walls are 1 m longer; the right wall moved whole.
  assert.deepEqual(walls.map((w) => Math.round(wallLength(w))), [5000, 3000, 5000, 3000]);
  assert.equal(walls[1].a.x, 5000);
  assert.equal(roomArea(r.plan.rooms[0]), 15);
  // The door outside the box stays where it is.
  const door = r.plan.openings[0];
  assert.equal(door.at, 1000);
  // The sofa's middle is in the box, so it moves; the joinery line moves whole; the polyline stretches.
  assert.equal(r.plan.items[0].at.x, 4500);
  const [line, poly] = drafts(r.plan);
  assert.deepEqual(line.points, [P(4600, 500), P(4600, 2500)]);
  assert.deepEqual(poly.points, [P(500, 2500), P(4800, 2500), P(4800, 2800)]);
});

test("stretch keeps a door's place on the floor when the wall's start moves, and refuses an empty box", () => {
  const plan = room();
  // Box the left side: the bottom wall's start moves left; the door stays put on the floor.
  const r = ok(stretchIn(plan, L, { minX: -500, minY: -500, maxX: 200, maxY: 3500 }, P(-500, 0)));
  assert.equal(r.plan.walls[0].a.x, -500);
  assert.equal(r.plan.openings[0].at, 1500);
  assert.equal(stretchIn(plan, L, { minX: 10_000, minY: 10_000, maxX: 11_000, maxY: 11_000 }, P(100, 0)).ok, false);
  // Shrinking a wall to nothing is refused.
  assert.equal(stretchIn(plan, L, { minX: 3000, minY: -500, maxX: 4500, maxY: 3500 }, P(-4000, 0)).ok, false);
});

test("the assistant stretches through draft_on_plan", () => {
  const out = applyDraftOps(room(), L, [{ op: "stretch", from: P(3000, -500), to: P(4500, 3500), by: P(600, 0) }]);
  assert.ok(out.ok);
  if (out.ok) assert.equal(Math.round(wallLength(out.plan.walls[0])), 4600);
});

test("the tape reads an outline's area and perimeter, and where a point is", async () => {
  const { areaReading, pointReading } = await import("../src/lib/plan/tape");
  assert.equal(areaReading([P(0, 0), P(4000, 0), P(4000, 3000), P(0, 3000)]), "12.00 m², perimeter 14,000 mm");
  assert.equal(pointReading(P(1234.4, -5600)), "x 1,234, y -5,600");
});
