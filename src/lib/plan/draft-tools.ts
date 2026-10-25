import { distance, mm, newId, type EditResult, type Plan, type PlanItem, type Point } from "./geometry";
import { addItem } from "./elements";
import { addDraft, describeDraft, draftName, drafts, draftProblem, isClosed, segmentsOf, styleOf, type Draft, type Segment } from "./drafting";

/**
 * More of AutoCAD's everyday tools for drawn shapes: Match Properties, Draw
 * Order, Select Similar, Overkill (delete duplicates), Divide and Measure.
 * Each edit returns the new plan and one line for the log, like every other
 * edit, so the assistant makes the same edits a person makes.
 */

const fail = (error: string): EditResult => ({ ok: false, error });
const same = (plan: Plan): EditResult => ({ ok: true, plan, summary: "" });
const r1 = (v: number) => Math.round(v * 10) / 10;

/** What Match Properties carries from one shape to others. */
const MATCHED = ["layer", "color", "linetype", "weight"] as const;

/**
 * AutoCAD's MATCHPROP: the targets take the source's layer, colour, line type
 * and weight; closed targets take its hatch, and text, leaders, dimensions and
 * tables its text height.
 */
export function matchProperties(plan: Plan, sourceId: string, targetIds: string[]): EditResult {
  const list = drafts(plan);
  const src = list.find((d) => d.id === sourceId);
  if (!src) return fail("The shape to copy from is no longer on the plan.");
  const targets = new Set(targetIds.filter((id) => id !== sourceId));
  if (!targets.size) return fail("Pick the shapes to change.");
  let count = 0;
  const next: Draft[] = [];
  for (const d of list) {
    if (!targets.has(d.id)) {
      next.push(d);
      continue;
    }
    const out: Draft = { ...d };
    for (const k of MATCHED) {
      if (src[k] != null) (out as unknown as Record<string, unknown>)[k] = src[k];
      else delete out[k];
    }
    if (isClosed(out) && out.shape !== "table") {
      if (src.fill) out.fill = { ...src.fill };
      else delete out.fill;
    }
    const texty = (x: Draft) => x.shape === "text" || x.shape === "leader" || x.shape === "dimension" || x.shape === "table";
    if (texty(src) && texty(out)) {
      if (src.height != null) out.height = src.height;
      else delete out.height;
    }
    const problem = draftProblem(plan, out);
    if (problem) return fail(problem);
    next.push(out);
    count++;
  }
  if (!count) return fail("Those shapes are no longer on the plan.");
  return { ok: true, plan: { ...plan, drafts: next }, summary: `${count} shape${count === 1 ? "" : "s"} matched to the ${draftName(src).toLowerCase()}` };
}

/** AutoCAD's DRAWORDER: shapes drawn last show on top, so hatches can sit under lines. */
export function drawOrder(plan: Plan, ids: string[], to: "front" | "back"): EditResult {
  const wanted = new Set(ids);
  const list = drafts(plan);
  const moving = list.filter((d) => wanted.has(d.id));
  if (!moving.length) return fail("Select the shapes to bring forward or send back.");
  const rest = list.filter((d) => !wanted.has(d.id));
  const next = to === "front" ? [...rest, ...moving] : [...moving, ...rest];
  if (next.every((d, i) => d === list[i])) return same(plan);
  return { ok: true, plan: { ...plan, drafts: next }, summary: `${moving.length === 1 ? draftName(moving[0]) : `${moving.length} shapes`} ${to === "front" ? "brought to the front" : "sent to the back"}` };
}

/** AutoCAD's SELECTSIMILAR: the shapes on the same floor of the same kind and on the same layer. */
export function similarDrafts(plan: Plan, id: string): string[] {
  const d = drafts(plan).find((x) => x.id === id);
  if (!d) return [];
  const layer = d.layer ?? "";
  return drafts(plan)
    .filter((x) => x.levelId === d.levelId && draftName(x) === draftName(d) && (x.layer ?? "") === layer && !styleOf(plan, x).hidden && !styleOf(plan, x).locked)
    .map((x) => x.id);
}

const key = (d: Draft) => {
  const p = (q: Point) => `${Math.round(q.x)},${Math.round(q.y)}`;
  // A line drawn either way round is the same line; a closed polyline from any corner is not checked.
  const pts = d.shape === "line" ? [p(d.points[0]), p(d.points[1])].sort().join(" ") : d.points.map(p).join(" ");
  const rest = { ...d, id: "", points: pts } as Record<string, unknown>;
  for (const k of ["radius", "radius2", "start", "end", "rotation", "height"]) if (typeof rest[k] === "number") rest[k] = Math.round(rest[k] as number);
  return JSON.stringify(rest, Object.keys(rest).sort());
};

/**
 * AutoCAD's OVERKILL on one floor: removes shapes drawn twice in the same
 * place, and lines lying wholly on another line of the same layer, as DXF
 * files often bring in. Text and tables are compared word for word.
 */
