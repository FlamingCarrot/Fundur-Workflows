import { test } from "node:test";
import { buildScene } from "../src/lib/plan/scene";
import { ceilingHeight, ceilingLines, ceilingPlan, onCeiling, setCeiling } from "../src/lib/plan/ceilings";
import { STANDARD } from "../src/lib/blueprints/resolve";
import { placeBlueprint } from "../src/lib/blueprints/plan-edits";
import { openingMarks, setMark } from "../src/lib/plan/marks";
import { tapeReading } from "../src/lib/plan/tape";
import { phaseView, setPhase, usesPhases } from "../src/lib/plan/phases";
import { schedule } from "../src/lib/plan/schedules";
import { planSheets } from "../src/lib/plan/sheet";
import { hiddenCount, hideThese, isHideState, visiblePart } from "../src/lib/plan/hide";
import { isPinned, pinMany, pinViolation } from "../src/lib/plan/pins";
import { meetWall, snapPoint } from "../src/lib/plan/snaps";
import { offsetWall, splitWall, trimToCorner } from "../src/lib/plan/wall-tools";
import { planSchema } from "../src/lib/plan/schema";
import assert from "node:assert/strict";
import { addItem, addLevel } from "../src/lib/plan/elements";
import { addOpening, addRoom, addWall, emptyPlan, FIRST_LEVEL_ID, type EditResult, type Plan, type Point } from "../src/lib/plan/geometry";
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

test("hide and isolate change what is drawn, never the plan", () => {
  const r = room();
  const hidden = hideThese(null, "hide", [{ kind: "item", id: r.d1 }, { kind: "wall", id: r.back }]);
  const seen = visiblePart(r.plan, hidden);
  assert.deepEqual(seen.items.map((i) => i.id), [r.d2]);
  // The door goes with its wall.
  assert.equal(seen.openings.length, 0);
  assert.equal(seen.walls.length, 2);
  assert.equal(hiddenCount(r.plan, hidden), 3);
  assert.equal(r.plan.items.length, 2);
  // Hiding more adds to it; isolating starts again.
  const more = hideThese(hidden, "hide", [{ kind: "item", id: r.d2 }]);
  assert.equal(visiblePart(r.plan, more).items.length, 0);
  const only = hideThese(more, "isolate", [{ kind: "wall", id: r.back }]);
  const iso = visiblePart(r.plan, only);
  assert.deepEqual(iso.walls.map((w) => w.id), [r.back]);
  assert.deepEqual(iso.openings.map((o) => o.id), [r.door]);
  assert.equal(iso.items.length, 0);
  assert.equal(visiblePart(r.plan, null), r.plan);
  assert.ok(isHideState(only) && isHideState(null));
  assert.equal(isHideState({ mode: "hide", keys: ["bogus:1"] }), false);
});

test("phases: existing, demolished and new, with views, copies, schedules and sheets", () => {
  const r = room();
  assert.equal(usesPhases(r.plan), false);
  const shell = ok(setPhase(r.plan, [{ kind: "wall", id: r.left }, { kind: "wall", id: r.right }], "existing"));
  // The back wall comes out and takes its door with it.
  const out = ok(setPhase(shell.plan, [{ kind: "wall", id: r.back }, { kind: "item", id: r.d1 }], "demolished"));
  const plan = out.plan;
  assert.ok(usesPhases(plan));
  assert.equal(plan.openings.find((o) => o.id === r.door)!.phase, "demolished");
  assert.equal(setPhase(plan, [{ kind: "opening", id: r.door }], "new").ok, false);
  assert.equal(setPhase(plan, [{ kind: "room", id: "x" }], "new").ok, false);
  assert.ok(planSchema.safeParse(plan).success);
  // Views.
  const newer = phaseView(plan, "new");
  assert.deepEqual(newer.walls.map((w) => w.id).sort(), [r.left, r.right].sort());
  assert.equal(newer.openings.length, 0);
  assert.deepEqual(newer.items.map((i) => i.id), [r.d2]);
  const before = phaseView(plan, "existing");
  assert.equal(before.walls.length, 3);
  assert.deepEqual(before.items.map((i) => i.id), [r.d1]);
  assert.equal(phaseView(plan, "all"), plan);
  // Back to new clears the field.
  const back = ok(setPhase(plan, [{ kind: "wall", id: r.left }], "new"));
  assert.equal("phase" in back.plan.walls.find((w) => w.id === r.left)!, false);
  // Copies are new work.
  const copy = ok(duplicateMany(plan, [{ kind: "wall", id: r.left }]));
  assert.equal(copy.plan.walls.at(-1)!.phase, undefined);
  // Schedules show the phase once it is used; sheets draw it.
  const s = schedule(plan, "walls");
  assert.ok(s.columns.some((c) => c.key === "phase"));
  assert.ok(s.rows.some((row) => row.cells.phase === "To demolish"));
  assert.equal(schedule(r.plan, "walls").columns.some((c) => c.key === "phase"), false);
  const sheet = planSheets(plan, { paper: "A3", scale: "fit", projectName: "Test", phase: "demolition" });
  assert.ok(sheet.ok);
});

test("the tape reads length, across and up, and angle", () => {
  assert.equal(tapeReading({ x: 0, y: 0 }, { x: 4000, y: 0 }), "4,000 mm");
  assert.equal(tapeReading({ x: 0, y: 0 }, { x: 3000, y: 4000 }), "5,000 mm (3,000 across, 4,000 up, 53.1°)");
  assert.equal(tapeReading({ x: 0, y: 0 }, { x: -3000, y: -4000 }), "5,000 mm (3,000 across, 4,000 up, 53.1°)");
});
test("the tape's angle is the slope off the across direction", () => {
  assert.equal(tapeReading({ x: 0, y: 0 }, { x: 4000, y: -4000 }), "5,657 mm (4,000 across, 4,000 up, 45°)");
});

