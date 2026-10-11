import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyPlan,
  planBounds,
  type Plan,
  type Wall,
  type Opening,
} from "../src/lib/plan/geometry";
import { replaceItemType } from "../src/lib/plan/elements";
import {
  buildScene,
  wallPieces,
  type SceneOptions,
} from "../src/lib/plan/scene";

const wall: Wall = {
  id: "wall",
  levelId: "level-1",
  a: { x: 0, y: 0 },
  b: { x: 6_000, y: 0 },
  thickness: 200,
  kind: "wall",
};
const door: Opening = {
  id: "door",
  wallId: "wall",
  kind: "door",
  at: 1_500,
  width: 1_000,
  height: 2_100,
};
const window: Opening = {
  id: "window",
  wallId: "wall",
  kind: "window",
  at: 4_000,
  width: 2_000,
  height: 1_200,
  sill: 900,
};
const options: SceneOptions = {
  levelId: "level-1",
  allLevels: true,
  separated: false,
  cutWalls: false,
  layers: {
    walls: true,
    openings: true,
    columns: true,
    rooms: true,
    furniture: true,
  },
};
const area = (pieces: ReturnType<typeof wallPieces>) =>
  pieces.reduce((sum, p) => sum + (p.to - p.from) * (p.top - p.bottom), 0);

test("wall solids leave real door and window holes, with intact sill and lintel", () => {
  const pieces = wallPieces(wall, [door, window], 2_700);
  assert.equal(area(pieces), 6_000 * 2_700 - 1_000 * 2_100 - 2_000 * 1_200);
  const inWindow = pieces.filter((p) => p.from === 3_000 && p.to === 5_000);
  assert.deepEqual(
    inWindow.map((p) => [p.bottom, p.top]),
    [
      [0, 900],
      [2_100, 2_700],
    ],
  );
  const inDoor = pieces.filter((p) => p.from === 1_000 && p.to === 2_000);
  assert.deepEqual(
    inDoor.map((p) => [p.bottom, p.top]),
    [[2_100, 2_700]],
  );
});

test("cutaway clips openings correctly and overlapping holes do not duplicate solids", () => {
  assert.equal(
    area(wallPieces(wall, [door, window], 1_100)),
    6_000 * 1_100 - 1_000 * 1_100 - 2_000 * 200,
  );
  const touching = { ...door, id: "other", at: 2_000 };
  assert.equal(
    area(wallPieces(wall, [door, touching], 2_700)),
    6_000 * 2_700 - 1_500 * 2_100,
  );
  assert.deepEqual(wallPieces({ ...wall, b: wall.a }, [], 2_700), []);
  const tooHigh = { ...window, sill: 3_000 };
  assert.equal(area(wallPieces(wall, [tooHigh], 2_700)), 6_000 * 2_700);
});

function building(): Plan {
  const plan = emptyPlan();
  plan.levels.push({
    id: "upper",
    name: "Upper floor",
    elevation: 3_200,
    height: 3_000,
  });
  plan.walls = [
    wall,
    {
      ...wall,
      id: "upper-wall",
      levelId: "upper",
      a: { x: 0, y: 0 },
      b: { x: 0, y: 6_000 },
    },
  ];
  plan.openings = [door, window];
  plan.columns = [
    {
      id: "round",
      levelId: "upper",
      at: { x: 0, y: 0 },
      width: 400,
      depth: 800,
      round: true,
    },
  ];
  plan.rooms = [
    {
      id: "room",
      levelId: "level-1",
      name: "Room",
      usable: true,
      points: [
        { x: 0, y: 0 },
        { x: 6_000, y: 0 },
        { x: 6_000, y: 6_000 },
        { x: 0, y: 6_000 },
      ],
    },
  ];
  plan.items = [
    {
      id: "seat",
      levelId: "upper",
      type: "armchair",
      at: { x: 2_000, y: 3_000 },
      width: 900,
      depth: 800,
      rotation: 90,
      label: "S1",
    },
  ];
  return plan;
}

test("scene keeps millimetre dimensions, CAD orientation, floor elevations and selection identity", () => {
  const plan = building(),
    copy = JSON.stringify(plan);
  const { solids, origin } = buildScene(plan, options);
  const upper = solids.find((s) => s.target.id === "upper-wall")!;
  assert.deepEqual(upper.size, [6, 3, 0.2]);
  assert.equal(upper.at[1], 4.7);
  assert.equal(upper.rotation, Math.PI / 2);
  assert.equal(upper.at[0], -origin.x / 1_000);
  const column = solids.find((s) => s.target.id === "round")!;
  assert.equal(column.shape, "cylinder");
  assert.equal(column.size[0], column.size[2]);
  const floor = solids.find((s) => s.target.id === "room")!;
  assert.equal(floor.at[1] + floor.size[1], 0);
  const chair = solids.filter((s) => s.target.id === "seat");
  assert.ok(chair.length >= 3);
  assert.ok(
    chair.every(
      (s) =>
        s.target.kind === "item" &&
        s.levelId === "upper" &&
        s.rotation === Math.PI / 2,
    ),
  );
  assert.equal(
    JSON.stringify(plan),
    copy,
    "rendering must not mutate saved geometry",
  );
});

test("floor isolation, separated floors and hidden layers affect only the view", () => {
  const plan = building();
  assert.ok(
    buildScene(plan, { ...options, allLevels: false }).solids.every(
      (s) => s.levelId === "level-1",
    ),
  );
  const upper = buildScene(plan, { ...options, separated: true }).solids.find(
    (s) => s.target.id === "upper-wall",
  )!;
  assert.equal(upper.at[1], 7.7);
  const cut = buildScene(plan, { ...options, cutWalls: true }).solids.find(
    (s) => s.target.id === "upper-wall",
  )!;
  assert.equal(cut.size[1], 1.1);
  const hidden = buildScene(plan, {
    ...options,
    layers: { ...options.layers, furniture: false, openings: false },
  }).solids;
  assert.ok(
    hidden.every(
      (s) => s.target.kind !== "item" && s.target.kind !== "opening",
    ),
  );
});

test("swapping furniture retains placement and identity, with optional default dimensions", () => {
  const plan = building(),
    original = plan.items[0];
  const swap = replaceItemType(plan, original.id, "sofa");
  assert.ok(swap.ok);
  assert.deepEqual(swap.plan.items[0], { ...original, type: "sofa" });
  const sized = replaceItemType(swap.plan, original.id, "sofa", true);
  assert.ok(sized.ok);
  assert.notEqual(sized.plan.items[0].width, original.width);
  assert.deepEqual(sized.plan.items[0].at, original.at);
  assert.equal(replaceItemType(plan, original.id, "unknown").ok, false);
  assert.equal(replaceItemType(plan, "missing", "sofa").ok, false);
});

test("large CAD reference sets have bounds without overflowing the JavaScript argument limit", () => {
  const plan = emptyPlan();
  plan.reference = Array.from({ length: 90_000 }, (_, i) => ({
    a: { x: i, y: -i },
    b: { x: i + 1, y: 2 },
    layer: "CAD",
  }));
  assert.deepEqual(planBounds(plan), {
    minX: 0,
    minY: -89_999,
    maxX: 90_000,
    maxY: 2,
  });
  assert.equal(planBounds(emptyPlan()), null);
});

test("2D annotations do not move the 3D building origin", () => {
  const plan = building();
  const before = buildScene(plan, options);
  plan.notes.push({
    id: "far",
    levelId: "level-1",
    at: { x: 500_000, y: 500_000 },
    text: "Working note",
  });
  assert.deepEqual(buildScene(plan, options), before);
});