export function removeDuplicates(plan: Plan, levelId: string): EditResult {
  const list = drafts(plan);
  const seen = new Set<string>();
  const gone = new Set<string>();
  for (const d of list) {
    if (d.levelId !== levelId) continue;
    const k = key(d);
    if (seen.has(k)) gone.add(d.id);
    else seen.add(k);
  }
  // Lines on top of a longer line of the same layer and look.
  const lines = list.filter((d) => d.levelId === levelId && d.shape === "line" && !gone.has(d.id));
  const look = (d: Draft) => `${d.layer ?? ""}|${d.color ?? ""}|${d.linetype ?? ""}|${d.weight ?? ""}`;
  for (const d of lines) {
    const [a, b] = d.points;
    const covered = lines.some((o) => {
      if (o.id === d.id || gone.has(o.id) || look(o) !== look(d)) return false;
      const [p, q] = o.points;
      const L = distance(p, q);
      if (L <= distance(a, b) + 0.5) return false;
      const off = (x: Point) => Math.abs((q.x - p.x) * (x.y - p.y) - (q.y - p.y) * (x.x - p.x)) / L;
      const along = (x: Point) => ((x.x - p.x) * (q.x - p.x) + (x.y - p.y) * (q.y - p.y)) / L;
      return off(a) < 0.5 && off(b) < 0.5 && [a, b].every((x) => along(x) >= -0.5 && along(x) <= L + 0.5);
    });
    if (covered) gone.add(d.id);
  }
  if (!gone.size) return { ok: true, plan, summary: "" };
  return { ok: true, plan: { ...plan, drafts: list.filter((d) => !gone.has(d.id)) }, summary: `${gone.size} duplicate shape${gone.size === 1 ? "" : "s"} removed` };
}

/** Points along a shape's path at the given distances from its start, with the direction there in degrees. */
function along(segs: Segment[], at: number[]): { point: Point; angle: number }[] {
  const out: { point: Point; angle: number }[] = [];
  const lengths = segs.map((s) => (s.t === "line" ? distance(s.a, s.b) : Math.abs(s.sweep) * s.r));
  for (const t of at) {
    let left = t;
    for (let i = 0; i < segs.length; i++) {
      if (left > lengths[i] + 1e-6 && i < segs.length - 1) {
        left -= lengths[i];
        continue;
      }
      const s = segs[i];
      const f = lengths[i] ? Math.min(1, Math.max(0, left / lengths[i])) : 0;
      if (s.t === "line") {
        out.push({ point: { x: s.a.x + (s.b.x - s.a.x) * f, y: s.a.y + (s.b.y - s.a.y) * f }, angle: (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI });
      } else {
        const a = s.a0 + s.sweep * f;
        out.push({ point: { x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) }, angle: ((a + Math.sign(s.sweep) * (Math.PI / 2)) * 180) / Math.PI });
      }
      break;
    }
  }
  return out;
}

/** A point mark: a circle 50 mm across, as AutoCAD's point style. */
const MARK = 25;

/**
 * AutoCAD's DIVIDE (`count` equal parts) and MEASURE (every `every` mm from
 * the start): along a drawn line, arc, polyline or circle, places a library
 * item at each point, turned to follow the path when `align` is set (lights
 * along a bulkhead, chairs round a table), or a small point mark.
 */
export function divideAlong(
  plan: Plan,
  draftId: string,
  how: { count: number } | { every: number },
  place: { item?: string; align?: boolean } = {}
): EditResult {
  const d = drafts(plan).find((x) => x.id === draftId);
  if (!d) return fail("That shape is no longer on the plan.");
  if (d.shape === "text" || d.shape === "dimension" || d.shape === "table") return fail("Divide and measure work along lines, arcs, polylines, circles and ellipses.");
  const segs = segmentsOf(d);
  const total = segs.reduce((s, g) => s + (g.t === "line" ? distance(g.a, g.b) : Math.abs(g.sweep) * g.r), 0);
  if (!(total > 1)) return fail("That shape has no length to divide.");
  const closed = isClosed(d);
  let at: number[];
  if ("count" in how) {
    if (!Number.isInteger(how.count) || how.count < 2 || how.count > 200) return fail("Divide into between 2 and 200 parts.");
    // A closed shape has as many points as parts; an open one has the points between them.
    at = closed ? Array.from({ length: how.count }, (_, i) => (total * i) / how.count) : Array.from({ length: how.count - 1 }, (_, i) => (total * (i + 1)) / how.count);
  } else {
    if (!(how.every > 0)) return fail("Measure every so many mm, more than 0.");
    const n = Math.floor(total / how.every + 1e-6);
    if (n < 1) return fail(`The shape is ${mm(total)} long, shorter than ${mm(how.every)}.`);
    if (n > 200) return fail("That would place more than 200; measure a longer step.");
    at = Array.from({ length: n }, (_, i) => how.every * (i + 1)).filter((t) => t < total - 0.5 || !closed);
  }
  const points = along(segs, at);
  let next = plan;
  const created: PlanItem[] = [];
  for (const p of points) {
    if (place.item) {
      const r = addItem(next, place.item, { x: r1(p.point.x), y: r1(p.point.y) }, d.levelId, place.align ? Math.round((((p.angle % 360) + 360) % 360) * 10) / 10 : 0);
      if (!r.ok) return r;
      next = r.plan;
      if (r.id) created.push({ kind: "item", id: r.id });
    } else {
      const r = addDraft(next, { id: newId(), levelId: d.levelId, shape: "circle", points: [{ x: r1(p.point.x), y: r1(p.point.y) }], radius: MARK, ...(d.layer ? { layer: d.layer } : {}) });
      if (!r.ok) return r;
      next = r.plan;
      created.push({ kind: "draft", id: r.id! });
    }
  }
  const what = place.item ? `${points.length} ${place.item.replace(/-/g, " ")}${points.length === 1 ? "" : "s"}` : `${points.length} point${points.length === 1 ? "" : "s"}`;
  return { ok: true, plan: next, summary: `${what} placed along the ${describeDraft(d).toLowerCase()}`, created };
}
