import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, addMonths, buildWeek, buildWeeks, shiftMonths, startOfMonth, startOfWeek, stepDay, weekName } from "../src/lib/studio/calendar";
import type { ProjectTask } from "../src/lib/studio/tasks";
import type { Project } from "../src/lib/studio/types";

const project = { id: "harbour-house", name: "Harbour House", swatch: "sage" } as Project;

function task(id: string, due?: string, done = false): ProjectTask {
  return {
    id,
    title: id,
    projectId: project.id,
    phaseKey: "discovery",
    source: "own",
    done,
    essential: false,
    ...(due ? { due } : {}),
    dateMoved: false,
    project,
  };
}

test("months and weeks start where a working calendar starts", () => {
  assert.equal(startOfMonth("2026-10-06"), "2026-10-01");
  assert.equal(addMonths("2026-11-01", 3), "2027-02-01");
  assert.equal(addMonths("2026-02-01", -3), "2025-11-01");
  // 6 October 2026 is a Tuesday, so its week starts on the Monday.
  assert.equal(startOfWeek("2026-10-06"), "2026-10-05");
  assert.equal(startOfWeek("2026-10-05"), "2026-10-05");
  assert.equal(startOfWeek("2026-10-11"), "2026-10-05");
});

test("a month view puts each task on its due date and marks today", () => {
  const weeks = buildWeeks("2026-10-01", 1, [task("a", "2026-10-06"), task("b", "2026-10-06"), task("c", "2026-10-20")], "2026-10-06");
  const days = weeks.flatMap((w) => w.days);
  assert.deepEqual(days.find((d) => d.day === "2026-10-06")!.tasks.map((t) => t.id), ["a", "b"]);
  assert.deepEqual(days.find((d) => d.day === "2026-10-20")!.tasks.map((t) => t.id), ["c"]);
  assert.equal(days.find((d) => d.day === "2026-10-06")!.isToday, true);

  // Whole weeks are shown, so days either side of the month are there but outside it.
  assert.equal(days[0].day, "2026-09-28");
  assert.equal(days[0].inRange, false);
  assert.equal(days.find((d) => d.day === "2026-10-01")!.inRange, true);
  assert.ok(days.every((d) => d.tasks.every((t) => t.due === d.day)));
});

test("a fuller week shows darker across a month", () => {
  const tasks = [task("a", "2026-11-03"), task("b", "2026-11-04"), task("c", "2026-11-17")];
  const weeks = buildWeeks("2026-11-01", 1, tasks, "2026-10-06");
  // The busiest week is full; a week with half as many is half as dark; an empty one is clear.
  assert.equal(weeks.find((w) => w.start === "2026-11-02")!.density, 1);
  assert.equal(weeks.find((w) => w.start === "2026-11-16")!.density, 0.5);
  assert.equal(weeks.find((w) => w.start === "2026-11-23")!.density, 0);
});

test("a week view is the Monday to Sunday the day falls in, with every task on it", () => {
  const week = buildWeek("2026-10-08", [task("a", "2026-10-05"), task("b", "2026-10-11"), task("c", "2026-10-12")], "2026-10-06");
  assert.equal(week.start, "2026-10-05");
  assert.deepEqual(week.days.map((d) => d.day), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  assert.ok(week.days.every((d) => d.inRange));
  assert.deepEqual(week.days.flatMap((d) => d.tasks).map((t) => t.id), ["a", "b"]);
  assert.equal(week.days[1].isToday, true);
});

test("earlier and later move by a day, a week or a month", () => {
  assert.equal(stepDay("day", "2026-10-31", 1), "2026-11-01");
  assert.equal(stepDay("day", "2026-01-01", -1), "2025-12-31");
  assert.equal(stepDay("week", "2026-10-06", 1), "2026-10-13");
  assert.equal(stepDay("week", "2026-10-06", -1), "2026-09-29");
  assert.equal(stepDay("month", "2026-10-06", 1), "2026-11-06");
  // A month that is shorter lands on its last day.
  assert.equal(shiftMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28");
  // Across a daylight-saving change the date still moves by whole days.
  assert.equal(addDays("2026-03-28", 1), "2026-03-29");
  assert.equal(addDays("2026-10-24", 2), "2026-10-26");
  assert.equal(weekName("2026-10-06"), "5 to 11 October 2026");
});

test("tasks outside the range and tasks without a date are left off", () => {
  const weeks = buildWeeks("2026-10-01", 1, [task("a", "2026-09-30"), task("b"), task("c", "2026-11-02"), task("d", "2026-10-15", true)], "2026-10-06");
  const placed = weeks.flatMap((w) => w.days).flatMap((d) => d.tasks);
  // Done tasks stay on the calendar; what happened is as useful as what is left.
  assert.deepEqual(placed.map((t) => t.id), ["d"]);
});
