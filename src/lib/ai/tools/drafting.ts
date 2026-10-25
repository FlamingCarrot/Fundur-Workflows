import { z } from "zod";
import { newId, type EditResult, type Plan, type Point } from "@/lib/plan/geometry";
import {
  addDraft,
  arcThrough,
  chainDimensions,
  linearKind,
  DEFAULT_LAYER,
  drafts,
  drawingLayers,
  HATCHES,
  isClosed,
  LINETYPES,
  polygon,
  rectangle,
  removeDrawingLayer,
  setDrawingLayer,
  updateDraft,
  type Draft,
  type HatchPattern,
} from "@/lib/plan/drafting";
import { breakDraft, explodeDraft, extendDraft, filletCorners, filletLines, joinDrafts, offsetDraft, trimDraft, type CornerCut } from "@/lib/plan/draft-modify";
import { polarArrayMany, scaleMany, stretchIn } from "@/lib/plan/selection";
import { constructionLine, divideAlong, drawOrder, matchProperties, removeDuplicates, revisionCloud, splineThrough, withConstructionLayer } from "@/lib/plan/draft-tools";
import { registerTool } from "./registry";
import { saveEdit } from "./plan-edit";

/**
 * Drafting on the floor plan for the assistant, as in AutoCAD: lines,
 * polylines, rectangles, circles, arcs, polygons, ellipses, text, leaders and
 * hatches on drawing layers, the same shapes and edits the Draw tool makes.
 */

