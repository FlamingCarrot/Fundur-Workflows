import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, buildWeeks, startOfMonth, startOfQuarter, startOfWeek } from "../src/lib/studio/calendar";
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

test("months, quarters and weeks start where a working calendar starts", () => {
  assert.equal(startOfMonth("2026-10-06"), "2026-10-01");
  assert.equal(addMonths("2026-11-01", 3), "2027-02-01");
  assert.equal(addMonths("2026-02-01", -3), "2025-11-01");
  assert.equal(startOfQuarter("2026-10-06"), "2026-10-01");
  assert.equal(startOfQuarter("2026-05-20"), "2026-04-01");
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

test("a quarter covers three months, and a fuller week shows darker", () => {
  const tasks = [task("a", "2026-10-06"), task("b", "2026-10-07"), task("c", "2026-11-17"), task("d", "2026-12-30")];
  const weeks = buildWeeks(startOfQuarter("2026-11-10"), 3, tasks, "2026-10-06");
  const days = weeks.flatMap((w) => w.days);
  assert.ok(days.some((d) => d.day === "2026-10-01"));
  assert.ok(days.some((d) => d.day === "2026-12-31"));
  assert.equal(days.filter((d) => d.tasks.length).length, 4);

  // The busiest week is full; a week with half as many is half as dark; an empty one is clear.
  const busiest = weeks.find((w) => w.start === "2026-10-05")!;
  assert.equal(busiest.density, 1);
  assert.equal(weeks.find((w) => w.start === "2026-11-16")!.density, 0.5);
  assert.equal(weeks.find((w) => w.start === "2026-11-23")!.density, 0);
});

test("tasks outside the range and tasks without a date are left off", () => {
  const weeks = buildWeeks("2026-10-01", 1, [task("a", "2026-09-30"), task("b"), task("c", "2026-11-02"), task("d", "2026-10-15", true)], "2026-10-06");
  const placed = weeks.flatMap((w) => w.days).flatMap((d) => d.tasks);
  // Done tasks stay on the calendar; what happened is as useful as what is left.
  assert.deepEqual(placed.map((t) => t.id), ["d"]);
});
