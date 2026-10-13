import { test } from "node:test";
import { isPinned, pinMany, pinViolation } from "../src/lib/plan/pins";
import { meetWall, snapPoint } from "../src/lib/plan/snaps";
import { offsetWall, splitWall, trimToCorner } from "../src/lib/plan/wall-tools";
import { planSchema } from "../src/lib/plan/schema";
import assert from "node:assert/strict";
import { addItem, addLevel } from "../src/lib/plan/elements";
import { addOpening, addWall, emptyPlan, FIRST_LEVEL_ID, type EditResult, type Plan, type Point } from "../src/lib/plan/geometry";
import {
  arrayMany,
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

test("mirroring part of a joined outline leaves the walls it joins where they are", () => {
  let plan = emptyPlan();
  const a = addWall(plan, { x: 0, y: 0 }, { x: 4_000, y: 0 }, 100, FIRST_LEVEL_ID);
  assert.ok(a.ok);
  plan = a.plan;
  const b = addWall(plan, { x: 4_000, y: 0 }, { x: 4_000, y: 3_000 }, 100, FIRST_LEVEL_ID);
  assert.ok(b.ok);
  plan = b.plan;
  const c = addWall(plan, { x: 4_000, y: 3_000 }, { x: 2_000, y: 3_000 }, 100, FIRST_LEVEL_ID);
  assert.ok(c.ok);
  plan = c.plan;
  // Mirroring the last two walls across their middle would fold the first wall to nothing if it stretched.
  const r = mirrorMany(plan, [{ kind: "wall", id: b.id! }, { kind: "wall", id: c.id! }], "left-right");
  assert.ok(r.ok, r.ok ? "" : r.error);
  const first = r.plan.walls.find((w) => w.id === a.id)!;
  assert.deepEqual([first.a, first.b], [{ x: 0, y: 0 }, { x: 4_000, y: 0 }]);
  const moved = r.plan.walls.find((w) => w.id === b.id)!;
  assert.equal(moved.a.x, 2_000);
});

test("array makes a row of copies, side by side or at a given step", () => {
  let plan = emptyPlan();
  const r = addItem(plan, "desk", { x: 1000, y: 1000 }, FIRST_LEVEL_ID);
  assert.ok(r.ok);
  plan = r.plan;
  const desk = plan.items[0];
  const row = arrayMany(plan, [{ kind: "item", id: desk.id }], 4, { axis: "across", gap: 100 });
  assert.ok(row.ok);
  assert.equal(row.plan.items.length, 4);
  assert.equal(row.created?.length, 3);
  const xs = row.plan.items.map((i) => i.at.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 1, 2, 3].map((k) => 1000 + k * (desk.width + 100)));
  const up = arrayMany(plan, [{ kind: "item", id: desk.id }], 3, { x: 0, y: 2000 });
  assert.ok(up.ok);
  assert.deepEqual(up.plan.items.map((i) => i.at.y).sort((a, b) => a - b), [1000, 3000, 5000]);
  assert.equal(arrayMany(plan, [{ kind: "item", id: desk.id }], 1, { x: 1000, y: 0 }).ok, false);
  assert.equal(arrayMany(plan, [{ kind: "item", id: desk.id }], 3, { x: 0, y: 0 }).ok, false);
  assert.equal(arrayMany(plan, [], 3, { axis: "up" }).ok, false);
});

test("pinned things cannot be moved or removed until unpinned, and copies start unpinned", () => {
  let plan = emptyPlan();
  const w = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, 110, FIRST_LEVEL_ID);
  assert.ok(w.ok);
  plan = w.plan;
  const d = addItem(plan, "desk", { x: 1000, y: 1000 }, FIRST_LEVEL_ID);
  assert.ok(d.ok);
  plan = d.plan;
  const wall = { kind: "wall" as const, id: plan.walls[0].id };
  const desk = { kind: "item" as const, id: plan.items[0].id };
  const pinned = pinMany(plan, [wall, desk], true);
  assert.ok(pinned.ok);
  assert.ok(isPinned(pinned.plan, wall) && isPinned(pinned.plan, desk));
  assert.ok(planSchema.safeParse(pinned.plan).success);
  assert.ok(planSchema.parse(pinned.plan).walls[0].pinned);
  const moved = moveMany(pinned.plan, [wall, desk], { x: 100, y: 0 });
  assert.ok(moved.ok);
  assert.match(pinViolation(pinned.plan, moved.plan) ?? "", /pinned/);
  const gone = removeMany(pinned.plan, [desk]);
  assert.ok(gone.ok);
  assert.ok(pinViolation(pinned.plan, gone.plan));
  const copied = duplicateMany(pinned.plan, [wall, desk]);
  assert.ok(copied.ok);
  assert.equal(pinViolation(pinned.plan, copied.plan), null);
  assert.equal(copied.plan.items.filter((i) => i.pinned).length, 1);
  const unpinned = pinMany(pinned.plan, [wall, desk], false);
  assert.ok(unpinned.ok);
  const free = moveMany(unpinned.plan, [wall, desk], { x: 100, y: 0 });
  assert.ok(free.ok);
  assert.equal(pinViolation(unpinned.plan, free.plan), null);
  assert.equal(pinMany(plan, [{ kind: "note", id: "x" }], true).ok, false);
});

