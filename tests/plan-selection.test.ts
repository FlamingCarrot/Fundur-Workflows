import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem, addLevel } from "../src/lib/plan/elements";
import { addOpening, addWall, emptyPlan, type EditResult, type Plan, type Point } from "../src/lib/plan/geometry";
import {
  alignMany,
  copyOut,
  describeSelection,
  distributeMany,
  duplicateMany,
  inBox,
  mirrorMany,
  moveMany,
  pasteIn,
  removeMany,
  rotateMany,
  toggle,
} from "../src/lib/plan/selection";

const p = (x: number, y: number): Point => ({ x, y });

function ok(r: EditResult): Extract<EditResult, { ok: true }> {
  if (!r.ok) assert.fail(r.error);
  return r;
}

/** Three walls in a U, 4 m wide and 3 m deep, with a door in the back wall, and two desks. */
function room() {
  let plan: Plan = emptyPlan();
  const left = ok(addWall(plan, p(0, 0), p(0, 3_000)));
  plan = left.plan;
  const back = ok(addWall(plan, p(0, 3_000), p(4_000, 3_000)));
  plan = back.plan;
  const right = ok(addWall(plan, p(4_000, 3_000), p(4_000, 0)));
  plan = right.plan;
  const door = ok(addOpening(plan, back.id!, "door", 2_000));
  plan = door.plan;
  const d1 = ok(addItem(plan, "desk", p(1_000, 1_000)));
  plan = d1.plan;
  const d2 = ok(addItem(plan, "desk", p(3_000, 1_400)));
  plan = d2.plan;
  return { plan, left: left.id!, back: back.id!, right: right.id!, door: door.id!, d1: d1.id!, d2: d2.id! };
}

test("ctrl-click toggles things in and out of the selection", () => {
  const a = { kind: "item" as const, id: "a" };
  const sel = toggle(toggle([], a), { kind: "wall", id: "w" });
  assert.equal(sel.length, 2);
  assert.deepEqual(toggle(sel, a), [{ kind: "wall", id: "w" }]);
});

test("a window box takes what is wholly inside; a crossing box also takes what it touches", () => {
  const r = room();
  const box = { minX: -100, minY: -100, maxX: 2_100, maxY: 3_100 };
  const window = inBox(r.plan, "level-1", box, false);
  assert.deepEqual(window.map((t) => t.id).sort(), [r.left, r.d1].sort());
  const crossing = inBox(r.plan, "level-1", box, true);
  assert.deepEqual(crossing.map((t) => t.id).sort(), [r.left, r.back, r.door, r.d1].sort());
  // Only the kinds that are shown are picked.
  assert.deepEqual(inBox(r.plan, "level-1", box, true, new Set(["item"])).map((t) => t.id), [r.d1]);
  // A small box inside a desk takes the desk.
  assert.deepEqual(inBox(r.plan, "level-1", { minX: 990, minY: 990, maxX: 1_010, maxY: 1_010 }, true).map((t) => t.id), [r.d1]);
});

test("several things move together, and walls joined to them stretch to stay joined", () => {
  const r = room();
  const moved = ok(moveMany(r.plan, [{ kind: "wall", id: r.back }, { kind: "item", id: r.d1 }], p(0, 500)));
  const back = moved.plan.walls.find((w) => w.id === r.back)!;
  const left = moved.plan.walls.find((w) => w.id === r.left)!;
  assert.deepEqual([back.a, back.b], [p(0, 3_500), p(4_000, 3_500)]);
  assert.deepEqual(left.b, p(0, 3_500));
  assert.deepEqual(moved.plan.items.find((i) => i.id === r.d1)!.at, p(1_000, 1_500));
  // The door rides along with its wall.
  assert.equal(moved.plan.openings[0].at, 2_000);
  assert.match(moved.summary, /moved 500 mm/);
});

