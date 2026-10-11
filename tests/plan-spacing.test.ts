import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPlan,
  pointAlong,
  wallLength,
  type EditResult,
  type Plan,
  type Wall,
} from "../src/lib/plan/geometry";
import { moveBy } from "../src/lib/plan/elements";
import {
  openingSpacing,
  selectionSpacing,
  setSpacing,
  snapAlignment,
  snapOpening,
  snapWallDelta,
  wallSpacing,
} from "../src/lib/plan/spacing";
import { planSchema } from "../src/lib/plan/schema";

const wall = (id: string, y: number, thickness = 100): Wall => ({
  id,
  levelId: "level-1",
  kind: "wall",
  a: { x: 0, y },
  b: { x: 8_000, y },
  thickness,
});
const ok = (r: EditResult) => {
  if (!r.ok) assert.fail(r.error);
  return r;
};
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`);
function fixture(): Plan {
  return {
    ...emptyPlan(),
    walls: [
      wall("bottom", 0, 200),
      wall("selected", 2_000),
      wall("top", 6_000, 300),
    ],
    openings: [
      { id: "previous", wallId: "bottom", kind: "door", at: 1_000, width: 800 },
      {
        id: "window",
        wallId: "bottom",
        kind: "window",
        at: 3_000,
        width: 1_200,
      },
      { id: "next", wallId: "bottom", kind: "window", at: 6_000, width: 1_000 },
    ],
  };
}

test("wall guides choose overlapping parallel walls on the same floor and measure the finished faces", () => {
  const plan = fixture();
  plan.walls.push(
    { ...wall("upstairs", 2_500), levelId: "level-2" },
    {
      ...wall("distant", 2_200),
      a: { x: 10_000, y: 2_200 },
      b: { x: 18_000, y: 2_200 },
    },
    { ...wall("crossing", 0), a: { x: 0, y: 0 }, b: { x: 0, y: 6_000 } },
  );
  const guides = wallSpacing(plan, plan.walls[1]);
  assert.equal(guides.length, 2);
  assert.equal(guides.find((g) => g.reference.id === "bottom")!.value, 1_850);
  assert.equal(guides.find((g) => g.reference.id === "top")!.value, 3_800);
  const moved = ok(
    setSpacing(
      plan,
      { kind: "wall", id: "selected" },
      guides.find((g) => g.reference.id === "bottom")!.id,
      2_500,
    ),
  );
  assert.equal(moved.plan.walls[1].a.y, 2_650);
  assert.equal(plan.walls[1].a.y, 2_000, "pure edit");
  assert.equal(
    selectionSpacing(moved.plan, { kind: "wall", id: "selected" }).find(
      (g) => g.reference.id === "bottom",
    )!.value,
    2_500,
  );
  assert.equal(
    setSpacing(plan, { kind: "wall", id: "selected" }, guides[0].id, -1).ok,
    false,
  );
  assert.equal(
    setSpacing(plan, { kind: "wall", id: "selected" }, guides[0].id, Infinity)
      .ok,
    false,
  );
  assert.equal(
    setSpacing(plan, { kind: "wall", id: "selected" }, "stale-reference", 200)
      .ok,
    false,
  );
});

test("rotated and reversed walls retain exact face distances", () => {
  const plan = fixture();
  const c = Math.cos(Math.PI / 6),
    s = Math.sin(Math.PI / 6);
  const rotate = ({ x, y }: { x: number; y: number }) => ({
    x: x * c - y * s,
    y: x * s + y * c,
  });
  plan.walls = plan.walls.map((w) => ({
    ...w,
    a: rotate(w.a),
    b: rotate(w.b),
  }));
  [plan.walls[0].a, plan.walls[0].b] = [plan.walls[0].b, plan.walls[0].a];
  const guide = wallSpacing(plan, plan.walls[1]).find(
    (g) => g.reference.id === "bottom",
  )!;
  near(guide.value, 1_850);
  const result = ok(
    setSpacing(plan, { kind: "wall", id: "selected" }, guide.id, 2_025.5),
  );
  near(wallLength(result.plan.walls[1]), 8_000);
  near(
    selectionSpacing(result.plan, { kind: "wall", id: "selected" }).find(
      (g) => g.id === guide.id,
    )!.value,
    2_025.5,
  );
});

test("a wall spacing edit moves joined geometry, preserves openings, and refuses a folded room", () => {
  const plan = fixture();
  plan.walls.push({
    ...wall("join", 0),
    a: { x: 0, y: 0 },
    b: { x: 0, y: 2_000 },
  });
  plan.rooms = [
    {
      id: "room",
      levelId: "level-1",
      name: "Room",
      usable: true,
      points: [
        { x: 0, y: 0 },
        { x: 8_000, y: 0 },
        { x: 8_000, y: 2_000 },
        { x: 0, y: 2_000 },
      ],
    },
  ];
  const guide = wallSpacing(plan, plan.walls[1]).find(
    (g) => g.reference.id === "bottom",
  )!;
  const result = ok(
    setSpacing(plan, { kind: "wall", id: "selected" }, guide.id, 1_000),
  );
  assert.equal(result.plan.walls.find((w) => w.id === "join")!.b.y, 1_150);
  assert.equal(result.plan.rooms[0].points[2].y, 1_150);
  assert.deepEqual(result.plan.openings, plan.openings);
  const above = wallSpacing(plan, plan.walls[1]).find(
    (g) => g.reference.id === "top",
  )!;
  assert.equal(
    setSpacing(plan, { kind: "wall", id: "selected" }, above.id, 5_900).ok,
    false,
    "moving through the bottom folds the room",
  );
});

test("opening guides measure jambs to wall ends and the closest neighbour edges, and exact edits preserve other geometry", () => {
  const plan = fixture(),
    target = { kind: "opening", id: "window" } as const;
  const before = JSON.stringify(plan);
  const guides = openingSpacing(plan, plan.openings[1]);
  assert.deepEqual(
    guides.map((g) => g.value),
    [2_400, 4_400, 1_000, 1_900],
  );
  for (const [index, value, expectedAt] of [
    [0, 1_500, 2_100],
    [1, 3_000, 4_400],
    [2, 300, 2_300],
    [3, 500, 4_400],
  ]) {
    const result = ok(setSpacing(plan, target, guides[index].id, value));
    assert.equal(result.plan.openings[1].at, expectedAt);
    assert.deepEqual(result.plan.walls, plan.walls);
    assert.deepEqual(result.plan.openings[0], plan.openings[0]);
    assert.deepEqual(result.plan.openings[2], plan.openings[2]);
  }
  assert.equal(
    setSpacing(plan, target, guides[0].id, 700).ok,
    false,
    "refuse neighbour overlap",
  );
  assert.equal(
    setSpacing(plan, target, guides[1].id, 8_000).ok,
    false,
    "refuse moving off host",
  );
  assert.equal(JSON.stringify(plan), before);
});

test("opening guides and edits work along a diagonal host wall", () => {
  const plan = fixture();
  plan.walls[0] = { ...wall("bottom", 0), b: { x: 4_800, y: 6_400 } };
  const target = { kind: "opening", id: "window" } as const;
  const guide = selectionSpacing(plan, target).find(
    (g) => g.reference.kind === "start",
  )!;
  near(Math.hypot(guide.b.x - guide.a.x, guide.b.y - guide.a.y), 2_400);
  const result = ok(setSpacing(plan, target, guide.id, 1_700.5));
  assert.equal(result.plan.openings[1].at, 2_300.5);
  assert.deepEqual(pointAlong(plan.walls[0], result.plan.openings[1].at), {
    x: 1_380.3,
    y: 1_840.4,
  });
});

test("opening snaps use centred/equal-gap or flush placements and never snap into another opening", () => {
  const plan = fixture(),
    opening = plan.openings[1];
  // Available slot: previous end 1400 to next start 5500; equal gaps centre is 3450.
  assert.deepEqual(snapOpening(plan, opening, 3_475, 60), {
    at: 3_450,
    snapped: true,
  });
  assert.deepEqual(snapOpening(plan, opening, 2_025, 60), {
    at: 2_000,
    snapped: true,
  });
  assert.deepEqual(snapOpening(plan, opening, 3_475, 60, false), {
    at: 3_475,
    snapped: false,
  });
  assert.deepEqual(
    snapOpening(plan, opening, 1_000, 100),
    { at: 1_000, snapped: false },
    "overlapping centres are not snap targets",
  );
  assert.deepEqual(snapOpening({ ...plan, openings: [] }, opening, 3_960, 60), {
    at: 4_000,
    snapped: true,
  });
  assert.deepEqual(
    snapOpening({ ...plan, openings: [] }, opening, -1_000, 60),
    { at: 600, snapped: false },
  );
  const snapped = snapOpening(plan, opening, 3_475, 60);
  const result = ok(
    moveBy(
      plan,
      { kind: "opening", id: opening.id },
      { x: snapped.at - opening.at, y: 0 },
    ),
  );
  assert.equal(result.plan.openings[1].at, 3_450);
});

test("alignment respects the constrained axis and excludes the drawing start and hidden furniture", () => {
  const plan = fixture();
  plan.items = [
    {
      id: "hidden",
      levelId: "level-1",
      type: "desk",
      at: { x: 8_010, y: 1_550 },
      width: 1_000,
      depth: 500,
      rotation: 0,
      hidden: true,
    },
  ];
  const result = snapAlignment(plan, { x: 7_980, y: 1_530 }, 50, { y: false });
  assert.deepEqual(result.point, { x: 8_000, y: 1_530 });
  assert.equal(result.guides.length, 1);
  const noSnap = snapAlignment(plan, { x: 10, y: 10 }, 50, {
    exclude: { x: 0, y: 0 },
  });
  assert.equal(
    noSnap.guides.every((g) => g.a.x !== 0 || g.a.y !== 0),
    true,
  );
});

test("wall dragging snaps to equal clear gaps even with different bounding wall thicknesses", () => {
  const plan = fixture();
  const delta = snapWallDelta(plan, plan.walls[1], { x: 200, y: 1_010 }, 60);
  near(delta.x, 0);
  near(delta.y, 975);
  const result = ok(moveBy(plan, { kind: "wall", id: "selected" }, delta));
  const guides = wallSpacing(result.plan, result.plan.walls[1]);
  near(guides[0].value, guides[1].value);
  const persisted = planSchema.safeParse(result.plan);
  assert.equal(persisted.success, true);
});
