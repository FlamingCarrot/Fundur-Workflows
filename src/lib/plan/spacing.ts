import {
  distance,
  finite,
  mm,
  pointAlong,
  samePoint,
  updateOpening,
  wallLength,
  type EditResult,
  type Opening,
  type Plan,
  type PlanItem,
  type Point,
  type Wall,
} from "./geometry";
import { moveBy } from "./elements";

export interface SpacingGuide {
  id: string;
  label: string;
  value: number;
  a: Point;
  b: Point;
  /** Opening-end guides sit outside the neighbour guides. Screen pixels. */
  offset: number;
  reference: { kind: "wall" | "opening" | "start" | "end"; id: string };
}

const dot = (p: Point, q: Point) => p.x * q.x + p.y * q.y;
const subtract = (p: Point, q: Point): Point => ({
  x: p.x - q.x,
  y: p.y - q.y,
});
const shift = (p: Point, u: Point, d: number): Point => ({
  x: p.x + u.x * d,
  y: p.y + u.y * d,
});
function frame(w: Wall) {
  const length = wallLength(w) || 1;
  const u = { x: (w.b.x - w.a.x) / length, y: (w.b.y - w.a.y) / length };
  return { u, n: { x: -u.y, y: u.x }, length };
}

/** Parallel walls with overlapping extents, on this floor, measured face to face. */
export function wallSpacing(plan: Plan, wall: Wall): SpacingGuide[] {
  const { u, n, length } = frame(wall);
  const nearest = new Map<number, SpacingGuide>();
  for (const ref of plan.walls) {
    if (ref.id === wall.id || ref.levelId !== wall.levelId) continue;
    const v = frame(ref).u;
    if (Math.abs(u.x * v.y - u.y * v.x) > 1e-6) continue;
    const ra = subtract(ref.a, wall.a),
      rb = subtract(ref.b, wall.a);
    const lo = Math.max(0, Math.min(dot(ra, u), dot(rb, u)));
    const hi = Math.min(length, Math.max(dot(ra, u), dot(rb, u)));
    if (hi - lo < 1) continue;
    const across = dot(ra, n),
      side = across < 0 ? -1 : 1;
    const value = Math.abs(across) - (wall.thickness + ref.thickness) / 2;
    if (value < -0.5 || value > 50_000) continue;
    const at = pointAlong(wall, (lo + hi) / 2);
    const direction =
      Math.abs(n.x) > Math.abs(n.y)
        ? n.x * side > 0
          ? "right"
          : "left"
        : n.y * side > 0
          ? "above"
          : "below";
    const guide: SpacingGuide = {
      id: `wall-${wall.id}-${ref.id}`,
      label: `Gap to ${ref.kind === "partition" ? "partition" : "wall"} ${direction}`,
      value: Math.max(0, value),
      a: shift(at, n, (side * wall.thickness) / 2),
      b: shift(at, n, across - (side * ref.thickness) / 2),
      offset: 0,
      reference: { kind: "wall", id: ref.id },
    };
    if (!nearest.has(side) || nearest.get(side)!.value > guide.value)
      nearest.set(side, guide);
  }
  return [...nearest.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Jamb-to-end and jamb-to-jamb distances along the actual host wall, including rotated walls. */
export function openingSpacing(plan: Plan, opening: Opening): SpacingGuide[] {
  const wall = plan.walls.find((w) => w.id === opening.wallId);
  if (!wall) return [];
  const start = opening.at - opening.width / 2,
    end = opening.at + opening.width / 2;
  const guide = (
    key: string,
    label: string,
    a: number,
    b: number,
    reference: SpacingGuide["reference"],
    offset: number,
  ): SpacingGuide => ({
    id: `opening-${opening.id}-${key}`,
    label,
    value: Math.max(0, b - a),
    a: pointAlong(wall, a),
    b: pointAlong(wall, b),
    reference,
    offset,
  });
  const others = plan.openings.filter(
    (o) => o.wallId === wall.id && o.id !== opening.id,
  );
  const before = others
    .filter((o) => o.at < opening.at)
    .sort((a, b) => b.at + b.width / 2 - (a.at + a.width / 2))[0];
  const after = others
    .filter((o) => o.at >= opening.at)
    .sort((a, b) => a.at - a.width / 2 - (b.at - b.width / 2))[0];
  return [
    guide(
      "start",
      "Gap to wall start",
      0,
      start,
      { kind: "start", id: wall.id },
      48,
    ),
    guide(
      "end",
      "Gap to wall end",
      end,
      wallLength(wall),
      { kind: "end", id: wall.id },
      48,
    ),
    ...(before
      ? [
          guide(
            `before-${before.id}`,
            `Gap to previous ${before.kind}`,
            before.at + before.width / 2,
            start,
            { kind: "opening", id: before.id },
            24,
          ),
        ]
      : []),
    ...(after
      ? [
          guide(
            `after-${after.id}`,
            `Gap to next ${after.kind}`,
            end,
            after.at - after.width / 2,
            { kind: "opening", id: after.id },
            24,
          ),
        ]
      : []),
  ];
}

export function selectionSpacing(
  plan: Plan,
  target: PlanItem | null,
): SpacingGuide[] {
  if (target?.kind === "wall") {
    const wall = plan.walls.find((w) => w.id === target.id);
    return wall ? wallSpacing(plan, wall) : [];
  }
  if (target?.kind === "opening") {
    const opening = plan.openings.find((o) => o.id === target.id);
    return opening ? openingSpacing(plan, opening) : [];
  }
  return [];
}

/** Re-resolve the reference against the current plan; one checked edit, never a lasting constraint. */
export function setSpacing(
  plan: Plan,
  target: PlanItem,
  guideId: string,
  value: number,
): EditResult {
  const fail = (error: string): EditResult => ({ ok: false, error });
  if (!finite(value) || value < 0)
    return fail("Type a clear gap of zero or more millimetres.");
  const guide = selectionSpacing(plan, target).find((g) => g.id === guideId);
  if (!guide)
    return fail("That reference has changed. Select the object again.");
  let result: EditResult;
  if (target.kind === "opening") {
    const opening = plan.openings.find((o) => o.id === target.id)!;
    const wall = plan.walls.find((w) => w.id === opening.wallId)!;
    let at: number;
    if (guide.reference.kind === "start") at = value + opening.width / 2;
    else if (guide.reference.kind === "end")
      at = wallLength(wall) - value - opening.width / 2;
    else {
      const other = plan.openings.find((o) => o.id === guide.reference.id)!;
      at =
        other.at < opening.at
          ? other.at + other.width / 2 + value + opening.width / 2
          : other.at - other.width / 2 - value - opening.width / 2;
    }
    result = updateOpening(plan, opening.id, { at });
  } else if (target.kind === "wall") {
    const wall = plan.walls.find((w) => w.id === target.id)!;
    const ref = plan.walls.find((w) => w.id === guide.reference.id)!;
    const { n, u, length } = frame(wall);
    const across = dot(subtract(ref.a, wall.a), n),
      side = across < 0 ? -1 : 1;
    const step = across - side * (value + (wall.thickness + ref.thickness) / 2);
    result = moveBy(plan, target, { x: n.x * step, y: n.y * step });
    if (result.ok) {
      const after = result.plan.walls.find((w) => w.id === ref.id)!;
      if (
        !samePoint(ref.a, after.a, 0.001) ||
        !samePoint(ref.b, after.b, 0.001)
      )
        return fail(
          "That reference wall would move with the joined corners. Choose an independent wall.",
        );
      for (const other of plan.walls) {
        if (other.id === wall.id || other.levelId !== wall.levelId) continue;
        const v = frame(other).u;
        if (Math.abs(u.x * v.y - u.y * v.x) > 1e-6) continue;
        const lo = Math.max(
          0,
          Math.min(
            dot(subtract(other.a, wall.a), u),
            dot(subtract(other.b, wall.a), u),
          ),
        );
        const hi = Math.min(
          length,
          Math.max(
            dot(subtract(other.a, wall.a), u),
            dot(subtract(other.b, wall.a), u),
          ),
        );
        if (hi - lo < 1) continue;
        const before = dot(subtract(other.a, wall.a), n),
          next = before - step;
        if (
          before * next < 0 ||
          Math.abs(next) < (wall.thickness + other.thickness) / 2 - 0.01
        )
          return fail(
            "That distance would move this wall through another wall. Use a smaller gap.",
          );
      }
    }
  } else return fail("Select a wall, door or window to adjust its spacing.");
  if (!result.ok) return result;
  const updated = selectionSpacing(result.plan, target).find(
    (g) => g.id === guideId,
  );
  if (!updated || Math.abs(updated.value - value) > 0.01)
    return fail(
      "That distance would cross another object or lose the reference.",
    );
  return {
    ...result,
    summary: `${target.kind === "wall" ? "Wall" : "Opening"}: ${guide.label.toLowerCase()} set to ${mm(value)}`,
  };
}

export interface AlignmentGuide {
  a: Point;
  b: Point;
}

/** Align new endpoints to nearby wall/column/visible furniture anchors. Only enabled axes may move. */
export function snapAlignment(
  plan: Plan,
  p: Point,
  within: number,
  options: {
    x?: boolean;
    y?: boolean;
    exclude?: Point;
    excludeWallId?: string;
  } = {},
): { point: Point; guides: AlignmentGuide[] } {
  const anchors: Point[] = [];
  for (const w of plan.walls)
    if (w.id !== options.excludeWallId) anchors.push(w.a, w.b);
  for (const c of plan.columns) anchors.push(c.at);
  for (const i of plan.items) if (!i.hidden) anchors.push(i.at);
  const eligible = anchors.filter(
    (a) => !options.exclude || !samePoint(a, options.exclude),
  );
  const nearest = (axis: "x" | "y") => {
    let best: Point | undefined,
      off = within,
      proximity = Infinity;
    for (const a of eligible) {
      const gap = Math.abs(a[axis] - p[axis]),
        d = distance(a, p);
      if (d <= 50_000 && (gap < off || (gap === off && d < proximity))) {
        best = a;
        off = gap;
        proximity = d;
      }
    }
    return best;
  };
  const x = options.x === false ? undefined : nearest("x"),
    y = options.y === false ? undefined : nearest("y");
  const point = { x: x?.x ?? p.x, y: y?.y ?? p.y };
  return {
    point,
    guides: [
      ...(x ? [{ a: x, b: point }] : []),
      ...(y ? [{ a: y, b: point }] : []),
    ],
  };
}

/** Opening snaps are valid placements: host centre, flush jambs and equal gaps between neighbours. */
export function snapOpening(
  plan: Plan,
  opening: Opening,
  at: number,
  within: number,
  enabled = true,
): { at: number; snapped: boolean } {
  const wall = plan.walls.find((w) => w.id === opening.wallId);
  if (!wall) return { at, snapped: false };
  const length = wallLength(wall),
    half = opening.width / 2;
  const others = plan.openings
    .filter((o) => o.wallId === wall.id && o.id !== opening.id)
    .sort((a, b) => a.at - b.at);
  const candidates = [half, length - half, length / 2];
  const boundaries = [
    0,
    ...others.flatMap((o) => [o.at - o.width / 2, o.at + o.width / 2]),
    length,
  ];
  for (let i = 0; i < boundaries.length - 1; i += 2) {
    const left = boundaries[i],
      right = boundaries[i + 1];
    candidates.push(left + half, right - half, (left + right) / 2);
  }
  const fits = (v: number) =>
    v >= half - 0.001 &&
    v <= length - half + 0.001 &&
    others.every(
      (o) =>
        v + half <= o.at - o.width / 2 + 0.001 ||
        v - half >= o.at + o.width / 2 - 0.001,
    );
  const near = enabled
    ? candidates
        .filter((v) => fits(v) && Math.abs(v - at) <= within)
        .sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0]
    : undefined;
  const clamped = Math.max(half, Math.min(length - half, at));
  return { at: near ?? clamped, snapped: near !== undefined };
}

/** Shift a wall only across its normal. Snap to endpoint alignment or equal clear gaps on both sides. */
export function snapWallDelta(
  plan: Plan,
  wall: Wall,
  delta: Point,
  within: number,
): Point {
  const { u, n } = frame(wall);
  const across = dot(delta, n),
    moved = {
      ...wall,
      a: shift(wall.a, n, across),
      b: shift(wall.b, n, across),
    };
  const candidates: number[] = [];
  for (const ref of plan.walls) {
    if (ref.id === wall.id || ref.levelId !== wall.levelId) continue;
    const v = frame(ref).u;
    if (Math.abs(u.x * v.y - u.y * v.x) < 1e-6) continue;
    for (const a of [ref.a, ref.b])
      for (const b of [wall.a, wall.b]) {
        if (samePoint(a, wall.a) || samePoint(a, wall.b)) continue;
        if (Math.abs(dot(subtract(a, b), u)) < within)
          candidates.push(dot(subtract(a, b), n));
      }
  }
  const gaps = wallSpacing(plan, moved);
  if (gaps.length === 2) {
    const refs = gaps.map((g) =>
      plan.walls.find((w) => w.id === g.reference.id)!,
    );
    const middle =
      refs
        .map(
          (r) =>
            dot(subtract(r.a, wall.a), n) -
            (Math.sign(dot(subtract(r.a, wall.a), n)) * r.thickness) / 2,
        )
        .reduce((a, b) => a + b, 0) / 2;
    candidates.push(middle);
  }
  const nearest = candidates
    .filter((v) => Math.abs(v - across) <= within)
    .sort((a, b) => Math.abs(a - across) - Math.abs(b - across))[0];
  const step = nearest ?? across;
  return { x: n.x * step, y: n.y * step };
}
