import { test } from "node:test";
import assert from "node:assert/strict";
import { addItem } from "../src/lib/plan/elements";
import { emptyPlan, addWall, addOpening, addRoom, onLevel, samplePlan, type EditResult, type Item, type Plan, type Point } from "../src/lib/plan/geometry";
import { checkLayout, chairZone, teamOf, DESK_TYPES } from "../src/lib/layout/check";
import { generateLayouts, isWorkRoom } from "../src/lib/layout/generate";
import {
  DEFAULT_RULES,
  normalizeRules,
  parseAdjacencies,
  parseDepartments,
  parseHeadcount,
  rulesProblem,
  ruleSetInput,
} from "../src/lib/layout/rules";
import { boxesOverlap, itemBox } from "../src/lib/layout/space";
import { chooseLayout, chosenLayouts, intoLayout, removeLayout, saveOptions, snapItemDelta, updateLayoutNotes, withLayout } from "../src/lib/layout/options";
import { moveBy } from "../src/lib/plan/elements";
import { setWallLength } from "../src/lib/plan/geometry";

const p = (x: number, y: number): Point => ({ x, y });

function ok(r: EditResult): Plan {
  if (!r.ok) assert.fail(r.error);
  return r.plan;
}

/** A plain 10 m by 6 m room with a door in the south wall. */
function room(): Plan {
  let plan = emptyPlan();
  const south = addWall(plan, p(0, 0), p(10_000, 0), 200);
  plan = ok(south);
  const southId = (south as { id: string }).id;
  plan = ok(addWall(plan, p(10_000, 0), p(10_000, 6_000), 200));
  plan = ok(addWall(plan, p(10_000, 6_000), p(0, 6_000), 200));
  plan = ok(addWall(plan, p(0, 6_000), p(0, 0), 200));
  plan = ok(addOpening(plan, southId, "door", 5_000, 1_000));
  plan = ok(addRoom(plan, [p(0, 0), p(10_000, 0), p(10_000, 6_000), p(0, 6_000)], "Open plan"));
  return plan;
}

const level = (plan: Plan) => onLevel(plan, plan.levels[0].id);
const check = (plan: Plan, headcount: number | null = null) =>
  checkLayout(level(plan), { rules: DEFAULT_RULES, headcount, adjacencies: [] });

function place(plan: Plan, type: string, at: Point, rotation = 0, label?: string): Plan {
  const next = ok(addItem(plan, type, at, plan.levels[0].id, rotation));
  const added = next.items[next.items.length - 1];
  const sized: Item = type === "desk" ? { ...added, width: 1_400, depth: 700 } : added;
  return { ...next, items: [...next.items.slice(0, -1), label ? { ...sized, label } : sized] };
}

test("teams, headcount and near or apart pairs are read from the brief", () => {
  assert.deepEqual(parseDepartments("Executive (12), Finance (30)\nSales: 24; 18 Marketing, Legal"), [
    { name: "Executive", headcount: 12 },
    { name: "Finance", headcount: 30 },
    { name: "Sales", headcount: 24 },
    { name: "Marketing", headcount: 18 },
  ]);
  assert.deepEqual(parseDepartments("IT - 8 people and HR (4)"), [
    { name: "IT", headcount: 8 },
    { name: "HR", headcount: 4 },
  ]);
  assert.equal(parseHeadcount("About 1 240 people"), 1_240);
  assert.equal(parseHeadcount("140"), 140);
  assert.equal(parseHeadcount("tbc"), null);
  const names = ["Executive", "Finance", "Sales", "Boardroom", "Reception"];
  assert.deepEqual(parseAdjacencies("Finance next to the boardroom; Sales away from reception. Executive near Finance, Legal near IT", names), [
    { a: "Finance", b: "Boardroom", kind: "near" },
    { a: "Sales", b: "Reception", kind: "apart" },
    { a: "Executive", b: "Finance", kind: "near" },
  ]);
});

test("rules are filled out, checked, and refused when impossible", () => {
  const rules = normalizeRules({ deskWidth: 1_600, groupSizes: [6, 3, 6, 4] });
  assert.equal(rules.deskWidth, 1_600);
  assert.deepEqual(rules.groupSizes, [4, 6]);
  assert.equal(rules.aisle, DEFAULT_RULES.aisle);
  assert.equal(rulesProblem(rules), null);
  assert.match(rulesProblem({ ...rules, aisle: 100 })!, /Aisle/);
  assert.match(rulesProblem({ ...rules, apartBeyond: 1_000, nearWithin: 6_000 })!, /Apart/);
  assert.equal(ruleSetInput.safeParse({ name: "Studio", rules: { ...rules, groupSizes: [5] } }).success, false);
  assert.equal(ruleSetInput.safeParse({ name: "Studio", rules }).success, true);
});