test("doors and windows are numbered, keep typed marks, and show in schedules and sheets", () => {
  const r = room();
  let plan = ok(addOpening(r.plan, r.left, "window", 1_500)).plan;
  plan = ok(addOpening(plan, r.right, "door", 1_000)).plan;
  const marks = openingMarks(plan);
  // Top row first: the back wall's door is D01; the right wall's lower door is D02.
  assert.equal(marks.get(r.door), "D01");
  assert.deepEqual([...marks.values()].sort(), ["D01", "D02", "W01"]);
  const typed = ok(setMark(plan, r.door, " d02 "));
  const after = openingMarks(typed.plan);
  assert.equal(after.get(r.door), "D02");
  // The other door is numbered around it.
  assert.deepEqual([...after.values()].sort(), ["D01", "D02", "W01"]);
  const other = plan.openings.find((o) => o.kind === "door" && o.id !== r.door)!;
  assert.equal(setMark(typed.plan, other.id, "D02").ok, false);
  assert.equal(setMark(typed.plan, other.id, "X".repeat(13)).ok, false);
  const back = ok(setMark(typed.plan, r.door, ""));
  assert.equal("mark" in back.plan.openings.find((o) => o.id === r.door)!, false);
  assert.ok(planSchema.safeParse(typed.plan).success);
  // A copied wall's door is numbered afresh.
  const copy = ok(duplicateMany(typed.plan, [{ kind: "wall", id: r.back }]));
  assert.equal(copy.plan.openings.filter((o) => o.mark === "D02").length, 1);
  const s = schedule(typed.plan, "openings");
  assert.equal(s.columns[0].key, "marks");
  assert.ok(s.rows.some((row) => String(row.cells.marks).includes("D02")));
  assert.ok(planSheets(typed.plan, { paper: "A3", scale: "fit", projectName: "Test", marks: true }).ok);
});

test("ceilings: kinds and heights per room, the ceiling plan, schedules and sheets", () => {
  let plan = room().plan;
  plan = ok(addRoom(plan, [p(0, 0), p(4_000, 0), p(4_000, 3_000), p(0, 3_000)], "Office")).plan;
  const r = plan.rooms[0];
  assert.equal(ceilingHeight(plan, r), plan.levels[0].height);
  const set = ok(setCeiling(plan, r.id, { kind: "grid-600", height: 2_600 }));
  const c = set.plan.rooms[0];
  assert.equal(c.ceiling, "grid-600");
  assert.equal(ceilingHeight(set.plan, c), 2_600);
  assert.equal(setCeiling(plan, r.id, { height: 900 }).ok, false);
  const back = ok(setCeiling(set.plan, r.id, { kind: "plaster", height: null }));
  assert.equal("ceiling" in back.plan.rooms[0] || "ceilingHeight" in back.plan.rooms[0], false);
  assert.ok(planSchema.safeParse(set.plan).success);
  // A 600 grid over 4 m × 3 m, centred: lines across and up.
  const lines = ceilingLines("grid-600", { minX: 0, minY: 0, maxX: 4_000, maxY: 3_000 });
  assert.ok(lines.some(([a]) => a.x === 2_000));
  assert.ok(lines.some(([a]) => a.y === 1_500));
  assert.equal(ceilingLines(undefined, { minX: 0, minY: 0, maxX: 4_000, maxY: 3_000 }).length, 0);
  // Desks step aside on the ceiling plan; a pendant stays.
  const placed = ok(placeBlueprint(set.plan, STANDARD, "std:pendant-light", p(2_000, 1_500), FIRST_LEVEL_ID));
  const pendant = placed.plan.items.find((i) => i.id === placed.id)!;
  assert.ok(onCeiling(pendant, STANDARD));
  const seen = ceilingPlan(placed.plan, STANDARD);
  assert.deepEqual(seen.items.map((i) => i.id), [pendant.id]);
  const s = schedule(set.plan, "rooms");
  assert.equal(s.rows[0].cells.ceiling, "Grid, 600 × 600");
  assert.equal(s.rows[0].cells.ceilingHeight, 2_600);
  assert.ok(planSheets(set.plan, { paper: "A3", scale: "fit", projectName: "Test", look: "ceiling" }).ok);
});

test("3D shows ceilings at their heights when asked, and none for open ceilings", () => {
  let plan = room().plan;
  plan = ok(addRoom(plan, [p(0, 0), p(4_000, 0), p(4_000, 3_000), p(0, 3_000)], "Office")).plan;
  plan = ok(setCeiling(plan, plan.rooms[0].id, { height: 2_500 })).plan;
  const options = { levelId: FIRST_LEVEL_ID, allLevels: false, separated: false, cutWalls: false, layers: { walls: true, openings: true, columns: true, rooms: true, furniture: true } };
  const floors = (s: ReturnType<typeof buildScene>) => s.solids.filter((x) => x.shape === "floor");
  assert.equal(floors(buildScene(plan, options)).length, 1);
  const lit = floors(buildScene(plan, { ...options, ceilings: true }));
  assert.equal(lit.length, 2);
  assert.ok(lit.some((x) => Math.abs(x.at[1] - 2.5) < 1e-9));
  const open = ok(setCeiling(plan, plan.rooms[0].id, { kind: "open" })).plan;
  assert.equal(floors(buildScene(open, { ...options, ceilings: true })).length, 1);
});
