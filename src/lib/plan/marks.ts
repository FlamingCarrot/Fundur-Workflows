import { sortedLevels } from "./elements";
import { pointAlong, type EditResult, type Opening, type Plan, type Point } from "./geometry";

/**
 * Door and window marks (Revit's Mark): D01, D02 for doors and W01 for
 * windows, numbered floor by floor from the top left, so a schedule, a tag
 * on the plan and a supplier's quote all name the same door. A mark typed
 * by hand is kept; the rest are numbered around it.
 */

export const MARK_MAX = 12;

/** Every door's and window's mark, by its id. */
export function openingMarks(plan: Plan): Map<string, string> {
  const marks = new Map<string, string>();
  const taken = new Set<string>();
  for (const o of plan.openings) if (o.mark) {
    marks.set(o.id, o.mark);
    taken.add(o.mark.toUpperCase());
  }
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  const floor = new Map(sortedLevels(plan).map((l, i) => [l.id, i]));
  const placed = plan.openings
    .filter((o) => !o.mark && walls.has(o.wallId))
    .map((o) => {
      const w = walls.get(o.wallId)!;
      return { o, floor: floor.get(w.levelId) ?? 0, at: pointAlong(w, o.at) };
    })
    // Floor by floor, then reading order: top to bottom in rows of a metre, left to right.
    .sort((a, b) => a.floor - b.floor || Math.round(b.at.y / 1000) - Math.round(a.at.y / 1000) || a.at.x - b.at.x);
  const next = { door: 1, window: 1 };
  for (const { o } of placed) {
    let mark: string;
    do mark = `${o.kind === "door" ? "D" : "W"}${String(next[o.kind]++).padStart(2, "0")}`;
    while (taken.has(mark));
    taken.add(mark);
    marks.set(o.id, mark);
  }
  return marks;
}

/** Gives a door or window its own mark, or (empty) goes back to numbering it. */
export function setMark(plan: Plan, openingId: string, mark: string): EditResult {
  const opening = plan.openings.find((o) => o.id === openingId);
  if (!opening) return { ok: false, error: "That door or window is no longer on the plan." };
  const clean = mark.trim().toUpperCase();
  if (clean.length > MARK_MAX) return { ok: false, error: `Keep a mark to ${MARK_MAX} letters or numbers.` };
  if (clean && plan.openings.some((o) => o.id !== openingId && o.mark?.toUpperCase() === clean)) return { ok: false, error: `${clean} is already another ${opening.kind === "door" ? "door's or window's" : "window's or door's"} mark.` };
  if ((opening.mark ?? "") === clean) return { ok: true, plan, summary: "" };
  const updated: Opening = { ...opening, mark: clean || undefined };
  if (!clean) delete updated.mark;
  return {
    ok: true,
    plan: { ...plan, openings: plan.openings.map((o) => (o.id === openingId ? updated : o)) },
    summary: clean ? `${opening.kind === "door" ? "Door" : "Window"} marked ${clean}` : `${opening.kind === "door" ? "Door" : "Window"} numbered automatically`,
  };
}

/** Where a door's or window's tag sits: beside its middle, `off` mm out from the wall face, away from the door's swing. */
export function markAt(wall: { a: Point; b: Point; thickness: number }, opening: Opening, off: number): Point {
  const L = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1;
  const side = -(opening.side ?? 1);
  const mid = pointAlong(wall as Parameters<typeof pointAlong>[0], opening.at);
  const n = { x: -(wall.b.y - wall.a.y) / L, y: (wall.b.x - wall.a.x) / L };
  const d = (wall.thickness / 2 + off) * side;
  return { x: mid.x + n.x * d, y: mid.y + n.y * d };
}