test("snaps find corners first, then wall middles, column centres and points on walls", () => {
  let plan = emptyPlan();
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 4000, y: 0 }], [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }]] as const) {
    const r = addWall(plan, a, b, 110, FIRST_LEVEL_ID);
    assert.ok(r.ok);
    plan = r.plan;
  }
  assert.equal(snapPoint(plan, { x: 3990, y: 20 }, 100)?.kind, "corner");
  const mid = snapPoint(plan, { x: 2030, y: -40 }, 100);
  assert.equal(mid?.kind, "middle");
  assert.deepEqual(mid?.point, { x: 2000, y: 0 });
  const on = snapPoint(plan, { x: 1234, y: 30 }, 100);
  assert.equal(on?.kind, "wall");
  assert.deepEqual(on?.point, { x: 1234, y: 0 });
  assert.equal(snapPoint(plan, { x: 1234, y: 900 }, 100), null);
  assert.equal(snapPoint(plan, { x: 50, y: 50 }, 100, [{ x: 60, y: 40 }])?.kind, "corner");
  // A partition drawn up from (1000, 2000) towards the bottom wall ends on it.
  const meet = meetWall(plan, { x: 1000, y: 2000 }, { x: 1000, y: 60 }, 100);
  assert.deepEqual(meet?.point, { x: 1000, y: 0 });
  assert.equal(meetWall(plan, { x: 1000, y: 2000 }, { x: 1000, y: 900 }, 100), null);
});

test("split, trim to corner and offset walls", () => {
  let plan = emptyPlan();
  const r = addWall(plan, { x: 0, y: 0 }, { x: 6000, y: 0 }, 110, FIRST_LEVEL_ID);
  assert.ok(r.ok);
  plan = r.plan;
  const id = plan.walls[0].id;
  const d = addOpening(plan, id, "door", 4500, 900);
  assert.ok(d.ok);
  plan = d.plan;
  assert.equal(splitWall(plan, id, { x: 4400, y: 10 }).ok, false, "a door in the way");
  const split = splitWall(plan, id, { x: 2000, y: 30 });
  assert.ok(split.ok);
  assert.equal(split.plan.walls.length, 2);
  const [first, second] = split.plan.walls;
  assert.deepEqual(first.b, { x: 2000, y: 0 });
  assert.deepEqual(second.a, { x: 2000, y: 0 });
  assert.equal(split.plan.openings[0].wallId, second.id);
  assert.equal(split.plan.openings[0].at, 2500);
  assert.equal(splitWall(plan, id, { x: 20, y: 0 }).ok, false);

  // Extending: a wall stopping short of another meets it at the corner.
  let l = emptyPlan();
  for (const [a, b] of [[{ x: 0, y: 0 }, { x: 3000, y: 0 }], [{ x: 4000, y: 500 }, { x: 4000, y: 3000 }]] as const) {
    const w = addWall(l, a, b, 110, FIRST_LEVEL_ID);
    assert.ok(w.ok);
    l = w.plan;
  }
  const corner = trimToCorner(l, l.walls[0].id, l.walls[1].id);
  assert.ok(corner.ok);
  assert.deepEqual(corner.plan.walls[0].b, { x: 4000, y: 0 });
  assert.deepEqual(corner.plan.walls[1].a, { x: 4000, y: 0 });
  // Crossing: the parts picked are kept.
  let x = emptyPlan();
  for (const [a, b] of [[{ x: 0, y: 1000 }, { x: 4000, y: 1000 }], [{ x: 1000, y: 0 }, { x: 1000, y: 4000 }]] as const) {
    const w = addWall(x, a, b, 110, FIRST_LEVEL_ID);
    assert.ok(w.ok);
    x = w.plan;
  }
  const kept = trimToCorner(x, x.walls[0].id, x.walls[1].id, { x: 3000, y: 1000 }, { x: 1000, y: 3000 });
  assert.ok(kept.ok);
  assert.deepEqual([kept.plan.walls[0].a, kept.plan.walls[0].b], [{ x: 1000, y: 1000 }, { x: 4000, y: 1000 }]);
  assert.deepEqual([kept.plan.walls[1].a, kept.plan.walls[1].b], [{ x: 1000, y: 1000 }, { x: 1000, y: 4000 }]);
  const parallel = addWall(l, { x: 0, y: 2000 }, { x: 3000, y: 2000 }, 110, FIRST_LEVEL_ID);
  assert.ok(parallel.ok);
  assert.equal(trimToCorner(parallel.plan, l.walls[0].id, parallel.id!).ok, false);

  const off = offsetWall(plan, id, 1500);
  assert.ok(off.ok);
  const copy = off.plan.walls.find((w) => w.id === off.id)!;
  assert.deepEqual([copy.a, copy.b], [{ x: 0, y: 1500 }, { x: 6000, y: 1500 }]);
  assert.equal(offsetWall(plan, id, 0).ok, false);
});