test("the checker finds overlaps, chairs against walls, blocked doors and desks with no way out", () => {
  // Two desks in the middle of the room, chair sides apart: no issues.
  let plan = place(room(), "desk", p(3_000, 3_000), 0, "Finance 1");
  plan = place(plan, "desk", p(3_000, 3_700), 180, "Finance 2");
  assert.deepEqual(check(plan).issues, []);

  // A third desk on top of the first.
  const overlapping = place(plan, "desk", p(3_500, 3_000));
  assert.ok(check(overlapping).issues.some((i) => i.kind === "overlap"));

  // A desk with its chair side to the north wall.
  const cramped = place(plan, "desk", p(7_000, 6_000 - 100 - 350 - 300), 180);
  assert.ok(check(cramped).issues.some((i) => i.kind === "chair"), "300 mm behind the chair is not enough");

  // A cupboard in front of the door.
  const blocking = place(plan, "cupboard", p(5_000, 500));
  assert.ok(check(blocking).issues.some((i) => i.kind === "door"));

  // A desk behind a partition with no door has no way out.
  let boxed = ok(addWall(room(), p(7_000, 0), p(7_000, 6_000), 90, room().levels[0].id, "partition"));
  boxed = place(boxed, "desk", p(8_500, 3_000), 0, "Sales 1");
  const report = check(boxed);
  assert.ok(report.issues.some((i) => i.kind === "route"), JSON.stringify(report.issues));
});

test("the measures add up: desks, areas, circulation, walking distance and the score", () => {
  let plan = place(room(), "desk", p(3_000, 3_000), 0, "Finance 1");
  plan = place(plan, "desk", p(3_000, 3_700), 180, "Finance 2");
  plan = place(plan, "desk", p(7_000, 3_000), 0, "Sales 1");
  const report = checkLayout(level(plan), {
    rules: DEFAULT_RULES,
    headcount: 4,
    adjacencies: [
      { a: "Finance", b: "Sales", kind: "near" },
      { a: "Finance", b: "Sales", kind: "apart" },
    ],
  });
  const m = report.metrics;
  assert.equal(m.desks, 3);
  assert.equal(m.usableArea, 60);
  assert.equal(m.areaPerDesk, 20);
  // 4 m between the desks' middles: near (within 6 m), not apart (beyond 10 m).
  assert.deepEqual(m.adjacencies.map((a) => [a.met, a.distance]), [[true, 4_000], [false, 4_000]]);
  assert.deepEqual(m.teams, [{ name: "Finance", desks: 2, together: true }, { name: "Sales", desks: 1, together: true }]);
  // Three desks with chair space take about 3 x 1.4 x (0.7 + 0.75) = 6.1 m² of 60, give or take the grid.
  assert.ok(m.circulation > 0.88 && m.circulation < 0.92, String(m.circulation));
  // From the door at (5 000, 0) to behind the desks: a few metres.
  assert.ok(m.longestWalk! > 1_000 && m.longestWalk! < 6_000, String(m.longestWalk));
  assert.equal(m.score, Math.round(m.scoreParts.reduce((s, x) => s + x.points, 0)));
  assert.equal(m.scoreParts[0].points, 30, "3 of 4 seats is 30 of 40");
  assert.equal(teamOf(plan.items[0]), "Finance");
});