const point = z.object({ x: z.number(), y: z.number() });
const id = z.string().min(1).max(100);
const ref = z.string().min(1).max(40).optional().describe("A name for what this makes, so later operations in this call can use it as an id.");
const style = {
  layer: z.string().max(80).optional().describe("A drawing layer's name or id; a new name makes the layer. Drafting when left out."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("Overrides the layer's colour."),
  linetype: z.enum(LINETYPES).optional(),
  weight: z.number().min(0.05).max(2).optional().describe("Line weight on paper, mm."),
  ref,
};
const hatch = z.object({
  pattern: z.enum(HATCHES),
  scale: z.number().positive().max(100_000).optional().describe("The pattern's repeat in mm, e.g. 600 for 600 mm tiles."),
  angle: z.number().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("line"), from: point, to: point, ...style }),
  z.object({
    op: z.literal("polyline"),
    points: z.array(point).min(2).max(2_000),
    closed: z.boolean().optional(),
    bulges: z.array(z.number().min(-10).max(10)).max(2_000).optional().describe("Per segment: tan(sweep/4), positive bends anticlockwise, 1 is a half circle, 0 straight."),
    hatch: hatch.optional(),
    ...style,
  }),
  z.object({ op: z.literal("rectangle"), corner: point, to: point.optional().describe("The opposite corner."), width: z.number().optional(), depth: z.number().optional(), hatch: hatch.optional(), ...style }),
  z.object({ op: z.literal("circle"), centre: point, radius: z.number().positive(), hatch: hatch.optional(), ...style }),
  z.object({
    op: z.literal("arc"),
    centre: point.optional(),
    radius: z.number().positive().optional(),
    start: z.number().optional().describe("Degrees anticlockwise from +x; the arc runs anticlockwise from start to end."),
    end: z.number().optional(),
    from: point.optional().describe("Or: an arc through three points, from, through, to."),
    through: point.optional(),
    to: point.optional(),
    ...style,
  }),
  z.object({ op: z.literal("polygon"), centre: point, radius: z.number().positive().describe("Centre to corner."), sides: z.number().int().min(3).max(64), rotation: z.number().optional(), hatch: hatch.optional(), ...style }),
  z.object({ op: z.literal("ellipse"), centre: point, radius: z.number().positive(), radius2: z.number().positive(), rotation: z.number().optional(), hatch: hatch.optional(), ...style }),
  z.object({ op: z.literal("text"), at: point.describe("Bottom left of the first line."), text: z.string().min(1).max(500), height: z.number().positive().optional().describe("mm on the plan; 150 by default, about 3 mm on paper at 1:50."), rotation: z.number().optional(), ...style }),
  z.object({ op: z.literal("leader"), points: z.array(point).min(2).max(20).describe("The arrow's tip first, then its bends; the text sits at the last point."), text: z.string().max(500).optional(), height: z.number().positive().optional(), ...style }),
  z.object({
    op: z.literal("hatch"),
    target: id.describe("A closed shape's draft id (it gets the fill) or a room id (a hatch is drawn over its outline on the Hatch layer)."),
    ...hatch.shape,
    layer: style.layer,
    ref,
  }),
  z.object({
    op: z.literal("set"),
    draftId: id,
    layer: z.string().max(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional().describe("null goes back to the layer's colour."),
    linetype: z.enum(LINETYPES).nullable().optional(),
    weight: z.number().min(0.05).max(2).nullable().optional(),
    text: z.string().max(500).optional(),
    height: z.number().positive().optional(),
    radius: z.number().positive().optional(),
    radius2: z.number().positive().optional(),
    rotation: z.number().optional(),
    start: z.number().optional(),
    end: z.number().optional(),
    points: z.array(point).min(1).max(2_000).optional(),
    closed: z.boolean().optional(),
    hatch: hatch.nullable().optional().describe("null removes the hatch."),
    rows: z.array(z.array(z.string().max(200)).max(30)).min(1).max(200).optional().describe("A table's words, every row in full, the first row its heading."),
    widths: z.array(z.number().positive()).max(30).optional().describe("A table's column widths in mm."),
    rowHeight: z.number().positive().optional(),
  }),
  z.object({
    op: z.literal("layer"),
    name: z.string().min(1).max(80).describe("The layer to add or change."),
    rename: z.string().min(1).max(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    linetype: z.enum(LINETYPES).optional(),
    weight: z.number().min(0.05).max(2).optional(),
    hidden: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
  z.object({ op: z.literal("remove_layer"), name: z.string().min(1).max(80), moveTo: z.string().max(80).optional() }),
  z.object({ op: z.literal("offset"), draftId: id, distance: z.number().positive().describe("mm."), side: point.describe("Any point on the side the copy goes."), ref }),
  z.object({ op: z.literal("trim"), draftId: id, at: point.describe("A point on the part to cut away; it goes back to the nearest crossing shapes or wall faces either side.") }),
  z.object({ op: z.literal("extend"), draftId: id, end: point.describe("A point near the end to run on to the next shape or wall face.") }),
  z.object({
    op: z.literal("fillet"),
    draftId: id,
    at: point.describe("A point on the part of the first line to keep, or near the polyline corner to round."),
    otherId: id.optional().describe("The second line; leave out to round a polyline's corner, or all its corners with allCorners."),
    otherAt: point.optional().describe("A point on the part of the second line to keep."),
    radius: z.number().min(0).describe("mm; 0 brings two lines to a sharp corner."),
    allCorners: z.boolean().optional(),
  }),
  z.object({
    op: z.literal("chamfer"),
    draftId: id,
    at: point,
    otherId: id.optional(),
    otherAt: point.optional(),
    distance: z.number().positive().describe("mm back from the corner along the first side."),
    distance2: z.number().positive().optional().describe("Along the second side; the same as distance when left out."),
    allCorners: z.boolean().optional(),
  }),
  z.object({ op: z.literal("break"), draftId: id, at: point, to: point.optional().describe("With a second point, the part between goes.") }),
  z.object({ op: z.literal("join"), draftIds: z.array(id).min(2).max(200).describe("Lines, arcs and open polylines meeting end to end."), ref }),
  z.object({ op: z.literal("explode"), draftId: id }),
  z.object({
    op: z.literal("polar_array"),
    draftIds: z.array(id).min(1).max(200),
    count: z.number().int().min(2).max(100).describe("How many round the centre, the original included."),
    centre: point,
    fill: z.number().min(-360).max(360).optional().describe("Degrees to spread over; 360 by default."),
  }),
  z.object({
    op: z.literal("dimension"),
    kind: z.enum(["linear", "horizontal", "vertical", "aligned", "angular", "radius", "diameter"]).describe("linear picks horizontal or vertical from where `at` is, as AutoCAD's DIMLINEAR."),
    from: point.optional().describe("Linear and aligned: the first measured point. Angular: a point on the first side."),
    to: point.optional().describe("Linear and aligned: the second measured point. Angular: a point on the second side."),
    vertex: point.optional().describe("Angular: the corner."),
    centre: point.optional().describe("Radius and diameter: the circle's centre (or give draftId)."),
    draftId: id.optional().describe("Radius and diameter: the circle or arc to dimension."),
    at: point.describe("Where the dimension line, arc or radius line goes; for radius and diameter, a point the line points towards."),
    text: z.string().max(200).optional().describe("Words in place of the measurement; <> stands for the measurement, as in 'APPROX <>'."),
    height: z.number().positive().optional().describe("Text height in mm on the plan; 150 by default."),
    ...style,
  }),
  z.object({
    op: z.literal("dimension_chain"),
    points: z.array(point).min(2).max(200).describe("The points to dimension between, in order along the run."),
    at: point.describe("A point the shared dimension line passes through."),
    kind: z.enum(["horizontal", "vertical", "aligned"]).optional(),
    height: z.number().positive().optional(),
    ...style,
  }),
  z.object({ op: z.literal("scale"), draftIds: z.array(id).min(1).max(2_000), factor: z.number().positive().max(1000), about: point.optional() }),
  z.object({
    op: z.literal("revision_cloud"),
    points: z.array(point).min(3).max(500).optional().describe("The outline to ring, as corners; or give from and to for a box."),
    from: point.optional(),
    to: point.optional(),
    arc: z.number().positive().optional().describe("Arc length in mm; 300 by default."),
    ...style,
  }),
  z.object({ op: z.literal("spline"), points: z.array(point).min(2).max(200).describe("Points the smooth curve passes through."), closed: z.boolean().optional(), ...style }),
  z.object({ op: z.literal("construction_line"), through: point, towards: point.describe("A second point setting its direction; it runs 50 m each way on the Construction lines layer."), ref }),
  z.object({ op: z.literal("match"), from: id.describe("The shape to copy layer, colour, line type, weight, hatch and text height from."), draftIds: z.array(id).min(1).max(2_000) }),
  z.object({ op: z.literal("draw_order"), draftIds: z.array(id).min(1).max(2_000), to: z.enum(["front", "back"]) }),
  z.object({ op: z.literal("remove_duplicates") }),
  z.object({
    op: z.literal("divide"),
    draftId: id.describe("A line, arc, polyline, circle or ellipse."),
    count: z.number().int().min(2).max(200).optional().describe("Divide into this many equal parts (AutoCAD's DIVIDE)."),
    every: z.number().positive().optional().describe("Or place one every so many mm from the start (AutoCAD's MEASURE)."),
    item: z.string().max(80).optional().describe("A furniture library type to place at each point, such as a light; small point marks when left out."),
    align: z.boolean().optional().describe("Turn each item to follow the path."),
  }),
  z.object({
    op: z.literal("table"),
    at: point.describe("The table's top left corner."),
    rows: z.array(z.array(z.string().max(200)).max(30)).min(1).max(200).describe("The words row by row; the first row is the heading, drawn bold. Use \"\" for an empty cell."),
    widths: z.array(z.number().positive()).max(30).optional().describe("Column widths in mm on the plan; 10 times the text height each by default."),
    height: z.number().positive().optional().describe("Text height in mm on the plan; 150 by default."),
    rowHeight: z.number().positive().optional().describe("Row height in mm; 2.4 times the text height by default."),
    ...style,
  }),
  z.object({
    op: z.literal("stretch"),
    from: point.describe("One corner of the box."),
    to: point.describe("The opposite corner."),
    by: point.describe("How far the points in the box move, as x and y in mm."),
  }),
]);

export type DraftOperation = z.infer<typeof operation>;

const DEFAULT_HATCH_SCALE: Record<HatchPattern, number> = { solid: 100, diagonal: 150, cross: 150, tiles: 600, brick: 230, herringbone: 300, timber: 180, concrete: 300, insulation: 100, dots: 100 };

/** Applies drafting operations in order on one floor; all or nothing. */
export function applyDraftOps(start: Plan, levelId: string, ops: DraftOperation[]): { ok: true; plan: Plan; changes: string[]; made: Record<string, string> } | { ok: false; error: string } {
  let plan = start;
  const changes: string[] = [];
  const made: Record<string, string> = {};
  const real = (v: string) => made[v] ?? v;

  /** A layer by name or id, made when it is new. */
  const layerId = (name?: string): string | undefined | { error: string } => {
    if (!name) return undefined;
    const wanted = name.trim().toLowerCase();
    const found = drawingLayers(plan).find((l) => l.id === name || l.name.toLowerCase() === wanted);
    if (found) return found.id === DEFAULT_LAYER ? undefined : found.id;
    const r = setDrawingLayer(plan, { name: name.trim() });
    if (!r.ok) return { error: r.error };
    plan = r.plan;
    changes.push(r.summary);
    return r.id;
  };

  for (const [i, op] of ops.entries()) {
    let result: EditResult | null = null;
    const draw = (d: Omit<Draft, "id" | "levelId" | "layer" | "color" | "linetype" | "weight">, extra?: { hatch?: z.infer<typeof hatch> }) => {
      const s = op as { layer?: string; color?: string; linetype?: Draft["linetype"]; weight?: number };
      const layer = layerId(s.layer);
      if (layer && typeof layer === "object") return { ok: false, error: layer.error } as EditResult;
      const fill = extra?.hatch ? { pattern: extra.hatch.pattern, scale: extra.hatch.scale ?? DEFAULT_HATCH_SCALE[extra.hatch.pattern], angle: extra.hatch.angle ?? 0, ...(extra.hatch.color ? { color: extra.hatch.color } : {}) } : undefined;
      return addDraft(plan, { ...d, levelId, ...(layer ? { layer } : {}), ...(s.color ? { color: s.color } : {}), ...(s.linetype ? { linetype: s.linetype } : {}), ...(s.weight ? { weight: s.weight } : {}), ...(fill ? { fill } : {}) });
    };
    switch (op.op) {
      case "line":
        result = draw({ shape: "line", points: [op.from, op.to] });
        break;
      case "polyline":
        result = draw({ shape: "polyline", points: op.points, ...(op.closed ? { closed: true } : {}), ...(op.bulges ? { bulges: op.bulges } : {}) }, { hatch: op.hatch });
        break;
      case "rectangle": {
        const to = op.to ?? (op.width && op.depth ? { x: op.corner.x + op.width, y: op.corner.y + op.depth } : null);
        result = to ? draw({ shape: "polyline", points: rectangle(op.corner, to), closed: true }, { hatch: op.hatch }) : { ok: false, error: "Give the opposite corner, or a width and depth." };
        break;
      }
      case "circle":
        result = draw({ shape: "circle", points: [op.centre], radius: op.radius }, { hatch: op.hatch });
        break;
      case "arc": {
        if (op.from && op.through && op.to) {
          const a = arcThrough(op.from, op.through, op.to);
          result = a ? draw({ shape: "arc", points: [a.centre], radius: a.radius, start: a.start, end: a.end }) : { ok: false, error: "Those three points lie on a line." };
        } else if (op.centre && op.radius && op.start != null && op.end != null) {
          result = draw({ shape: "arc", points: [op.centre], radius: op.radius, start: op.start, end: op.end });
        } else result = { ok: false, error: "Give an arc's centre, radius, start and end, or three points it passes through." };
        break;
      }
      case "polygon": {
        const a = ((op.rotation ?? 90) * Math.PI) / 180;
        result = draw({ shape: "polyline", points: polygon(op.centre, { x: op.centre.x + Math.cos(a) * op.radius, y: op.centre.y + Math.sin(a) * op.radius }, op.sides), closed: true }, { hatch: op.hatch });
        break;
      }
      case "ellipse":
        result = draw({ shape: "ellipse", points: [op.centre], radius: op.radius, radius2: op.radius2, ...(op.rotation ? { rotation: op.rotation } : {}) }, { hatch: op.hatch });
        break;
      case "text":
        result = draw({ shape: "text", points: [op.at], text: op.text, ...(op.height ? { height: op.height } : {}), ...(op.rotation ? { rotation: op.rotation } : {}) });
        break;
      case "leader":
        result = draw({ shape: "leader", points: op.points, ...(op.text ? { text: op.text } : {}), ...(op.height ? { height: op.height } : {}) });
        break;
      case "hatch": {
        const fill = { pattern: op.pattern, scale: op.scale ?? DEFAULT_HATCH_SCALE[op.pattern], angle: op.angle ?? 0, ...(op.color ? { color: op.color } : {}) };
        const target = real(op.target);
        const shape = drafts(plan).find((d) => d.id === target);
        const room = plan.rooms.find((r) => r.id === target);
        if (shape) result = isClosed(shape) ? updateDraft(plan, shape.id, { fill }) : { ok: false, error: "Only closed shapes can be hatched." };
        else if (room) {
          const layer = layerId(op.layer ?? "Hatch");
          if (layer && typeof layer === "object") result = { ok: false, error: layer.error };
          else result = addDraft(plan, { shape: "polyline", levelId: room.levelId, points: room.points, closed: true, fill, ...(layer ? { layer } : {}) });
        } else result = { ok: false, error: `There is no closed shape or room "${op.target}".` };
        break;
      }
      case "set": {
        const { op: _o, draftId, layer, hatch: h, rows, ...patch } = op;
        void _o;
        const lid = layer === undefined ? undefined : layerId(layer);
        if (lid && typeof lid === "object") {
          result = { ok: false, error: lid.error };
          break;
        }
        result = updateDraft(plan, real(draftId), {
          ...patch,
          ...(rows ? { cells: rows } : {}),
          ...(layer !== undefined ? { layer: lid ?? null } : {}),
          ...(h === null ? { fill: null } : h ? { fill: { pattern: h.pattern, scale: h.scale ?? DEFAULT_HATCH_SCALE[h.pattern], angle: h.angle ?? 0, ...(h.color ? { color: h.color } : {}) } } : {}),
        });
        break;
      }
      case "layer": {
        const wanted = op.name.trim().toLowerCase();
        const found = drawingLayers(plan).find((l) => l.id === op.name || l.name.toLowerCase() === wanted);
        result = setDrawingLayer(plan, {
          ...(found ? { id: found.id } : {}),
          name: op.rename ?? found?.name ?? op.name,
          ...(op.color ? { color: op.color } : {}),
          ...(op.linetype ? { linetype: op.linetype } : {}),
          ...(op.weight ? { weight: op.weight } : {}),
          ...(op.hidden != null ? { hidden: op.hidden } : {}),
          ...(op.locked != null ? { locked: op.locked } : {}),
        });
        break;
      }
      case "offset":
        result = offsetDraft(plan, real(op.draftId), op.distance, op.side);
        break;
      case "trim":
        result = trimDraft(plan, real(op.draftId), op.at);
        break;
      case "extend":
        result = extendDraft(plan, real(op.draftId), op.end);
        break;
      case "fillet":
      case "chamfer": {
        const how: CornerCut = op.op === "fillet" ? { radius: op.radius } : { chamfer: [op.distance, op.distance2 ?? op.distance] };
        const first = real(op.draftId);
        if (op.otherId) result = filletLines(plan, first, op.at, real(op.otherId), op.otherAt ?? op.at, how);
        else if (op.allCorners) result = filletCorners(plan, first, how);
        else {
          const shape = drafts(plan).find((d) => d.id === first);
          result = shape ? filletLines(plan, first, op.at, first, op.at, how) : { ok: false, error: "That shape is no longer on the plan." };
        }
        break;
      }
      case "break":
        result = breakDraft(plan, real(op.draftId), op.at, op.to);
        break;
      case "join":
        result = joinDrafts(plan, op.draftIds.map(real));
        break;
      case "explode":
        result = explodeDraft(plan, real(op.draftId));
        break;
      case "polar_array":
        result = polarArrayMany(plan, op.draftIds.map((d) => ({ kind: "draft" as const, id: real(d) })), op.count, op.centre, op.fill ?? 360);
        break;
      case "dimension": {
        const extra = { ...(op.text ? { text: op.text } : {}), ...(op.height ? { height: op.height } : {}) };
        if (op.kind === "radius" || op.kind === "diameter") {
          const shape = op.draftId ? drafts(plan).find((d) => d.id === real(op.draftId!)) : undefined;
          if (op.draftId && (!shape || (shape.shape !== "circle" && shape.shape !== "arc"))) {
            result = { ok: false, error: "Radius and diameter dimensions go on a circle or an arc." };
            break;
          }
          const centre = shape ? shape.points[0] : op.centre;
          const r = shape?.radius ?? (op.centre && op.from ? Math.hypot(op.from.x - op.centre.x, op.from.y - op.centre.y) : undefined);
          if (!centre || !r) {
            result = { ok: false, error: "Give the circle as draftId, or its centre and a point on it as from." };
            break;
          }
          const L = Math.hypot(op.at.x - centre.x, op.at.y - centre.y) || 1;
          const edge = { x: centre.x + ((op.at.x - centre.x) / L) * r, y: centre.y + ((op.at.y - centre.y) / L) * r };
          result = draw({ shape: "dimension", dim: op.kind, points: [centre, edge], ...extra });
        } else if (op.kind === "angular") {
          if (!op.vertex || !op.from || !op.to) {
            result = { ok: false, error: "An angle dimension needs vertex, from and to." };
            break;
          }
          result = draw({ shape: "dimension", dim: "angular", points: [op.vertex, op.from, op.to, op.at], ...extra });
        } else {
          if (!op.from || !op.to) {
            result = { ok: false, error: "A linear dimension needs from and to." };
            break;
          }
          const dim = op.kind === "linear" ? linearKind(op.from, op.to, op.at) : op.kind;
          result = draw({ shape: "dimension", dim, points: [op.from, op.to, op.at], ...extra });
        }
        break;
      }
      case "dimension_chain": {
        const layer = layerId(op.layer);
        if (layer && typeof layer === "object") {
          result = { ok: false, error: layer.error };
          break;
        }
        result = chainDimensions(plan, { levelId, points: op.points, at: op.at, ...(op.kind ? { kind: op.kind } : {}), ...(layer ? { layer } : {}), ...(op.color ? { color: op.color } : {}), ...(op.linetype ? { linetype: op.linetype } : {}), ...(op.weight ? { weight: op.weight } : {}), ...(op.height ? { height: op.height } : {}) });
        break;
      }
      case "scale":
        result = scaleMany(plan, op.draftIds.map((d) => ({ kind: "draft" as const, id: real(d) })), op.factor, op.about);
        break;
      case "revision_cloud": {
        const outline = op.points ?? (op.from && op.to ? rectangle(op.from, op.to) : null);
        const cloud = outline ? revisionCloud(outline, op.arc ?? 300) : null;
        result = cloud ? draw(cloud) : { ok: false, error: "Give the outline as three or more points, or from and to for a box, with some area." };
        break;
      }
      case "spline":
        result = draw({ shape: "polyline", points: splineThrough(op.points, !!op.closed), ...(op.closed && op.points.length >= 3 ? { closed: true } : {}) });
        break;
      case "construction_line": {
        const ends = constructionLine(op.through, op.towards);
        if (!ends) {
          result = { ok: false, error: "Give two different points for its direction." };
          break;
        }
        const { plan: withLayer, layer } = withConstructionLayer(plan);
        result = addDraft(withLayer, { levelId, shape: "line", points: ends, layer });
        break;
      }
      case "match":
        result = matchProperties(plan, real(op.from), op.draftIds.map(real));
        break;
      case "draw_order":
        result = drawOrder(plan, op.draftIds.map(real), op.to);
        break;
      case "remove_duplicates":
        result = removeDuplicates(plan, levelId);
        break;
      case "divide":
        if ((op.count == null) === (op.every == null)) {
          result = { ok: false, error: "Give count to divide into equal parts, or every to measure a step." };
          break;
        }
        result = divideAlong(plan, real(op.draftId), op.count != null ? { count: op.count } : { every: op.every! }, { ...(op.item ? { item: op.item } : {}), ...(op.align ? { align: true } : {}) });
        break;
      case "table":
        result = draw({ shape: "table", points: [op.at], cells: op.rows, ...(op.widths ? { widths: op.widths } : {}), ...(op.height ? { height: op.height } : {}), ...(op.rowHeight ? { rowHeight: op.rowHeight } : {}) });
        break;
      case "stretch":
        result = stretchIn(plan, levelId, { minX: op.from.x, minY: op.from.y, maxX: op.to.x, maxY: op.to.y }, op.by);
        break;
      case "remove_layer": {
        const find = (n: string) => drawingLayers(plan).find((l) => l.id === n || l.name.toLowerCase() === n.trim().toLowerCase());
        const layer = find(op.name);
        const to = op.moveTo ? find(op.moveTo) : undefined;
        result = !layer ? { ok: false, error: `There is no drawing layer "${op.name}".` } : op.moveTo && !to ? { ok: false, error: `There is no drawing layer "${op.moveTo}".` } : removeDrawingLayer(plan, layer.id, to?.id);
        break;
      }
    }
    if (!result || !result.ok) return { ok: false, error: `Operation ${i + 1} (${op.op}) failed: ${result?.error ?? "it did nothing"} Nothing was changed.` };
    plan = result.plan;
    if (result.summary) changes.push(result.summary);
    const key = (op as { ref?: string }).ref;
    if (key && result.id) made[key] = result.id;
  }
  return { ok: true, plan, changes, made };
}

/** For tests: a fresh id is what addDraft makes; this keeps the import used in one place. */
export const draftId = newId;

registerTool({
  name: "draft_on_plan",
  module: "floor_plan_editor",
  label: "Drafting on the plan",
  description:
    "Drafts on the floor plan as in AutoCAD, live in front of the designer: lines, polylines (with arc segments by bulge), rectangles, circles, arcs (centre/radius/angles or three points), regular polygons, ellipses, text, leaders (an arrow with words) and hatches (solid, diagonal, cross, tiles, brick, herringbone, timber, concrete, insulation, dots) on any closed shape or over a room. " +
    "Use it for joinery setting out, ceiling bulkheads and lighting lines, floor patterns, details, centre lines and annotation that walls and furniture do not cover. " +
    "Each shape sits on a drawing layer (Drafting, Joinery, Ceiling, Flooring, Hatch, Annotation, Hidden lines, Centre lines, or any new name) that sets its colour, line type and weight; layer adds, restyles, hides or locks one. set changes a shape (draft id from read_plan_detail or her selection). " +
    "Modify as in CAD: offset (a parallel copy), trim (cut back to crossing shapes or wall faces), extend (run an end on to the next), fillet and chamfer (two lines, one polyline corner, or allCorners), break (split, or take out between two points), join (end-to-end pieces into one polyline), explode (a polyline into lines and arcs), polar_array (copies round a centre, turned as they go), scale, and stretch (every wall end, room corner, shape point and dimension end inside a box moves by `by`, so boxing one side of a room makes the room longer with its walls, floor and joinery lines). " +
    "revision_cloud rings a change in arcs (REVCLOUD); spline draws a smooth curve through points (a polyline, so every Modify works on it); construction_line draws a setting-out guide through two points, 50 m each way on the Construction lines layer (XLINE). " +
    "match copies one shape's layer, colour, line type, weight, hatch and text height onto others (MATCHPROP); draw_order brings shapes to the front or sends them back (a hatch under its lines); remove_duplicates clears shapes drawn twice on this floor (OVERKILL, good after a DXF import); divide places library items or point marks along a shape, count equal parts or every so many mm, e.g. downlights along a bulkhead line. " +
    "table puts a CAD table on the plan (a finishes, door or joinery schedule, a legend or a title block): rows of words with the first row as its heading; set with rows changes its words, widths and rowHeight its size; explode turns it into lines and text. " +
    "Dimensions as in CAD, on drawing layers: linear (horizontal or vertical by placement), aligned, angular, radius and diameter, and dimension_chain for a run of dimensions on one line; they print on sheets and export to DXF. " +
    "Millimetres, x right, y up; angles in degrees anticlockwise from +x. Moving, copying, mirroring, arrays and removing drawn shapes go through edit_plan with target kind draft. Saved at once; she can undo it.",
  input: z.object({
    floor: z.string().max(120).optional().describe("A floor's name or id; the floor she is looking at, else the first."),
    operations: z.array(operation).min(1).max(400),
  }),
  async run(ctx, input) {
    const out = await saveEdit(ctx, (plan) => {
      const wanted = input.floor?.trim().toLowerCase();
      const level =
        (wanted && plan.levels.find((l) => l.id === input.floor || l.name.toLowerCase() === wanted)) ||
        (!wanted && ctx.context?.levelId && plan.levels.find((l) => l.id === ctx.context!.levelId)) ||
        (!wanted ? plan.levels[0] : undefined);
      if (!level) return { ok: false, error: `There is no floor "${input.floor}". Floors: ${plan.levels.map((l) => l.name).join(", ")}.` };
      return applyDraftOps(plan, level.id, input.operations);
    });
    if ("error" in out) return { content: out.error, isError: true };
    const refs = Object.entries(out.made);
    return {
      content: [
        `Drawn and saved (${out.edit.changes.length} change${out.edit.changes.length === 1 ? "" : "s"}); she sees it now and can undo it.`,
        ...out.edit.changes.map((c) => `- ${c}`),
        refs.length ? `Ids: ${refs.map(([k, v]) => `${k} = ${v}`).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      planEdit: out.edit,
    };
  },
});

export type { Point };