test("copies are new things, set off, and a copied wall takes its door", () => {
  const r = room();
  const copy = ok(duplicateMany(r.plan, [{ kind: "wall", id: r.back }, { kind: "item", id: r.d2 }], p(0, 2_000)));
  assert.equal(copy.plan.walls.length, 4);
  assert.equal(copy.plan.openings.length, 2);
  assert.equal(copy.created!.length, 2);
  const newWall = copy.plan.walls.find((w) => w.id === copy.created!.find((t) => t.kind === "wall")!.id)!;
  assert.deepEqual(newWall.a, p(0, 5_000));
  assert.equal(copy.plan.openings[1].wallId, newWall.id);
  assert.equal(copy.summary, "1 × Wall, 1 × Desk copied");
  // A door on its own is not copied without its wall.
  assert.equal(duplicateMany(r.plan, [{ kind: "opening", id: r.door }]).ok, false);
});

test("pasting onto another floor puts the copies on that floor", () => {
  const r = room();
  const upstairs = ok(addLevel(r.plan));
  const clip = copyOut(upstairs.plan, [{ kind: "item", id: r.d1 }, { kind: "wall", id: r.left }]);
  const pasted = ok(pasteIn(upstairs.plan, clip, upstairs.id!, p(0, 0)));
  assert.ok(pasted.plan.items.filter((i) => i.levelId === upstairs.id).length === 1);
  assert.ok(pasted.plan.walls.filter((w) => w.levelId === upstairs.id).length === 1);
});

test("turning and mirroring a group works about its middle; mirrored doors keep opening the same way", () => {
  const r = room();
  const desks = [{ kind: "item" as const, id: r.d1 }, { kind: "item" as const, id: r.d2 }];
  const turned = ok(rotateMany(r.plan, desks, 90));
  const [a, b] = turned.plan.items;
  // The box round both desks is centred on (2000, 1200).
  assert.deepEqual([Math.round(a.at.x), Math.round(a.at.y)], [2_200, 200]);
  assert.deepEqual([Math.round(b.at.x), Math.round(b.at.y)], [1_800, 2_200]);
  assert.equal(a.rotation, 90);

  const all = [{ kind: "wall" as const, id: r.left }, { kind: "wall" as const, id: r.back }, { kind: "wall" as const, id: r.right }];
  const flipped = ok(mirrorMany(r.plan, all, "up-down"));
  const back = flipped.plan.walls.find((w) => w.id === r.back)!;
  assert.equal(back.a.y, 0);
  assert.equal(flipped.plan.openings[0].side, -1);
});

test("furniture lines up on an edge and spaces out evenly", () => {
  const r = room();
  const { d1, d2 } = r;
  let plan = r.plan;
  const d3 = ok(addItem(plan, "desk", p(1_800, 2_000)));
  plan = d3.plan;
  const three = [d1, d2, d3.id!].map((id) => ({ kind: "item" as const, id }));
  const lined = ok(alignMany(plan, three, "bottom"));
  assert.deepEqual(lined.plan.items.map((i) => i.at.y), [1_000, 1_000, 1_000]);
  const spaced = ok(distributeMany(lined.plan, three, "across"));
  const xs = spaced.plan.items.map((i) => i.at.x).sort((x, y) => x - y);
  assert.equal(xs[1] - xs[0], xs[2] - xs[1]);
  assert.equal(alignMany(plan, three.slice(0, 1), "left").ok, false);
});

test("removing a selection takes walls with their doors, and says what went", () => {
  const r = room();
  const sel = [{ kind: "wall" as const, id: r.back }, { kind: "opening" as const, id: r.door }, { kind: "item" as const, id: r.d1 }];
  assert.equal(describeSelection(r.plan, sel), "1 × Wall, 1 × Door, 1 × Desk");
  const gone = ok(removeMany(r.plan, sel));
  assert.equal(gone.plan.walls.length, 2);
  assert.equal(gone.plan.openings.length, 0);
  assert.equal(gone.plan.items.length, 1);
  assert.match(gone.summary, /removed$/);
});