test("options are laid out for the brief with no overlaps and every clearance met", () => {
  let plan = samplePlan();
  const levelId = plan.levels[0].id;
  // A sofa that should stay, and an old desk that should be replaced.
  plan = place(plan, "sofa", p(16_000, 1_500));
  plan = place(plan, "desk", p(2_000, 2_000), 0, "Old 1");
  const result = generateLayouts(plan, levelId, {
    rules: DEFAULT_RULES,
    ruleSetName: "Studio standard",
    headcount: 24,
    departments: [
      { name: "Finance", headcount: 10 },
      { name: "Sales", headcount: 8 },
    ],
    adjacencies: [{ a: "Finance", b: "Meeting room", kind: "near" }],
  });
  if (!result.ok) assert.fail(result.error);
  assert.ok(result.options.length >= 3 && result.options.length <= 5, `${result.options.length} options`);
  assert.deepEqual(result.options.map((o) => o.option.name).slice(0, 3), ["Option A", "Option B", "Option C"]);
  for (const { option, report } of result.options) {
    assert.deepEqual(report.issues, [], `${option.name}: ${report.issues.map((i) => i.message).join("; ")}`);
    const desks = option.items.filter((i) => DESK_TYPES.has(i.type));
    for (let i = 0; i < desks.length; i++) {
      for (let j = i + 1; j < desks.length; j++) assert.equal(boxesOverlap(itemBox(desks[i]), itemBox(desks[j])), false);
    }
    assert.ok(desks.length > 0 && desks.length <= 24);
    assert.ok(option.items.some((i) => i.type === "sofa"), "furniture already there stays");
    assert.ok(!option.items.some((i) => i.label === "Old 1"), "old desks are laid out afresh");
    assert.ok(option.items.some((i) => i.type === "meeting-table" || i.type === "round-table"), "the meeting room gets a table");
    assert.ok(desks.filter((d) => d.label?.startsWith("Finance")).length > 0);
    assert.ok(option.items.every((i) => i.levelId === levelId));
    assert.match(option.summary, /Groups of up to \d+/);
    // Every desk has its chair space inside the room.
    for (const d of desks) assert.ok(chairZone(d, DEFAULT_RULES).w > 0);
  }
  // Best first.
  const scores = result.options.map((o) => o.report.metrics.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test("a floor without rooms is refused with what to do", () => {
  const plan = emptyPlan();
  const result = generateLayouts(plan, plan.levels[0].id, {
    rules: DEFAULT_RULES,
    ruleSetName: "x",
    headcount: 10,
    departments: [],
    adjacencies: [],
  });
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /Room tool/);
  assert.equal(isWorkRoom({ id: "r", levelId: "l", name: "Boardroom", points: [], usable: true }), false);
  assert.equal(isWorkRoom({ id: "r", levelId: "l", name: "Open plan", points: [], usable: true }), true);
});

test("options are kept with the plan, edited on their own, and choosing one puts its furniture on the plan", () => {
  const plan = samplePlan();
  const levelId = plan.levels[0].id;
  const made = generateLayouts(plan, levelId, { rules: DEFAULT_RULES, ruleSetName: "Studio", headcount: 20, departments: [], adjacencies: [] });
  if (!made.ok) assert.fail(made.error);
  let next = ok(saveOptions(plan, levelId, made.options.map((o) => o.option)));
  assert.equal(next.layouts.length, made.options.length);
  assert.equal(next.items.length, 0, "the plan's own furniture is untouched");
  const [a, b] = next.layouts;

  // Editing option B moves a desk in B only.
  const working = withLayout(next, b);
  const desk = working.items.find((i) => i.type === "desk")!;
  const moved = intoLayout(next, b.id, moveBy(working, { kind: "item", id: desk.id }, p(100, 0)));
  assert.ok(moved.ok && moved.summary.startsWith("Option B: "));
  next = ok(moved);
  assert.equal(next.layouts[1].items.find((i) => i.id === desk.id)!.at.x, desk.at.x + 100);
  assert.equal(next.items.length, 0);
  // A wall changed from inside an option changes the plan for all of them.
  const south = next.walls.find((w) => w.a.y === 0 && w.b.y === 0)!;
  next = ok(intoLayout(next, b.id, setWallLength(withLayout(next, b), south.id, 18_500)));
  assert.equal(next.walls.find((w) => w.id === south.id)!.b.x, 18_500);

  // Choosing A: its furniture becomes the plan's, with the reasons.
  next = ok(chooseLayout(next, a.id, "  Keeps finance by the meeting room  "));
  assert.equal(next.items.length, a.items.length);
  assert.deepEqual(chosenLayouts(next).map((l) => [l.name, l.notes]), [["Option A", "Keeps finance by the meeting room"]]);
  // Choosing B instead unmarks A.
  next = ok(chooseLayout(next, b.id, ""));
  assert.deepEqual(chosenLayouts(next).map((l) => l.name), ["Option B"]);
  // Editing the chosen option keeps the plan's furniture in step.
  const chosenWorking = withLayout(next, next.layouts[1]);
  const d2 = chosenWorking.items.find((i) => i.type === "desk")!;
  next = ok(intoLayout(next, b.id, moveBy(chosenWorking, { kind: "item", id: d2.id }, p(0, 50))));
  assert.equal(next.items.find((i) => i.id === d2.id)!.at.y, d2.at.y + 50);

  next = ok(updateLayoutNotes(next, b.id, "North light"));
  assert.equal(next.layouts[1].notes, "North light");
  // Generating again replaces the options not chosen and keeps the chosen one with its name.
  const again = ok(saveOptions(next, levelId, made.options.slice(0, 3).map((o) => o.option)));
  assert.deepEqual(again.layouts.map((l) => l.name), ["Option B", "Option A", "Option C", "Option D"]);
  assert.equal(ok(removeLayout(again, again.layouts[1].id)).layouts.length, 3);
});

test("a dragged item snaps to line up with its neighbour", () => {
  let plan = place(room(), "desk", p(3_000, 3_000));
  plan = place(plan, "desk", p(5_000, 3_000));
  const [first, second] = plan.items;
  // Dragged 530 mm left, it stops 70 mm short of the first desk, so it snaps to touch it (and squares up in y).
  const delta = snapItemDelta(plan, plan.levels[0].id, second.id, p(-530, 40), 100);
  assert.deepEqual(delta, p(-600, 0));
  assert.equal(second.at.x + delta.x - first.at.x, 1_400);
  // Far away, nothing snaps.
  assert.deepEqual(snapItemDelta(plan, plan.levels[0].id, second.id, p(2_000, 2_000), 100), p(2_000, 2_000));
});
