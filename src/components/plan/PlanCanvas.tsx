"use client";

import { visiblePart, type HideState } from "@/lib/plan/hide";
import { phaseView, type PhaseView } from "@/lib/plan/phases";
import { areaReading, pointReading, tapeReading } from "@/lib/plan/tape";
import { markAt } from "@/lib/plan/marks";
import { ceilingHeight, ceilingLines, ceilingPlan, CEILINGS, type PlanLook } from "@/lib/plan/ceilings";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addColumn,
  addOpening,
  addRoom,
  addWall,
  centroid,
  distance,
  m2,
  mm,
  nearestWall,
  onLevel,
  openingsFit,
  planBounds,
  pointAlong,
  pointInPolygon,
  polygonArea,
  removeItem,
  roomArea,
  samePoint,
  wallLength,
  DEFAULTS,
  type EditResult,
  type Item,
  type Opening,
  type Plan,
  type PlanItem,
  type Point,
  type Wall,
} from "@/lib/plan/geometry";
import { isPinned } from "@/lib/plan/pins";
import { meetWall, SNAP_LABEL, snapPoint, type SnapKind } from "@/lib/plan/snaps";
import { splitWall, trimToCorner } from "@/lib/plan/wall-tools";
import { COMMAND_HELP, parseCommand, resolvePoint, type CommandTool } from "@/lib/plan/command";
import { breakDraft, explodeDraft, joinDrafts, extendDraft, filletLines, offsetDraft, trimDraft } from "@/lib/plan/draft-modify";
import { addDraft, arcThrough, chainDimensions, linearKind, distanceTo, drafts as draftsOf, isClosed, polygon, rectangle, styleOf, updateDraft, DEFAULT_TEXT_HEIGHT, type Draft } from "@/lib/plan/drafting";
import { DraftLayer, DraftMark } from "./DraftLayer";
import { addDimension, addNote, doorLeaves, duplicate, moveBy, moveCorner, roomAt, rotateItem } from "@/lib/plan/elements";
import { snapItemDelta } from "@/lib/layout/options";
import type { Shape } from "@/lib/plan/library";
import { itemSymbol } from "@/lib/blueprints/symbol";
import { placeBlueprint } from "@/lib/blueprints/plan-edits";
import { useResolver } from "@/components/library/LibraryContext";
import { useViewSetting, useViewSettingsLoaded } from "@/lib/view-settings/client";
import { editFurniture } from "@/lib/plan/groups";
import { duplicateMany, inBox, isSelected, moveMany, outlineOf, removeMany, rotateMany, selectionBounds, stretchIn, unique } from "@/lib/plan/selection";
import { openingSpacing, selectionSpacing, snapAlignment, snapOpening, snapWallDelta, wallSpacing, type SpacingGuide, type AlignmentGuide } from "@/lib/plan/spacing";

/**
 * The plan on screen (P3-04, P3-05, P3-08): pan and zoom with a mouse,
 * trackpad or fingers, pick things to edit and drag them, and draw walls,
 * partitions, rooms, doors, windows, columns, furniture, notes and dimension
 * lines with typed lengths. One floor is shown at a time, with the walls of
 * the floor below drawn faintly to line up with.
 *
 * The drawing is SVG in millimetres with y pointing up, as in CAD; it is
 * flipped to screen only where points are written out, so text stays upright.
 */

export type Tool =
  | "select"
  | "wall"
  | "partition"
  | "door"
  | "window"
  | "column"
  | "room"
  | "outline"
  | "item"
  | "note"
  | "dimension"
  | "calibrate"
  | "split"
  | "trim"
  | "tape"
  | "draft"
  | "hatch";

/** What the Draw tool draws. Rectangles and polygons become closed polylines. */
export type DraftTool = "line" | "polyline" | "rectangle" | "circle" | "arc" | "polygon" | "ellipse" | "text" | "leader" | "table" | ModifyTool | DimTool;

/** CAD's dimension tools, on the Draw tool's bar after the Modify tools. */
export type DimTool = "dimlinear" | "dimangular" | "dimradius" | "dimdiameter" | "dimchain";

export const DIM_TOOLS: { key: DimTool; label: string; hint: string[] }[] = [
  { key: "dimlinear", label: "Linear", hint: ["Click the first point to measure from.", "Click the second point.", "Click where the dimension line goes: above or below for across, to a side for up."] },
  { key: "dimangular", label: "Angle", hint: ["Click the corner of the angle.", "Click a point on the first side.", "Click a point on the second side.", "Click where the arc goes."] },
  { key: "dimradius", label: "Radius", hint: ["Click a drawn circle or arc.", "Click which way the radius line points."] },
  { key: "dimdiameter", label: "Diameter", hint: ["Click a drawn circle or arc.", "Click which way the diameter line runs."] },
  { key: "dimchain", label: "Chain", hint: ["Click the first point of the run.", "Click each point along it; Enter or double-click when done.", "Click where the dimension line goes."] },
];

/** CAD's Modify tools for drawn shapes, on the Draw tool's bar after the shapes. */
export type ModifyTool = "trim" | "extend" | "offset" | "fillet" | "chamfer" | "break" | "stretch";

export const MODIFY_TOOLS: { key: ModifyTool; label: string; hint: string[] }[] = [
  { key: "trim", label: "Trim", hint: ["Click the part of a drawn shape to cut away; it goes back to the shapes or walls crossing it."] },
  { key: "extend", label: "Extend", hint: ["Click near the end of a line, arc or polyline to run it on to the next shape or wall."] },
  { key: "offset", label: "Offset", hint: ["Click the shape to offset.", "Click the side the copy goes."] },
  { key: "fillet", label: "Fillet", hint: ["Click the first line on the part to keep, or a polyline near the corner to round.", "Click the second line on the part to keep."] },
  { key: "chamfer", label: "Chamfer", hint: ["Click the first line on the part to keep, or a polyline near the corner to cut.", "Click the second line on the part to keep."] },
  { key: "break", label: "Break", hint: ["Click where to break the shape.", "Click a second point to take the part between out, or press Enter to split it there."] },
  { key: "stretch", label: "Stretch", hint: ["Click one corner of a box round the ends to move; walls, rooms and shapes stretch.", "Click the opposite corner.", "Click the base point.", "Click where it goes, or type @dx,dy below."] },
];

const MODIFY_KEYS = new Set<DraftTool>(MODIFY_TOOLS.map((t) => t.key));

/** The Offset distance, the Fillet radius and the Chamfer distance, in mm, and the polar tracking step in degrees. */
export interface DraftAmounts {
  offset: number;
  radius: number;
  chamfer: number;
  polar?: number;
}

export const DEFAULT_AMOUNTS: DraftAmounts = { offset: 100, radius: 100, chamfer: 100, polar: 45 };

export type TapeMode = "distance" | "area" | "point";

/** Polar tracking steps to choose from, in degrees. */
export const POLAR_STEPS = [90, 45, 30, 22.5, 15, 10, 5] as const;

export const DRAFT_TOOLS: { key: DraftTool; label: string; hint: string[] }[] = [
  { key: "line", label: "Line", hint: ["Click where the line starts.", "Click where it ends, or type a length (or dx,dy) and Enter. Lines carry on from the last end; Esc stops."] },
  { key: "polyline", label: "Polyline", hint: ["Click the first point.", "Click each point; type a length and Enter for an exact one. Click the first point to close, Enter or double-click to finish."] },
  { key: "rectangle", label: "Rectangle", hint: ["Click one corner.", "Click the opposite corner, or type width,depth and Enter."] },
  { key: "circle", label: "Circle", hint: ["Click the centre.", "Click a point on the circle, or type the radius and Enter."] },
  { key: "arc", label: "Arc", hint: ["Click where the arc starts.", "Click a point it passes through.", "Click where it ends."] },
  { key: "polygon", label: "Polygon", hint: ["Click the centre.", "Click a corner, or type the radius and Enter."] },
  { key: "ellipse", label: "Ellipse", hint: ["Click the centre.", "Click the end of one axis.", "Click to set the other axis."] },
  { key: "text", label: "Text", hint: ["Click where the text starts."] },
  { key: "leader", label: "Leader", hint: ["Click where the arrow points.", "Click where the line bends or ends; Enter or double-click, then type the words."] },
  { key: "table", label: "Table", hint: ["Click where the table's top left corner goes; then type into it in the panel."] },
];

export interface Layers {
  walls: boolean;
  openings: boolean;
  columns: boolean;
  rooms: boolean;
  furniture: boolean;
  notes: boolean;
  dimensions: boolean;
  underlay: boolean;
  below: boolean;
  reference: boolean;
  drafting: boolean;
}

const NO_OTHERS: PlanItem[] = [];
const LAYER_KINDS: [keyof Layers, PlanItem["kind"]][] = [["walls", "wall"], ["openings", "opening"], ["columns", "column"], ["rooms", "room"], ["furniture", "item"], ["notes", "note"], ["dimensions", "dimension"], ["drafting", "draft"]];

export const ALL_LAYERS: Layers = {
  walls: true,
  openings: true,
  columns: true,
  rooms: true,
  furniture: true,
  notes: true,
  dimensions: true,
  underlay: true,
  below: true,
  reference: true,
  drafting: true,
};

interface View {
  /** The world point at the middle of the canvas. */
  cx: number;
  cy: number;
  /** Screen pixels per millimetre. */
  scale: number;
}

const MIN_SCALE = 0.0005; // 1 px = 2 m
const MAX_SCALE = 2; // 1 px = 0.5 mm
const PICK_PX = 9;
const SNAP_PX = 12;
const CLICK_PX = 5;

const isView = (v: unknown): v is View => {
  const w = v as View | null;
  return !!w && typeof w === "object" && [w.cx, w.cy, w.scale].every(Number.isFinite) && w.scale >= MIN_SCALE && w.scale <= MAX_SCALE;
};

const isViewOrNull = (v: unknown): v is View | null => v === null || isView(v);

const TOUCH_SELECT = "Tap to select; drag to move or pan. Turn on Multi-select to tap several things.";
const MULTI_SELECT = "Multi-select is on: tap things to add or remove them.";
const COARSE = "(pointer: coarse)";
const watchCoarse = (done: () => void) => {
  const q = window.matchMedia(COARSE);
  q.addEventListener("change", done);
  return () => q.removeEventListener("change", done);
};
const isCoarse = () => window.matchMedia(COARSE).matches;

const HINTS: Record<Tool, string[]> = {
  select: ["Tap to select; drag to move or pan. Ctrl-drag a box to select (right to left takes what it touches); Shift-click adds to the selection."],
  wall: ["Click where the wall starts.", "Click where it ends, or type its length in mm and press Enter. Esc to stop."],
  partition: ["Click where the partition starts.", "Click where it ends, or type its length in mm and press Enter. Esc to stop."],
  room: ["Click inside walls that close around a space to make it a room."],
  outline: ["Click the room's first corner.", "Click each corner in turn. Click the first corner or press Enter to finish."],
  door: ["Click a wall to put a door in it."],
  window: ["Click a wall to put a window in it."],
  column: ["Click where the column stands."],
  item: ["Click to place it. Space turns it a quarter. Esc when done."],
  note: ["Click where the note goes."],
  dimension: ["Click the first point to measure from.", "Click the second point.", "Click where the dimension line sits."],
  calibrate: ["Click one end of a length you know on the image.", "Click the other end."],
  split: ["Click a wall where it should be cut in two. Esc when done."],
  trim: ["Click the first wall, on the part to keep.", "Click the wall to meet it at a corner, on the part to keep."],
  tape: ["Click where to measure from. Nothing is added to the plan.", "Click where to measure to."],
  draft: ["Pick a shape above, then click to draw."],
  hatch: ["Click inside a room or a closed shape to hatch it."],
};


const Y = (y: number) => -y;
const pts = (points: Point[]) => points.map((p) => `${p.x},${Y(p.y)}`).join(" ");
/** A wall's four corners, for drawing it as an outline. */
const wallOutline = (w: Wall): Point[] => {
  const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
  const n = { x: (-(w.b.y - w.a.y) / L) * (w.thickness / 2), y: ((w.b.x - w.a.x) / L) * (w.thickness / 2) };
  return [{ x: w.a.x + n.x, y: w.a.y + n.y }, { x: w.b.x + n.x, y: w.b.y + n.y }, { x: w.b.x - n.x, y: w.b.y - n.y }, { x: w.a.x - n.x, y: w.a.y - n.y }];
};
const DRAGGABLE = new Set<PlanItem["kind"]>(["item", "column", "note", "dimension", "opening", "wall", "draft"]);

function niceLength(target: number): number {
  const power = 10 ** Math.floor(Math.log10(target));
  const n = target / power;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
}

/** Angles snap to 45° steps (or `degrees`) unless Alt is held, so walls come out square. */
function constrain(from: Point, to: Point, free: boolean, degrees = 45): Point {
  if (free) return to;
  const len = distance(from, to);
  const step = (degrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** The direction from `a` to `b` in degrees anticlockwise from +x, 0 to 360, to one decimal. */
const angleOf = (a: Point, b: Point) => Math.round(((((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 360) + 360) % 360 * 10) / 10 % 360;

function fitView(plan: Plan, size: { w: number; h: number }): View {
  const b = planBounds(plan);
  if (!b) return { cx: 6_000, cy: 4_000, scale: Math.min(size.w / 16_000, size.h / 11_000) };
  const w = Math.max(b.maxX - b.minX, 1_000);
  const h = Math.max(b.maxY - b.minY, 1_000);
  const scale = Math.min(size.w / (w * 1.18), size.h / (h * 1.18));
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale)) };
}

/** A point in an item's own frame, to test whether a click is on it. */
function inItem(item: Item, p: Point, margin: number): boolean {
  const a = (-item.rotation * Math.PI) / 180;
  const dx = p.x - item.at.x;
  const dy = p.y - item.at.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= item.width / 2 + margin && Math.abs(ly) <= item.depth / 2 + margin;
}

function toSegment(p: Point, a: Point, b: Point): number {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
  return distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}

/** The line a dimension is drawn on, set off from the two points it measures. */
function dimensionLine(a: Point, b: Point, offset: number): [Point, Point] {
  const len = distance(a, b) || 1;
  const n = { x: (-(b.y - a.y) / len) * offset, y: ((b.x - a.x) / len) * offset };
  return [
    { x: a.x + n.x, y: a.y + n.y },
    { x: b.x + n.x, y: b.y + n.y },
  ];
}

/** Which side of a→b a point is on, and how far: the offset a dimension line through it would have. */
function offsetTo(a: Point, b: Point, p: Point): number {
  const len = distance(a, b) || 1;
  return ((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / len;
}

type Gesture =
  | { kind: "marquee"; from: Point; to: Point; x: number; y: number; moved: boolean }
  | { kind: "pan"; x: number; y: number; view: View; moved: boolean }
  | { kind: "pinch"; dist: number; mid: { x: number; y: number }; view: View }
  | { kind: "drag"; target: PlanItem; copy: boolean; from: Point; x: number; y: number; moved: boolean }
  | { kind: "corner"; from: Point; x: number; y: number; moved: boolean };

export function PlanCanvas({
  plan,
  levelId,
  viewKey,
  compare,
  layers,
  tool,
  placeType,
  underlaySrc,
  selection,
  selectionIds = [],
  onMultiSelect,
  others = NO_OTHERS,
  roomFills,
  hidden,
  phase = "all",
  marks,
  look = "floor",
  onOthers,
  multiMode = false,
  onSelect,
  onEdit,
  onToolDone,
  onCalibrate,
  fitSignal,
  flagged,
  onDistanceSelect,
  draftTool = "line",
  draftLayer,
  polygonSides = 6,
  hatchStyle,
  draftAmounts = DEFAULT_AMOUNTS,
  onDraftCommand,
  onPolar,
  tapeMode = "distance",
}: {
  plan: Plan;
  levelId: string;
  /** Where the zoom and position this floor was left at are remembered. */
  viewKey: string;
  compare?: Plan | null;
  layers: Layers;
  tool: Tool;
  /** The library item the furniture tool places. */
  placeType: string;
  /** Where the tracing image on this floor can be loaded from. */
  underlaySrc?: string;
  selection: PlanItem | null;
  onSelect: (item: PlanItem | null, additive?: boolean) => void;
  selectionIds?: string[];
  onMultiSelect?: (ids: string[]) => void;
  /** Walls, rooms, columns and the rest selected together, beside the furniture in selectionIds. */
  others?: PlanItem[];
  /** Colour fill: a tint per room id. */
  roomFills?: Map<string, string>;
  /** Temporarily hidden or isolated things: not drawn, picked or snapped to. */
  hidden?: HideState | null;
  /** Which phases are drawn, and whether with phase graphics. */
  phase?: PhaseView;
  /** Door and window marks to tag them with. */
  marks?: Map<string, string>;
  /** The floor plan, or the reflected ceiling plan: ceilings, their heights and the lights. */
  look?: PlanLook;
  onOthers?: (selection: PlanItem[]) => void;
  multiMode?: boolean;
  onEdit: (result: EditResult) => string | null;
  onToolDone: () => void;
  onCalibrate: (a: Point, b: Point) => void;
  fitSignal: number;
  /** Items the layout check flags, drawn in the warning colour. */
  flagged?: ReadonlySet<string>;
  onDistanceSelect?: (guideId: string) => void;
  /** The Draw tool's shape, the layer new shapes go on, a polygon's sides and the hatch the Hatch tool lays. */
  draftTool?: DraftTool;
  draftLayer?: string;
  polygonSides?: number;
  hatchStyle?: Draft["fill"];
  draftAmounts?: DraftAmounts;
  /** A tool picked on the command line, with the distance, radius or sides typed after it. */
  onDraftCommand?: (tool: CommandTool, amount?: number) => void;
  /** What the tape reads: a distance, the area of an outline, or where a point is. */
  tapeMode?: TapeMode;
  /** POLAR typed on the command line: the new angle step. */
  onPolar?: (step: number) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const lib = useResolver();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 0.05 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [free, setFree] = useState(false);
  const [wallStart, setWallStart] = useState<Point | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  // Trim to corner: the first wall picked, and where on it (the part to keep).
  const [trimFrom, setTrimFrom] = useState<{ id: string; at?: Point } | null>(null);
  const trimFirst = tool !== "trim" ? null : ((trimFrom && plan.walls.some((w) => w.id === trimFrom.id) ? trimFrom : null) ?? (selection?.kind === "wall" ? { id: selection.id } : null));
  const [placeRotation, setPlaceRotation] = useState(0);
  const [noteDraft, setNoteDraft] = useState<{ at: Point; screen: { x: number; y: number }; text: string } | null>(null);
  /** Words being typed for a text or leader, and where. */
  const [wordsDraft, setWordsDraft] = useState<{ points: Point[]; screen: { x: number; y: number }; text: string; leader: boolean } | null>(null);
  /** The circle a radius or diameter dimension is for. */
  const [dimCircle, setDimCircle] = useState<{ c: Point; r: number } | null>(null);
  /** A chain of points measured, waiting for where its dimension line goes. */
  const [chainRaw, setChainPts] = useState<Point[] | null>(null);
  const chainPts = tool === "draft" && draftTool === "dimchain" ? chainRaw : null;
  /** What is typed on the command line. */
  const [command, setCommand] = useState("");
  const [commandHelp, setCommandHelp] = useState(false);
  /** A Modify tool's first pick: the shape and where it was clicked. */
  const [modPickRaw, setModPick] = useState<{ id: string; at: Point; tool: DraftTool } | null>(null);
  const modifying = tool === "draft" && MODIFY_KEYS.has(draftTool);
  const modPick = modifying && modPickRaw?.tool === draftTool && (plan.drafts ?? []).some((d) => d.id === modPickRaw.id) ? modPickRaw : null;
  /** The last quick measurement (the tape tool), until the next one or Esc. */
  const [tape, setTape] = useState<[Point, Point] | null>(null);
  /** The tape's last area outline and point read, until the next one or Esc. */
  const [area, setArea] = useState<Point[] | null>(null);
  const [idAt, setIdAt] = useState<Point | null>(null);
  const [drag, setDrag] = useState<{ target: PlanItem | { kind: "corner"; from: Point }; delta: Point; copy?: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ a: Point; b: Point } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  // This floor only: drawing, picking and snapping all work on it.
  const level = useMemo(() => {
    const seen = phaseView(visiblePart(onLevel(plan, levelId), hidden ?? null), phase);
    return look === "ceiling" ? ceilingPlan(seen, lib) : seen;
  }, [plan, levelId, hidden, phase, look, lib]);
  // Existing work drawn grey and what comes out dashed, except in the as-it-is view, where all of it simply is.
  const phaseMark = (t: { phase?: "existing" | "demolished" }) => (phase === "existing" ? undefined : t.phase);
  const below = useMemo(() => {
    const here = plan.levels.find((l) => l.id === levelId);
    const lower = plan.levels.filter((l) => here && l.elevation < here.elevation).sort((p, q) => q.elevation - p.elevation)[0];
    return lower ? plan.walls.filter((w) => w.levelId === lower.id) : [];
  }, [plan, levelId]);

  /** Everything selected together: the furniture and the rest. */
  const all = useMemo(() => unique([...selectionIds.map((id) => ({ kind: "item" as const, id })), ...others]), [selectionIds, others]);
  const inGroup = useCallback((t: PlanItem) => all.length > 1 && isSelected(all, t), [all]);
  /** What an Alt+drag copies: everything selected with the thing dragged, or just that thing. */
  const copyTargets = useCallback((target: PlanItem): PlanItem[] => (inGroup(target) ? all : [target]), [inGroup, all]);
  /** Moves the selection together; furniture alone keeps its group rules. */
  const moveGroup = useCallback((p: Plan, delta: Point) => (others.length ? moveMany(p, all, delta) : editFurniture(p, selectionIds, "move", { delta })), [others, all, selectionIds]);

  // While something is dragged, the plan is drawn as it would be if dropped there.
  const dragResult = useMemo(() => {
    if (!drag) return null;
    if (drag.target.kind === "corner")
      return moveCorner(plan, drag.target.from, { x: drag.target.from.x + drag.delta.x, y: drag.target.from.y + drag.delta.y }, levelId);
    if (drag.copy) return duplicateMany(plan, copyTargets(drag.target), drag.delta);
    return inGroup(drag.target) ? moveGroup(plan, drag.delta) : moveBy(plan, drag.target, drag.delta);
  }, [drag, plan, levelId, copyTargets, inGroup, moveGroup]);
  const dragged = dragResult?.ok ? ((p: Plan) => (look === "ceiling" ? ceilingPlan(p, lib) : p))(phaseView(visiblePart(onLevel(dragResult.plan, levelId), hidden ?? null), phase)) : null;
  const shown = dragged ?? level;
  // A small pin marks what cannot be moved.
  const pins = useMemo(() => {
    const out: { key: string; at: Point }[] = [];
    for (const w of shown.walls) if (w.pinned) out.push({ key: `w${w.id}`, at: { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 } });
    for (const c of shown.columns) if (c.pinned) out.push({ key: `c${c.id}`, at: c.at });
    for (const i of shown.items) if (i.pinned && !i.hidden) out.push({ key: `i${i.id}`, at: i.at });
    for (const r of shown.rooms) if (r.pinned) out.push({ key: `r${r.id}`, at: r.points[0] });
    return out;
  }, [shown]);
  // While copying, the originals stay put and are marked as such, and the copies are labelled.
  const copying = useMemo(() => {
    if (!drag?.copy || drag.target.kind === "corner" || !dragResult?.ok) return null;
    const targets = copyTargets(drag.target);
    const made = dragResult.created ?? [];
    return {
      outlines: targets.map((t) => outlineOf(level, t)).filter((o) => !!o),
      bounds: selectionBounds(level, targets),
      copyBounds: dragged ? selectionBounds(dragged, made) : null,
    };
  }, [drag, dragResult, dragged, level, copyTargets]);

  // Measure the canvas, and keep measuring as the window or panel changes.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the floor to the canvas when asked, when the floor changes, and once the canvas has a size; not on every edit.
  // Opening a floor goes back to the zoom and position it was left at, if it was; Fit always fits.
  // Saved settings arriving from the server count as a reason to look again, so another device's zoom is used.
  const [savedView, saveView] = useViewSetting<View | null>(viewKey, null, isViewOrNull);
  const settingsLoaded = useViewSettingsLoaded();
  const fitKey = `${fitSignal}:${levelId}:${size.w > 0 && size.h > 0}:${settingsLoaded}`;
  const [fittedKey, setFittedKey] = useState("");
  if (size.w && size.h && fittedKey !== fitKey) {
    const asked = fittedKey !== "" && !fittedKey.startsWith(`${fitSignal}:`);
    setFittedKey(fitKey);
    const own = planBounds(level) ? level : plan;
    setView(!asked && savedView ? savedView : fitView(own, size));
  }

  // Remember the view once it settles, not on every frame of a pan.
  useEffect(() => {
    if (!fittedKey || !settingsLoaded) return;
    const t = setTimeout(() => saveView(view), 500);
    return () => clearTimeout(t);
  }, [view, fittedKey, settingsLoaded, saveView]);

  // Leaving a tool drops whatever was half drawn.
  const [lastTool, setLastTool] = useState(`${tool}:${draftTool}:${levelId}`);
  if (lastTool !== `${tool}:${draftTool}:${levelId}`) {
    setLastTool(`${tool}:${draftTool}:${levelId}`);
    setWordsDraft(null);
    setWallStart(null);
    setPoints([]);
    setTyped("");
    setNoteDraft(null);
    setTape(null);
  }

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4_500);
    return () => clearTimeout(t);
  }, [message]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = boxRef.current!.getBoundingClientRect();
      return {
        x: view.cx + (clientX - rect.left - size.w / 2) / view.scale,
        y: view.cy - (clientY - rect.top - size.h / 2) / view.scale,
      };
    },
    [view, size]
  );

  const edit = (result: EditResult) => {
    const error = onEdit(result);
    if (error) setMessage(error);
    return !error && result.ok;
  };

  /** Wall ends and room corners on this floor near a point, leaving out `except`. */
  const cornerNear = (p: Point, within: number, except?: Point): Point | null => {
    let best: Point | null = null;
    let bestD = within;
    const consider = (q: Point) => {
      if (except && samePoint(q, except)) return;
      const d = distance(p, q);
      if (d <= bestD) {
        best = q;
        bestD = d;
      }
    };
    for (const w of level.walls) {
      consider(w.a);
      consider(w.b);
    }
    for (const r of level.rooms) r.points.forEach(consider);
    for (const c of level.columns) consider(c.at);
    return best;
  };

  /** Where a click lands once it is pulled onto a corner or rounded to 10 mm. */
  const snap = (p: Point, extra: Point[] = []): { point: Point; snapped: boolean; guides?: AlignmentGuide[]; kind?: SnapKind } => {
    const within = SNAP_PX / view.scale;
    const hit = free ? null : snapPoint(level, p, within, extra, undefined, tool === "draft" ? extra[extra.length - 1] : undefined);
    if (hit) return { point: hit.point, snapped: true, kind: hit.kind };
    const aligned = !free && (tool === "wall" || tool === "partition") ? snapAlignment(level, p, within) : { point: p, guides: [] };
    return { point: { x: aligned.guides.length ? aligned.point.x : roundTo(p.x, 10), y: aligned.guides.length ? aligned.point.y : roundTo(p.y, 10) }, snapped: aligned.guides.length > 0, guides: aligned.guides };
  };

  /** The end of the wall being drawn: on a corner when one is close, else square to the start. */
  const wallEnd = (raw: Point): { point: Point; snapped: boolean; guides?: AlignmentGuide[]; kind?: SnapKind } => {
    if (!wallStart) return snap(raw);
    const corner = cornerNear(raw, SNAP_PX / view.scale, wallStart);
    if (corner) return { point: corner, snapped: true, kind: "corner" };
    const c = constrain(wallStart, raw, free);
    if (!free) {
      // Running into a wall: end exactly on it.
      const meet = meetWall(level, wallStart, c, SNAP_PX / view.scale);
      if (meet) return { point: meet.point, snapped: true, kind: "wall" };
      const aligned = snapAlignment(level, c, SNAP_PX / view.scale, { exclude: wallStart, x: Math.abs(c.y - wallStart.y) < 0.01, y: Math.abs(c.x - wallStart.x) < 0.01 });
      if (aligned.guides.length) return { point: aligned.point, snapped: true, guides: aligned.guides };
    }
    const len = roundTo(distance(wallStart, c), 10);
    const d = distance(wallStart, c) || 1;
    return { point: { x: wallStart.x + ((c.x - wallStart.x) / d) * len, y: wallStart.y + ((c.y - wallStart.y) / d) * len }, snapped: false };
  };

  const pick = (p: Point): PlanItem | null => {
    const within = PICK_PX / view.scale;
    if (layers.openings) {
      for (const o of level.openings) {
        const wall = level.walls.find((w) => w.id === o.wallId);
        if (!wall) continue;
        const hit = nearestWall({ ...level, walls: [wall] }, p, Math.max(wall.thickness / 2, within));
        if (hit && Math.abs(hit.at - o.at) <= o.width / 2) return { kind: "opening", id: o.id };
      }
    }
    if (layers.columns) {
      const c = level.columns.find((c) => Math.abs(p.x - c.at.x) <= c.width / 2 + within && Math.abs(p.y - c.at.y) <= c.depth / 2 + within);
      if (c) return { kind: "column", id: c.id };
    }
    if (layers.notes) {
      // Notes are drawn at a fixed size on screen, so they are hit in screen terms.
      const n = [...level.notes].reverse().find((n) => {
        const w = (n.text.length * 7 + 8) / view.scale;
        return p.x >= n.at.x - 4 / view.scale && p.x <= n.at.x + w && p.y >= n.at.y - 5 / view.scale && p.y <= n.at.y + 16 / view.scale;
      });
      if (n) return { kind: "note", id: n.id };
    }
    if (layers.drafting) {
      // Drawn shapes on visible, unlocked layers; the nearest line wins.
      const hit = draftsOf(level)
        .filter((d) => {
          const st = styleOf(level, d);
          return !st.hidden && !st.locked;
        })
        .map((d) => ({ d, off: distanceTo(d, p) }))
        .filter((x) => x.off <= within)
        .sort((a, b) => a.off - b.off)[0];
      if (hit) return { kind: "draft", id: hit.d.id };
    }
    if (layers.dimensions) {
      const d = level.dimensions.find((d) => {
        const [a, b] = dimensionLine(d.a, d.b, d.offset);
        return toSegment(p, a, b) <= within;
      });
      if (d) return { kind: "dimension", id: d.id };
    }
    if (layers.walls) {
      const hit = level.walls
        .map((w) => ({ w, hit: nearestWall({ ...level, walls: [w] }, p, Math.max(w.thickness / 2, within)) }))
        .filter((x) => x.hit)
        .sort((a, b) => a.hit!.off - b.hit!.off)[0];
      if (hit) return { kind: "wall", id: hit.w.id };
    }
    if (layers.furniture) {
      // The one drawn last is on top, and the smallest of several overlapping wins.
      const hits = level.items.filter((i) => !i.hidden && inItem(i, p, within / 2));
      const item = hits.sort((a, b) => a.width * a.depth - b.width * b.depth)[0];
      if (item) return { kind: "item", id: item.id };
    }
    if (layers.rooms) {
      const room = level.rooms
        .filter((r) => pointInPolygon(p, r.points))
        .sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0];
      if (room) return { kind: "room", id: room.id };
    }
    return null;
  };

  const finishOutline = (corners: Point[]) => {
    const result = addRoom(plan, corners, undefined, levelId);
    if (edit(result) && result.ok) {
      setPoints([]);
      onSelect({ kind: "room", id: result.id! });
      onToolDone();
    }
  };

  const drawWall = (from: Point, to: Point) =>
    tool === "partition"
      ? addWall(plan, from, to, DEFAULTS.partitionThickness, levelId, "partition")
      : addWall(plan, from, to, DEFAULTS.wallThickness, levelId, "wall");

  // ---------------------------------------------------------------- drafting

  const lineish = tool === "draft" && (draftTool === "line" || draftTool === "polyline" || draftTool === "leader");
  const polarStep = draftAmounts.polar ?? 45;
  const stretching = tool === "draft" && draftTool === "stretch";

  /** Where a drafting click lands: on a snap, else square to the last point (Alt for any angle) at a round length. */
  const draftPoint = (raw: Point): Point => {
    const last = points[points.length - 1];
    const hit = snap(raw, points);
    if (hit.snapped || !last || !lineish) return hit.point;
    const c = constrain(last, raw, free, polarStep);
    const d = distance(last, c) || 1;
    const len = roundTo(d, 10);
    return { x: last.x + ((c.x - last.x) / d) * len, y: last.y + ((c.y - last.y) / d) * len };
  };

  /** The shape the points so far and `end` make; for previews and for drawing it. */
  const buildShape = (shape: DraftTool, pts: Point[], end: Point): Omit<Draft, "id" | "levelId"> | null => {
    const a = pts[0];
    if (!a) return null;
    switch (shape) {
      case "line":
        return distance(pts[pts.length - 1], end) < 0.5 ? null : { shape: "line", points: [pts[pts.length - 1], end] };
      case "polyline":
        return { shape: "polyline", points: [...pts, end] };
      case "leader":
        return { shape: "leader", points: [...pts, end] };
      case "rectangle":
        return Math.abs(end.x - a.x) < 1 || Math.abs(end.y - a.y) < 1 ? null : { shape: "polyline", points: rectangle(a, end), closed: true };
      case "circle":
        return distance(a, end) < 1 ? null : { shape: "circle", points: [a], radius: Math.round(distance(a, end) * 10) / 10 };
      case "polygon":
        return distance(a, end) < 1 ? null : { shape: "polyline", points: polygon(a, end, polygonSides), closed: true };
      case "arc": {
        if (pts.length < 2) return { shape: "line", points: [a, end] };
        const arc = arcThrough(a, pts[1], end);
        return arc ? { shape: "arc", points: [arc.centre], radius: Math.round(arc.radius * 10) / 10, start: arc.start, end: arc.end } : null;
      }
      case "ellipse": {
        const rx = distance(a, pts[1] ?? end);
        if (rx < 1) return null;
        const axis = pts[1] ?? end;
        const rotation = Math.round(((Math.atan2(axis.y - a.y, axis.x - a.x) * 180) / Math.PI) * 10) / 10;
        let ry = rx / 2;
        if (pts[1]) {
          const ux = (axis.x - a.x) / rx;
          const uy = (axis.y - a.y) / rx;
          ry = Math.abs(-(end.x - a.x) * uy + (end.y - a.y) * ux);
        }
        return ry < 1 ? null : { shape: "ellipse", points: [a], radius: Math.round(rx * 10) / 10, radius2: Math.round(ry * 10) / 10, rotation };
      }
      case "dimlinear": {
        if (pts.length < 2) return distance(a, end) < 1 ? null : { shape: "line", points: [a, end] };
        const kind = linearKind(a, pts[1], end);
        return { shape: "dimension", dim: kind, points: [a, pts[1], end] };
      }
      case "dimangular": {
        if (pts.length < 2) return distance(a, end) < 1 ? null : { shape: "line", points: [a, end] };
        if (pts.length < 3) return { shape: "polyline", points: [pts[1], a, end] };
        return { shape: "dimension", dim: "angular", points: [a, pts[1], pts[2], end] };
      }
      case "dimradius":
      case "dimdiameter": {
        if (!dimCircle) return null;
        const L = distance(dimCircle.c, end) || 1;
        const edge = { x: dimCircle.c.x + ((end.x - dimCircle.c.x) / L) * dimCircle.r, y: dimCircle.c.y + ((end.y - dimCircle.c.y) / L) * dimCircle.r };
        return { shape: "dimension", dim: shape === "dimradius" ? "radius" : "diameter", points: [dimCircle.c, edge] };
      }
      case "dimchain":
        return { shape: "polyline", points: [...pts, end] };
      default:
        return null;
    }
  };

  const commitDraft = (shape: Omit<Draft, "id" | "levelId">, select = true): boolean => {
    const result = addDraft(plan, { ...shape, levelId, ...(draftLayer && draftLayer !== "drafting" ? { layer: draftLayer } : {}) });
    const ok = edit(result) && result.ok;
    if (ok && result.ok && select) onSelect({ kind: "draft", id: result.id! });
    return ok;
  };

  /** Ends a polyline or a leader: a polyline goes down, a leader asks for its words. */
  const finishDraft = (pts: Point[], closed: boolean, screen?: { x: number; y: number }) => {
    if (draftTool === "dimchain") {
      if (pts.length < 2) return;
      setChainPts(pts);
      setPoints([]);
      setTyped("");
      return;
    }
    if (draftTool === "leader") {
      if (pts.length < 2) return;
      const last = pts[pts.length - 1];
      const at = screen ?? { x: size.w / 2 + (last.x - view.cx) * view.scale, y: size.h / 2 - (last.y - view.cy) * view.scale };
      setWordsDraft({ points: pts, screen: at, text: "", leader: true });
      setPoints([]);
      return;
    }
    if (pts.length < 2) return;
    commitDraft({ shape: "polyline", points: pts, ...(closed ? { closed: true } : {}) });
    setPoints([]);
    setTyped("");
  };

  /** A drafting click on a point already snapped or typed. */
  const draftClick = (at: Point, screen: { x: number; y: number }) => {
    if (draftTool === "text") {
      setWordsDraft({ points: [at], screen, text: "", leader: false });
      return;
    }
    if (draftTool === "table") {
      const r = addDraft(plan, { levelId, shape: "table", points: [at], cells: [["Item", "Finish", "Notes"], ["", "", ""], ["", "", ""]], ...(draftLayer && draftLayer !== "drafting" ? { layer: draftLayer } : {}) });
      if (edit(r) && r.ok) onSelect({ kind: "draft", id: r.id! });
      return;
    }
    if (draftTool === "dimchain" && chainPts) {
      const layer = draftLayer && draftLayer !== "drafting" ? { layer: draftLayer } : {};
      const r = chainDimensions(plan, { levelId, points: chainPts, at, ...layer });
      if (edit(r) && r.ok) setChainPts(null);
      return;
    }
    if ((draftTool === "dimradius" || draftTool === "dimdiameter") && !points.length) {
      const hit = draftAt(at);
      if (!hit || (hit.shape !== "circle" && hit.shape !== "arc")) {
        setMessage("Click on a drawn circle or arc.");
        return;
      }
      setDimCircle({ c: hit.points[0], r: hit.radius ?? 0 });
      setPoints([hit.points[0]]);
      return;
    }
    if (draftTool === "polyline" || draftTool === "leader" || draftTool === "dimchain") {
      if (draftTool === "polyline" && points.length >= 3 && distance(at, points[0]) <= SNAP_PX / view.scale) {
        finishDraft(points, true);
        return;
      }
      if (points.length && distance(at, points[points.length - 1]) < 0.5) return;
      setPoints([...points, at]);
      return;
    }
    const need = draftTool === "arc" || draftTool === "ellipse" || draftTool === "dimlinear" ? 3 : draftTool === "dimangular" ? 4 : 2;
    const next = [...points, at];
    if (next.length < need) {
      setPoints(next);
      return;
    }
    const shape = buildShape(draftTool, points, at);
    if (!shape) {
      setMessage("That shape would have no size. Click further away.");
      return;
    }
    // Lines carry on from the last end, as in CAD, until Esc.
    if (commitDraft(shape, draftTool !== "line") && draftTool === "line") setPoints([at]);
    else setPoints([]);
    setTyped("");
  };

  /** A typed value while drafting: a length (or dx,dy) from the last point, a radius, or width,depth. */
  const typedPoint = (): Point | null => {
    const last = points[points.length - 1];
    if (/[@<]/.test(typed)) {
      const c = parseCommand(typed);
      return c.kind === "point" && last ? resolvePoint(c.spec, last, cursor) : null;
    }
    const nums = typed.split(",").map((v) => Number.parseFloat(v));
    if (!typed || nums.some((n) => !Number.isFinite(n))) return null;
    if (!last) return null;
    const towards = cursor ?? { x: last.x + 1, y: last.y };
    if (draftTool === "rectangle") {
      const w = nums[0];
      const d = nums[1] ?? nums[0];
      return { x: last.x + w * (towards.x >= last.x ? 1 : -1), y: last.y + d * (towards.y >= last.y ? 1 : -1) };
    }
    if (nums.length >= 2) return { x: last.x + nums[0], y: last.y + nums[1] };
    const dir = lineish ? constrain(last, towards, free, polarStep) : towards;
    const len = distance(last, dir) || 1;
    const ux = distance(last, dir) < 1e-6 ? 1 : (dir.x - last.x) / len;
    const uy = distance(last, dir) < 1e-6 ? 0 : (dir.y - last.y) / len;
    return { x: last.x + ux * nums[0], y: last.y + uy * nums[0] };
  };

  const commitWords = () => {
    if (!wordsDraft || committed.current === wordsDraft) return;
    committed.current = wordsDraft;
    const text = wordsDraft.text.trim();
    setWordsDraft(null);
    boxRef.current?.focus({ preventScroll: true });
    if (wordsDraft.leader) commitDraft({ shape: "leader", points: wordsDraft.points, ...(text ? { text, height: DEFAULT_TEXT_HEIGHT } : {}) });
    else if (text) commitDraft({ shape: "text", points: wordsDraft.points, text, height: DEFAULT_TEXT_HEIGHT });
  };

  const hatchAt = (raw: Point) => {
    const fill = hatchStyle ?? { pattern: "diagonal" as const, scale: 150, angle: 0 };
    const closed = draftsOf(level)
      .filter((d) => isClosed(d) && !styleOf(level, d).locked && !styleOf(level, d).hidden)
      .map((d) => ({ d, outline: outlineOf(level, { kind: "draft", id: d.id })!.points }))
      .filter((x) => pointInPolygon(raw, x.outline))
      .sort((a, b) => polygonArea(a.outline) - polygonArea(b.outline))[0];
    if (closed) {
      if (edit(updateDraft(plan, closed.d.id, { fill }))) onSelect({ kind: "draft", id: closed.d.id });
      return;
    }
    const room = level.rooms.filter((r) => pointInPolygon(raw, r.points)).sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0];
    if (!room) {
      setMessage("Click inside a room or a closed shape to hatch it.");
      return;
    }
    const layer = draftLayer && draftLayer !== "drafting" ? draftLayer : "hatch";
    const result = addDraft(plan, { shape: "polyline", levelId, points: room.points, closed: true, fill, layer });
    if (edit(result) && result.ok) onSelect({ kind: "draft", id: result.id! });
  };

  /** Runs what was typed on the command line. */
  const runCommand = () => {
    const c = parseCommand(command);
    setCommand("");
    const selected = selection?.kind === "draft" ? selection.id : null;
    switch (c.kind) {
      case "error":
        setMessage(c.message);
        return;
      case "tool":
        // C while drawing a polyline closes it, as in AutoCAD.
        if (c.tool === "circle" && c.amount == null && tool === "draft" && draftTool === "polyline" && points.length >= 3) {
          finishDraft(points, true);
          return;
        }
        setPoints([]);
        setTyped("");
        setModPick(null);
        setMessage(null);
        onDraftCommand?.(c.tool, c.amount);
        return;
      case "action":
        if (c.action === "close") {
          if (tool === "draft" && draftTool === "polyline" && points.length >= 3) finishDraft(points, true);
          else setMessage("Close works while drawing a polyline with three or more points.");
        } else if (c.action === "undo-point") {
          if (points.length) setPoints(points.slice(0, -1));
          else setMessage("There is no point to take back.");
        } else if (!selected) setMessage(`Select a drawn shape to ${c.action}.`);
        else if (c.action === "explode") edit(explodeDraft(plan, selected));
        else {
          const ids = [selected, ...(plan.drafts ?? []).filter((d) => d.id !== selected && d.levelId === levelId).map((d) => d.id)];
          edit(joinDrafts(plan, ids));
        }
        return;
      case "polar":
        onPolar?.(c.step);
        setMessage(null);
        return;
      case "point": {
        if (stretching) {
          const at = resolvePoint(c.spec, points[points.length - 1], cursor);
          if (!at) {
            setMessage("Give the first corner as x,y, or click it.");
            return;
          }
          setMessage(null);
          stretchTo([...points, at]);
          return;
        }
        if (tool !== "draft" || modifying) {
          setMessage("Pick a Draw shape first, like L for a line, then type its points.");
          return;
        }
        const at = resolvePoint(c.spec, points[points.length - 1], cursor);
        if (!at) {
          setMessage("Give the first point as x,y, or click it.");
          return;
        }
        setMessage(null);
        draftClick(at, { x: size.w / 2 + (at.x - view.cx) * view.scale, y: size.h / 2 - (at.y - view.cy) * view.scale });
        return;
      }
    }
  };

  /** The drawn shape under a point, on a visible, unlocked layer. */
  const draftAt = (raw: Point): Draft | null => {
    const within = PICK_PX / view.scale;
    return (
      draftsOf(level)
        .filter((d) => !styleOf(level, d).hidden && !styleOf(level, d).locked)
        .map((d) => ({ d, off: distanceTo(d, raw) }))
        .filter((x) => x.off <= within)
        .sort((a, b) => a.off - b.off)[0]?.d ?? null
    );
  };

  /** A click with one of the Modify tools. */
  const modifyClick = (raw: Point) => {
    if (draftTool === "stretch") {
      // Two corners of the box, then the base point and where it goes.
      const at = points.length < 2 ? raw : draftSnap(raw);
      stretchTo([...points, at]);
      return;
    }
    const hit = draftAt(raw);
    const choose = (d: Draft) => {
      setModPick({ id: d.id, at: raw, tool: draftTool });
      onSelect({ kind: "draft", id: d.id });
    };
    const missed = () => setMessage("Click on a drawn shape.");
    const how = draftTool === "chamfer" ? { chamfer: [draftAmounts.chamfer, draftAmounts.chamfer] as [number, number] } : { radius: draftAmounts.radius };
    switch (draftTool) {
      case "trim":
        if (!hit) return missed();
        edit(trimDraft(plan, hit.id, raw));
        return;
      case "extend":
        if (!hit) return missed();
        edit(extendDraft(plan, hit.id, raw));
        return;
      case "offset": {
        if (!modPick) return hit ? choose(hit) : missed();
        const r = offsetDraft(plan, modPick.id, draftAmounts.offset, raw);
        if (edit(r) && r.ok) onSelect({ kind: "draft", id: r.id! });
        setModPick(null);
        return;
      }
      case "fillet":
      case "chamfer": {
        if (!modPick) {
          if (!hit) return missed();
          if (hit.shape === "polyline") {
            edit(filletLines(plan, hit.id, raw, hit.id, raw, how));
            return;
          }
          return choose(hit);
        }
        if (!hit) return missed();
        edit(filletLines(plan, modPick.id, modPick.at, hit.id, raw, how));
        setModPick(null);
        return;
      }
      case "break": {
        if (!modPick) return hit ? choose(hit) : missed();
        if (hit?.id !== modPick.id) return setMessage("Click the same shape again for the second point, or press Enter to split it at the first.");
        edit(breakDraft(plan, modPick.id, modPick.at, raw));
        setModPick(null);
        return;
      }
    }
  };

  /** A stretch base or destination: on a snap, else square to the base point at a round length. */
  const draftSnap = (raw: Point): Point => {
    const hit = snap(raw, points);
    const base = points[2];
    if (hit.snapped || !base) return hit.point;
    const c = constrain(base, raw, free, polarStep);
    return { x: roundTo(c.x, 10), y: roundTo(c.y, 10) };
  };

  const stretchTo = (pts: Point[]) => {
    if (pts.length < 4) {
      setPoints(pts);
      return;
    }
    const [a, b, base, to] = pts;
    edit(stretchIn(plan, levelId, { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }, { x: to.x - base.x, y: to.y - base.y }));
    setPoints([]);
  };

  const finishArea = (pts: Point[]) => {
    const clean = pts.filter((p, i) => i === 0 || distance(p, pts[i - 1]) > 0.5);
    if (clean.length < 3) return;
    setArea(clean);
    setPoints([]);
  };

  const click = (raw: Point, screen: { x: number; y: number }) => {
    switch (tool) {
      case "draft":
        if (modifying) {
          modifyClick(raw);
          return;
        }
        draftClick(draftTool === "text" ? snap(raw).point : draftPoint(raw), screen);
        return;
      case "hatch":
        hatchAt(raw);
        return;
      case "select":
        onSelect(pick(raw));
        return;
      case "wall":
      case "partition": {
        const { point } = wallEnd(raw);
        if (!wallStart) {
          setWallStart(point);
          return;
        }
        // Each wall starts where the last one ended, until Esc.
        if (edit(drawWall(wallStart, point))) setWallStart(point);
        setTyped("");
        return;
      }
      case "outline": {
        const { point } = snap(raw, points);
        if (points.length >= 3 && distance(point, points[0]) <= SNAP_PX / view.scale) {
          finishOutline(points);
          return;
        }
        setPoints([...points, point]);
        return;
      }
      case "room": {
        const result = roomAt(plan, raw, levelId);
        if (edit(result) && result.ok) {
          onSelect({ kind: "room", id: result.id! });
          onToolDone();
        }
        return;
      }
      case "door":
      case "window": {
        const hit = nearestWall(level, raw, Math.max(PICK_PX / view.scale, 300));
        if (!hit) {
          setMessage(`Click on a wall to put the ${tool} in it.`);
          return;
        }
        const placed = snapOpening(level, { id: "preview", wallId: hit.wall.id, kind: tool, at: hit.at, width: DEFAULTS[tool] }, roundTo(hit.at, 10), SNAP_PX / view.scale, !free);
        const result = addOpening(plan, hit.wall.id, tool, placed.at);
        if (edit(result) && result.ok) onSelect({ kind: "opening", id: result.id! });
        return;
      }
      case "column": {
        const result = addColumn(plan, snap(raw).point, DEFAULTS.column, DEFAULTS.column, levelId);
        if (edit(result) && result.ok) onSelect({ kind: "column", id: result.id! });
        return;
      }
      case "item": {
        const at = { x: roundTo(raw.x, 10), y: roundTo(raw.y, 10) };
        // Nothing is selected while placing, so the library stays open for the next one.
        edit(placeBlueprint(plan, lib, placeType, at, levelId, placeRotation));
        return;
      }
      case "note": {
        setNoteDraft({ at: snap(raw).point, screen, text: "" });
        return;
      }
      case "tape": {
        const at = snap(raw).point;
        if (tapeMode === "point") {
          setIdAt(at);
          return;
        }
        if (tapeMode === "area") {
          setArea(null);
          if (points.length >= 3 && distance(at, points[0]) <= SNAP_PX / view.scale) finishArea(points);
          else setPoints([...points, at]);
          return;
        }
        if (!points.length) {
          setPoints([at]);
          setTape(null);
        } else {
          setTape([points[0], at]);
          setPoints([]);
        }
        return;
      }
      case "dimension": {
        if (points.length < 2) {
          setPoints([...points, snap(raw).point]);
          return;
        }
        const [a, b] = points;
        const result = addDimension(plan, a, b, levelId, Math.round(offsetTo(a, b, raw)));
        if (edit(result) && result.ok) onSelect({ kind: "dimension", id: result.id! });
        setPoints([]);
        return;
      }
      case "split": {
        const near = nearestWall(level, raw, (PICK_PX * 1.5) / view.scale);
        if (!near) {
          setMessage("Click on a wall to split it.");
          return;
        }
        const on = snapPoint(level, raw, SNAP_PX / view.scale);
        edit(splitWall(plan, near.wall.id, on && on.kind !== "corner" ? on.point : raw));
        return;
      }
      case "trim": {
        const near = nearestWall(level, raw, (PICK_PX * 1.5) / view.scale);
        if (!near) {
          setMessage("Click on a wall.");
          return;
        }
        if (!trimFirst || trimFirst.id === near.wall.id) {
          setTrimFrom({ id: near.wall.id, at: raw });
          onSelect({ kind: "wall", id: near.wall.id });
          return;
        }
        if (edit(trimToCorner(plan, trimFirst.id, near.wall.id, trimFirst.at, raw))) onSelect(null);
        setTrimFrom(null);
        return;
      }
      case "calibrate": {
        const p = snap(raw).point;
        if (!points.length) {
          setPoints([p]);
          return;
        }
        setPoints([]);
        onCalibrate(points[0], p);
        return;
      }
    }
  };

  // Enter and the blur that follows both commit; the note goes in once.
  const committed = useRef<object | null>(null);
  const commitNote = () => {
    if (!noteDraft || committed.current === noteDraft) return;
    committed.current = noteDraft;
    const text = noteDraft.text.trim();
    setNoteDraft(null);
    if (!text) return;
    const result = addNote(plan, noteDraft.at, text, levelId);
    if (edit(result) && result.ok) onSelect({ kind: "note", id: result.id! });
    boxRef.current?.focus({ preventScroll: true });
  };

  // ---------------------------------------------------------------- pointer

  const selectedWall = selection?.kind === "wall" ? level.walls.find((w) => w.id === selection.id) : undefined;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".plan-note-input, .plan-distance-label")) return;
    if (noteDraft || wordsDraft) {
      // Clicking away from a note being typed finishes it (the field's blur saves it) rather than starting another.
      gesture.current = null;
      boxRef.current?.focus({ preventScroll: true });
      return;
    }
    boxRef.current?.focus({ preventScroll: true });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      setDrag(null);
      setMarquee(null);
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view,
      };
      return;
    }
    if (tool === "select" && e.button === 0) {
      const p = toWorld(e.clientX, e.clientY);
      if ((e.ctrlKey || e.metaKey) && onMultiSelect) {
        gesture.current = { kind: "marquee", from: p, to: p, x: e.clientX, y: e.clientY, moved: false };
        return;
      }
      if (multiMode || e.shiftKey) { onSelect(pick(p), true); gesture.current = null; return; }
      // The ends of a selected wall are handles: drag one to move that corner.
      if (selectedWall) {
        const end = [selectedWall.a, selectedWall.b].find((q) => distance(p, q) <= (PICK_PX + 3) / view.scale);
        if (end) {
          gesture.current = { kind: "corner", from: end, x: e.clientX, y: e.clientY, moved: false };
          return;
        }
      }
      const target = pick(p);
      if (target && DRAGGABLE.has(target.kind) && !e.altKey && isPinned(plan, target)) {
        // Pinned things stay put: the press selects it and a drag moves the view instead.
        setMessage("Pinned. Unpin it on the selection bar to move it.");
        gesture.current = { kind: "pan", x: e.clientX, y: e.clientY, view, moved: false };
        return;
      }
      if (target && DRAGGABLE.has(target.kind)) {
        if (target.kind === "item" && level.items.find((i) => i.id === target.id)?.groupId && !selectionIds.includes(target.id)) onSelect(target);
        // Alt+drag copies it (or the furniture selected with it), leaving the original where it was.
        gesture.current = { kind: "drag", target, copy: e.altKey, from: p, x: e.clientX, y: e.clientY, moved: false };
        return;
      }
    }
    gesture.current = { kind: "pan", x: e.clientX, y: e.clientY, view, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    setFree(e.altKey);
    if (size.w) setCursor(toWorld(e.clientX, e.clientY));
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, g.view.scale * (dist / g.dist)));
      const rect = boxRef.current!.getBoundingClientRect();
      // The world point under the fingers' first midpoint stays under their midpoint now.
      const wx = g.view.cx + (g.mid.x - rect.left - size.w / 2) / g.view.scale;
      const wy = g.view.cy - (g.mid.y - rect.top - size.h / 2) / g.view.scale;
      setView({ scale, cx: wx - (mid.x - rect.left - size.w / 2) / scale, cy: wy + (mid.y - rect.top - size.h / 2) / scale });
      return;
    }
    if (g.kind === "pinch") return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < CLICK_PX) return;
    g.moved = true;
    if (g.kind === "pan") {
      setView({ ...g.view, cx: g.view.cx - dx / g.view.scale, cy: g.view.cy + dy / g.view.scale });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (g.kind === "marquee") { g.to = p; setMarquee({ a: g.from, b: p }); return; }
    if (g.kind === "corner") {
      const to = cornerNear(p, SNAP_PX / view.scale, g.from) ?? constrainedCorner(g.from, p);
      setDrag({ target: { kind: "corner", from: g.from }, delta: { x: to.x - g.from.x, y: to.y - g.from.y } });
      return;
    }
    const delta = { x: roundTo(p.x - g.from.x, 10), y: roundTo(p.y - g.from.y, 10) };
    // Furniture lines up with, or butts against, its neighbours as it nears them.
    let snappedDelta = delta;
    if (!e.altKey && g.target.kind === "wall") {
      const wall = level.walls.find((w) => w.id === g.target.id);
      if (wall) snappedDelta = snapWallDelta(level, wall, delta, SNAP_PX / view.scale);
    } else if (g.target.kind === "opening") {
      const opening = level.openings.find((o) => o.id === g.target.id);
      const wall = opening && level.walls.find((w) => w.id === opening.wallId);
      if (opening && wall) {
        const length = wallLength(wall) || 1;
        const u = { x: (wall.b.x - wall.a.x) / length, y: (wall.b.y - wall.a.y) / length };
        const at = opening.at + delta.x * u.x + delta.y * u.y;
        const placed = snapOpening(level, opening, at, SNAP_PX / view.scale, !e.altKey);
        snappedDelta = { x: u.x * (placed.at - opening.at), y: u.y * (placed.at - opening.at) };
      }
    } else if (!e.altKey && g.target.kind === "item" && !inGroup(g.target)) snappedDelta = snapItemDelta(plan, levelId, g.target.id, delta, SNAP_PX / view.scale);
    setDrag({ target: g.target, delta: snappedDelta, copy: g.copy });
  };

  /** A dragged corner keeps the wall square unless Alt is held, measured from the wall's other end. */
  const constrainedCorner = (from: Point, p: Point): Point => {
    const other = selectedWall ? (samePoint(selectedWall.a, from) ? selectedWall.b : selectedWall.a) : null;
    const to = other ? constrain(other, p, free) : p;
    return { x: roundTo(to.x, 10), y: roundTo(to.y, 10) };
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (g?.kind === "pinch") {
      // The finger left behind does not turn into a click or a pan.
      if (pointers.current.size === 0) gesture.current = null;
      return;
    }
    gesture.current = null;
    if (!g) return;
    if (g.kind === "marquee") {
      setMarquee(null);
      if (!g.moved) { onSelect(pick(toWorld(e.clientX, e.clientY)), true); return; }
      const minX = Math.min(g.from.x, g.to.x), maxX = Math.max(g.from.x, g.to.x), minY = Math.min(g.from.y, g.to.y), maxY = Math.max(g.from.y, g.to.y);
      // Left to right takes what is wholly inside; right to left also what it touches, as in Revit and AutoCAD.
      const kinds = new Set(LAYER_KINDS.filter(([layer]) => layers[layer]).map(([, kind]) => kind));
      if (!onOthers) kinds.forEach((k) => k !== "item" && kinds.delete(k));
      const taken = inBox(level, levelId, { minX, maxX, minY, maxY }, g.to.x < g.from.x, kinds).filter((t) => t.kind !== "item" || !level.items.find((i) => i.id === t.id)?.hidden);
      onMultiSelect?.([...new Set([...selectionIds, ...taken.filter((t) => t.kind === "item").map((t) => t.id)])]);
      if (onOthers) onOthers(unique([...others, ...taken.filter((t) => t.kind !== "item")]));
      return;
    }
    const rect = boxRef.current!.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (g.kind === "drag" || g.kind === "corner") {
      const current = drag;
      setDrag(null);
      if (!g.moved) {
        click(toWorld(e.clientX, e.clientY), screen);
        return;
      }
      if (!current) return;
      if (current.target.kind === "corner") {
        const from = current.target.from;
        edit(moveCorner(plan, from, { x: from.x + current.delta.x, y: from.y + current.delta.y }, levelId));
      } else if (current.copy) {
        const targets = copyTargets(current.target);
        const result = duplicateMany(plan, targets, current.delta);
        if (edit(result) && result.ok) {
          const made = result.created ?? [];
          if (targets.length > 1) {
            onMultiSelect?.(made.filter((t) => t.kind === "item").map((t) => t.id));
            onOthers?.(made.filter((t) => t.kind !== "item"));
          } else if (made[0]) onSelect(made[0]);
        }
      } else {
        const target = current.target;
        const multiple = inGroup(target);
        if (edit(multiple ? moveGroup(plan, current.delta) : moveBy(plan, target, current.delta)) && !multiple) onSelect(target);
      }
      return;
    }
    if (!g.moved && e.button === 0) click(toWorld(e.clientX, e.clientY), screen);
  };

  // Zooming about the pointer, with the wheel or a trackpad pinch. Bound by hand
  // so it can stop the page scrolling.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
        const px = e.clientX - rect.left - rect.width / 2;
        const py = e.clientY - rect.top - rect.height / 2;
        const wx = v.cx + px / v.scale;
        const wy = v.cy - py / v.scale;
        return { scale, cx: wx - px / scale, cy: wy + py / scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ---------------------------------------------------------------- keys

  const drawing = tool === "wall" || tool === "partition";

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== boxRef.current) return;
    if (e.key === "Alt") setFree(true);
    if (e.key === "Escape" && modPick) {
      setModPick(null);
      e.preventDefault();
      return;
    }
    if (modPick && draftTool === "break" && e.key === "Enter") {
      edit(breakDraft(plan, modPick.id, modPick.at));
      setModPick(null);
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && chainPts) {
      setChainPts(null);
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      setTrimFrom(null);
      if ((tape || area || idAt) && !points.length) {
        setTape(null);
        setArea(null);
        setIdAt(null);
      } else if (wallStart || points.length) {
        setWallStart(null);
        setPoints([]);
        setTyped("");
      } else if (tool !== "select") onToolDone();
      else onSelect(null);
      e.preventDefault();
      return;
    }
    if (drawing && wallStart) {
      if (/^[0-9.]$/.test(e.key)) {
        setTyped((t) => (t + e.key).slice(0, 7));
        e.preventDefault();
        return;
      }
      if (e.key === "Backspace" && typed) {
        setTyped((t) => t.slice(0, -1));
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && typed) {
        const length = Number.parseFloat(typed);
        const towards = cursor ? constrain(wallStart, cursor, free) : { x: wallStart.x + 1, y: wallStart.y };
        const d = distance(wallStart, towards) || 1;
        const end = { x: wallStart.x + ((towards.x - wallStart.x) / d) * length, y: wallStart.y + ((towards.y - wallStart.y) / d) * length };
        if (edit(drawWall(wallStart, end))) setWallStart(end);
        setTyped("");
        e.preventDefault();
        return;
      }
    }
    if (tool === "draft" && points.length) {
      if (/^[0-9.,@<-]$/.test(e.key)) {
        setTyped((t) => (t + e.key).slice(0, 24));
        e.preventDefault();
        return;
      }
      if (e.key === "Backspace") {
        if (typed) setTyped((t) => t.slice(0, -1));
        else setPoints((p) => p.slice(0, -1));
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        const at = typedPoint();
        setTyped("");
        if (at) draftClick(at, { x: 0, y: 0 });
        else if ((draftTool === "polyline" || draftTool === "leader" || draftTool === "dimchain") && points.length >= 2) finishDraft(points, false);
        e.preventDefault();
        return;
      }
    }
    if (tool === "tape" && tapeMode === "area" && e.key === "Enter" && points.length >= 3) {
      finishArea(points);
      e.preventDefault();
      return;
    }
    if (tool === "outline" && e.key === "Enter" && points.length >= 3) {
      finishOutline(points);
      e.preventDefault();
      return;
    }
    if ((tool === "outline" || tool === "dimension") && e.key === "Backspace" && points.length) {
      setPoints((p) => p.slice(0, -1));
      e.preventDefault();
      return;
    }
    if (tool === "item" && e.key === " ") {
      setPlaceRotation((r) => (r + 90) % 360);
      e.preventDefault();
      return;
    }
    if (tool !== "select" || (!selection && all.length < 2)) return;
    if (all.length > 1 && others.length) {
      const step = e.shiftKey ? 100 : 10;
      const deltas: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
      let result: EditResult | undefined;
      if (e.key === "Delete" || e.key === "Backspace") result = removeMany(plan, all);
      else if (e.key === " ") result = rotateMany(plan, all, e.shiftKey ? -90 : 90);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") result = duplicateMany(plan, all);
      else if (deltas[e.key]) result = moveMany(plan, all, deltas[e.key]);
      if (result) {
        if (edit(result) && result.ok) {
          if (e.key === "Delete" || e.key === "Backspace") {
            onMultiSelect?.([]);
            onOthers?.([]);
            onSelect(null);
          } else if (result.created) {
            onMultiSelect?.(result.created.filter((t) => t.kind === "item").map((t) => t.id));
            onOthers?.(result.created.filter((t) => t.kind !== "item"));
          }
        }
        e.preventDefault();
        return;
      }
    }
    if (!selection) return;
    if (selectionIds.length > 1) {
      let action: Parameters<typeof editFurniture>[2] | undefined;
      if (e.key === "Delete" || e.key === "Backspace") action = "delete";
      if (e.key === " ") action = "rotate";
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") action = "duplicate";
      const step = e.shiftKey ? 100 : 10;
      const deltas: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
      if (deltas[e.key]) action = "move";
      if (action) {
        const result = editFurniture(plan, selectionIds, action, { delta: deltas[e.key] });
        if (edit(result) && result.ok) {
          if (action === "delete") onMultiSelect?.([]);
          if (action === "duplicate") onMultiSelect?.(result.plan.items.filter((i) => !plan.items.some((p) => p.id === i.id)).map((i) => i.id));
        }
        e.preventDefault(); return;
      }
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (edit(removeItem(plan, selection))) onSelect(null);
      e.preventDefault();
      return;
    }
    if (e.key === " " && (selection.kind === "item" || selection.kind === "column")) {
      edit(rotateItem(plan, selection, e.shiftKey ? -90 : 90));
      e.preventDefault();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      const result = duplicate(plan, selection);
      if (edit(result) && result.ok) onSelect({ kind: selection.kind, id: result.id! });
      e.preventDefault();
      return;
    }
    // Arrow keys nudge what is selected: 10 mm, or 100 mm with Shift.
    const step = e.shiftKey ? 100 : 10;
    const nudge: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: step },
      ArrowDown: { x: 0, y: -step },
    };
    if (nudge[e.key] && DRAGGABLE.has(selection.kind)) {
      edit(moveBy(plan, selection, nudge[e.key]));
      e.preventDefault();
    }
  };

  // ---------------------------------------------------------------- drawing

  const s = view.scale;
  const px = (n: number) => n / s; // screen pixels as millimetres
  const viewBox = size.w ? `${view.cx - size.w / 2 / s} ${Y(view.cy) - size.h / 2 / s} ${size.w / s} ${size.h / s}` : "0 0 1 1";

  const grid = useMemo(() => {
    if (!size.w) return [];
    const stepCandidates = [500, 1_000, 5_000, 10_000, 50_000];
    const step = stepCandidates.find((g) => g * s >= 18) ?? 100_000;
    const x0 = Math.floor((view.cx - size.w / 2 / s) / step) * step;
    const x1 = view.cx + size.w / 2 / s;
    const y0 = Math.floor((view.cy - size.h / 2 / s) / step) * step;
    const y1 = view.cy + size.h / 2 / s;
    const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    for (let x = x0; x <= x1 && lines.length < 400; x += step) lines.push({ x1: x, y1: y0, x2: x, y2: y1, major: x % (step * 5) === 0 });
    for (let y = y0; y <= y1 && lines.length < 800; y += step) lines.push({ x1: x0, y1: y, x2: x1, y2: y, major: y % (step * 5) === 0 });
    return lines;
  }, [size.w, size.h, view.cx, view.cy, s]);

  const scaleBar = useMemo(() => {
    const len = niceLength(110 / s);
    return { px: len * s, label: len >= 1_000 ? `${len / 1_000} m` : `${len} mm` };
  }, [s]);

  const shownSelectedWall = selection?.kind === "wall" ? shown.walls.find((w) => w.id === selection.id) : undefined;
  const rawHoverWall = (tool === "door" || tool === "window") && cursor ? nearestWall(level, cursor, Math.max(PICK_PX / s, 300)) : null;
  const hoverWall = rawHoverWall && (tool === "door" || tool === "window") ? { ...rawHoverWall, ...snapOpening(level, { id: "preview", wallId: rawHoverWall.wall.id, kind: tool, at: rawHoverWall.at, width: DEFAULTS[tool] }, roundTo(rawHoverWall.at, 10), SNAP_PX / s, !free) } : null;
  const openingPreview: Opening | null = hoverWall && (tool === "door" || tool === "window") ? { id: "preview", wallId: hoverWall.wall.id, kind: tool, at: hoverWall.at, width: DEFAULTS[tool] } : null;
  const openingPreviewValid = openingPreview && hoverWall ? !openingsFit({ ...level, openings: [...level.openings, openingPreview] }, hoverWall.wall.id, wallLength(hoverWall.wall)) : false;
  const preview = drawing && wallStart && cursor ? wallEnd(cursor) : null;
  const previewEnd =
    preview && typed
      ? (() => {
          const towards = constrain(wallStart!, cursor!, free);
          const d = distance(wallStart!, towards) || 1;
          const length = Number.parseFloat(typed) || 0;
          return { x: wallStart!.x + ((towards.x - wallStart!.x) / d) * length, y: wallStart!.y + ((towards.y - wallStart!.y) / d) * length };
        })()
      : preview?.point;
  const snapsHere = (tool === "draft" && draftTool !== "text" && (!modifying || (stretching && points.length >= 2))) || drawing || tool === "outline" || tool === "dimension" || tool === "tape" || tool === "column" || tool === "calibrate" || tool === "split";
  const cornerHint = cursor && snapsHere ? (drawing && wallStart ? preview : snap(cursor, points)) : null;
  const step = stretching ? points.length : modifying ? (modPick ? 1 : 0) : chainPts ? 2 : tool === "draft" && draftTool === "dimchain" ? Math.min(points.length, 1) : tool === "draft" ? points.length : drawing ? (wallStart ? 1 : 0) : tool === "outline" ? (points.length ? 1 : 0) : tool === "dimension" || tool === "calibrate" || tool === "tape" ? points.length : tool === "trim" ? (trimFirst ? 1 : 0) : 0;
  const touch = useSyncExternalStore(watchCoarse, isCoarse, () => false);
  const tapeLine: [Point, Point] | null = tool !== "tape" || tapeMode !== "distance" ? null : points.length && cursor ? [points[0], snap(cursor).point] : tape;
  const draftHint = [...DRAFT_TOOLS, ...MODIFY_TOOLS, ...DIM_TOOLS].find((t) => t.key === draftTool)?.hint ?? HINTS.draft;
  const draftEnd = tool === "draft" && points.length && cursor ? (typedPoint() ?? draftPoint(cursor)) : null;
  const draftShown = draftEnd ? buildShape(draftTool, points, draftEnd) : null;
  const draftPreview: Draft | null = draftShown ? { ...draftShown, id: "preview", levelId, ...(draftLayer && draftLayer !== "drafting" ? { layer: draftLayer } : {}) } : null;
  const selectedDrafts = new Set([...(selection?.kind === "draft" ? [selection.id] : []), ...others.filter((t) => t.kind === "draft").map((t) => t.id)]);
  const areaLive = tool === "tape" && tapeMode === "area" ? (points.length && cursor ? [...points, snap(cursor, points).point] : area) : null;
  const tapeHint =
    tool !== "tape" || tapeMode === "distance"
      ? null
      : tapeMode === "point"
        ? idAt
          ? `${pointReading(idAt)}. Click another point; Esc clears.`
          : cursor
            ? `${pointReading(snap(cursor).point)}. Click to keep it on screen.`
            : "Click a point to read where it is."
        : areaLive && areaLive.length >= 3
          ? `${areaReading(areaLive)}${points.length ? ". Click the first point, Enter or double-click to close." : ". Click to measure another; Esc clears."}`
          : "Click round the outline to measure its area. Nothing is added to the plan.";
  const hint = message ?? tapeHint ?? (tapeLine ? `${tapeReading(tapeLine[0], tapeLine[1])}${points.length ? "" : ". Click to measure again; Esc clears."}` : copying ? "Copying. Let go to put the copy down; the original stays where it is." : tool === "select" && multiMode ? MULTI_SELECT : tool === "select" && touch ? TOUCH_SELECT : tool === "draft" ? draftHint[Math.min(step, draftHint.length - 1)] : HINTS[tool][Math.min(step, HINTS[tool].length - 1)]);
  const underlay = shown.underlays[0];
  const compareHere = compare ? onLevel(compare, levelId) : null;
  const ghost = tool === "item" && cursor ? lib.blueprint(placeType) ?? null : null;
  const dimPreview = tool === "dimension" && cursor && points.length ? (points.length === 1 ? [points[0], snap(cursor).point] : points) : null;
  const spacingTarget = drag?.target.kind === "wall" || drag?.target.kind === "opening" ? drag.target : selection;
  const spacingGuides = openingPreview && openingPreviewValid ? openingSpacing(level, openingPreview) : drawing && wallStart && previewEnd ? wallSpacing(level, { id: "preview", levelId, a: wallStart, b: previewEnd, thickness: tool === "partition" ? DEFAULTS.partitionThickness : DEFAULTS.wallThickness, kind: tool === "partition" ? "partition" : "wall" }) : tool === "select" && (!drag || dragged) ? selectionSpacing(shown, spacingTarget) : [];

  return (
    <div
      ref={boxRef}
      className="plan-canvas"
      data-look={look}
      tabIndex={0}
      role="application"
      aria-label="Floor plan. Use the tools above to draw. With something selected, arrow keys nudge it, Space turns it and Delete removes it."
      data-tool={tool}
      data-dragging={drag ? "true" : undefined}
      data-copying={copying ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        setMarquee(null);
        pointers.current.delete(e.pointerId);
        gesture.current = null;
        setDrag(null);
      }}
      onPointerLeave={() => setCursor(null)}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key === "Alt" && setFree(false)}
      onDoubleClick={() => {
        if (drawing) setWallStart(null);
        if (tool === "tape" && tapeMode === "area") finishArea(points);
        // The double click's second click already added its point; finish there.
        if (tool === "draft" && (draftTool === "polyline" || draftTool === "leader" || (draftTool === "dimchain" && !chainPts))) {
          const pts = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 0.5);
          finishDraft(pts, false);
        }
      }}
    >
      <svg viewBox={viewBox} width={size.w || undefined} height={size.h || undefined} role="group" aria-label="Floor plan drawing">
        <g className="plan-grid">
          {grid.map((l, i) => (
            <line key={i} x1={l.x1} y1={Y(l.y1)} x2={l.x2} y2={Y(l.y2)} data-major={l.major || undefined} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {layers.underlay && underlay && (underlaySrc ?? underlay.src) && (
          <image
            className="plan-underlay"
            href={underlaySrc ?? underlay.src}
            x={underlay.at.x}
            y={Y(underlay.at.y + (underlay.width * underlay.pixelHeight) / underlay.pixelWidth)}
            width={underlay.width}
            height={(underlay.width * underlay.pixelHeight) / underlay.pixelWidth}
            opacity={underlay.opacity}
            preserveAspectRatio="none"
          />
        )}

        {layers.below && below.length > 0 && (
          <g className="plan-below">
            {below.map((w) => (
              <line key={w.id} x1={w.a.x} y1={Y(w.a.y)} x2={w.b.x} y2={Y(w.b.y)} strokeWidth={w.thickness} />
            ))}
          </g>
        )}

        {layers.reference && (
          <g className="plan-reference">
            {shown.reference.map((l, i) => (
              <line key={i} x1={l.a.x} y1={Y(l.a.y)} x2={l.b.x} y2={Y(l.b.y)} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}

        {layers.rooms && (
          <g className="plan-rooms">
            {shown.rooms.map((r) => (
              <polygon
                key={r.id}
                points={pts(r.points)}
                data-usable={r.usable}
                data-selected={selection?.kind === "room" && selection.id === r.id}
                data-filled={roomFills?.has(r.id) || undefined}
                style={roomFills?.has(r.id) ? { fill: roomFills.get(r.id) } : undefined}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {look === "ceiling" &&
              shown.rooms.map((r) => {
                const box = {
                  minX: Math.min(...r.points.map((p) => p.x)),
                  maxX: Math.max(...r.points.map((p) => p.x)),
                  minY: Math.min(...r.points.map((p) => p.y)),
                  maxY: Math.max(...r.points.map((p) => p.y)),
                };
                const lines = ceilingLines(r.ceiling, box);
                return lines.length ? (
                  <g key={`c${r.id}`} className="plan-ceiling" data-kind={r.ceiling}>
                    <clipPath id={`ceil-${r.id}`}>
                      <polygon points={pts(r.points)} />
                    </clipPath>
                    <g clipPath={`url(#ceil-${r.id})`}>
                      {lines.map(([a, b], i) => <line key={i} x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} vectorEffect="non-scaling-stroke" />)}
                    </g>
                  </g>
                ) : null;
              })}
          </g>
        )}

        {layers.furniture && (
          <g className="plan-items">
            {shown.items.filter((i) => !i.hidden).map((i) => (
              <ItemMark key={i.id} phase={phaseMark(i)} item={i} selected={selectionIds.includes(i.id) || selection?.kind === "item" && selection.id === i.id} flagged={flagged?.has(i.id)} px={px} />
            ))}
          </g>
        )}

        {layers.walls && (
          <g className="plan-walls">
            {shown.walls.map((w) =>
              phaseMark(w) === "demolished" ? (
                <polygon key={w.id} className="plan-wall-demolished" points={pts(wallOutline(w))} vectorEffect="non-scaling-stroke" />
              ) : (
                <line
                  key={w.id}
                  x1={w.a.x}
                  y1={Y(w.a.y)}
                  x2={w.b.x}
                  y2={Y(w.b.y)}
                  strokeWidth={Math.max(w.thickness, px(1.5))}
                  data-kind={w.kind}
                  data-phase={phaseMark(w)}
                />
              )
            )}
          </g>
        )}

        {layers.openings && (
          <g className="plan-openings">
            {shown.openings.map((o) => {
              const wall = shown.walls.find((w) => w.id === o.wallId);
              return wall ? (
                <g key={o.id} data-phase={phaseMark(o)}>
                  <OpeningMark wall={wall} opening={o} px={px} selected={selection?.kind === "opening" && selection.id === o.id} />
                </g>
              ) : null;
            })}
          </g>
        )}

        {layers.openings && marks && look === "floor" && (
          <g className="plan-marks">
            {shown.openings.map((o) => {
              const wall = shown.walls.find((w) => w.id === o.wallId);
              const mark = marks.get(o.id);
              if (!wall || !mark) return null;
              const at = markAt(wall, o, px(18));
              const r = px(Math.max(11, mark.length * 3.6 + 4));
              return (
                <g key={o.id} transform={`translate(${at.x} ${Y(at.y)})`} data-kind={o.kind}>
                  {o.kind === "door" ? <circle r={r} /> : <rect x={-r} y={-px(9)} width={r * 2} height={px(18)} rx={px(3)} />}
                  <text fontSize={px(9.5)} textAnchor="middle" dominantBaseline="central">{mark}</text>
                </g>
              );
            })}
          </g>
        )}

        {layers.columns && (
          <g className="plan-columns">
            {shown.columns.map((c) =>
              c.round ? (
                <circle key={c.id} cx={c.at.x} cy={Y(c.at.y)} r={c.width / 2} data-phase={phaseMark(c)} data-selected={selection?.kind === "column" && selection.id === c.id} />
              ) : (
                <rect
                  key={c.id}
                  x={c.at.x - c.width / 2}
                  y={Y(c.at.y + c.depth / 2)}
                  width={c.width}
                  height={c.depth}
                  data-phase={phaseMark(c)}
                  data-selected={selection?.kind === "column" && selection.id === c.id}
                />
              )
            )}
          </g>
        )}

        {layers.drafting && (shown.drafts?.length ?? 0) > 0 && <DraftLayer plan={plan} shown={shown.drafts!} px={px} selected={selectedDrafts} />}

        {compareHere && (
          <g className="plan-compare">
            {compareHere.rooms.map((r) => (
              <polygon key={r.id} points={pts(r.points)} vectorEffect="non-scaling-stroke" />
            ))}
            {compareHere.walls.map((w) => (
              <line key={w.id} x1={w.a.x} y1={Y(w.a.y)} x2={w.b.x} y2={Y(w.b.y)} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}

        {shownSelectedWall && (
          <g className="plan-selected">
            <line x1={shownSelectedWall.a.x} y1={Y(shownSelectedWall.a.y)} x2={shownSelectedWall.b.x} y2={Y(shownSelectedWall.b.y)} vectorEffect="non-scaling-stroke" />
            <circle cx={shownSelectedWall.a.x} cy={Y(shownSelectedWall.a.y)} r={px(6)} className="plan-end-start" />
            <text x={shownSelectedWall.a.x + px(9)} y={Y(shownSelectedWall.a.y) - px(9)} fontSize={px(11)} className="plan-end-label">
              start
            </text>
            <circle cx={shownSelectedWall.b.x} cy={Y(shownSelectedWall.b.y)} r={px(6)} className="plan-end" />
          </g>
        )}

        {others.length > 0 && (
          <g className="plan-multi" aria-hidden>
            {others.map((t) => {
              const o = outlineOf(shown === level ? plan : (dragResult?.ok ? dragResult.plan : plan), t);
              if (!o) return null;
              const pts = o.points.map((p) => `${p.x},${Y(p.y)}`).join(" ");
              return o.closed ? <polygon key={`${t.kind}:${t.id}`} points={pts} vectorEffect="non-scaling-stroke" /> : <polyline key={`${t.kind}:${t.id}`} points={pts} vectorEffect="non-scaling-stroke" />;
            })}
          </g>
        )}

        {pins.length > 0 && (
          <g className="plan-pins" aria-hidden>
            {pins.map((p) => (
              <g key={p.key} transform={`translate(${p.at.x} ${Y(p.at.y)}) scale(${px(1)})`}>
                <circle r={7} />
                <path d="M-2.2 -3.2h4.4l-.8 2.6 1.8 1.6h-6.4l1.8-1.6z M0 1v3.6" />
              </g>
            ))}
          </g>
        )}

        {copying && (
          <g className="plan-originals">
            {copying.outlines.map((o, i) =>
              o.points.length === 1 ? (
                <circle key={i} cx={o.points[0].x} cy={Y(o.points[0].y)} r={px(5)} vectorEffect="non-scaling-stroke" />
              ) : o.closed ? (
                <polygon key={i} points={pts(o.points)} vectorEffect="non-scaling-stroke" />
              ) : (
                <polyline key={i} points={pts(o.points)} vectorEffect="non-scaling-stroke" />
              )
            )}
            {copying.bounds && (
              <>
                <rect
                  className="plan-originals-box"
                  x={copying.bounds.minX - px(6)}
                  y={Y(copying.bounds.maxY) - px(6)}
                  width={copying.bounds.maxX - copying.bounds.minX + px(12)}
                  height={copying.bounds.maxY - copying.bounds.minY + px(12)}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={copying.bounds.minX - px(6)} y={Y(copying.bounds.maxY) - px(11)} fontSize={px(11)} className="plan-originals-label">
                  Original
                </text>
              </>
            )}
            {copying.copyBounds && (
              <text x={copying.copyBounds.minX - px(6)} y={Y(copying.copyBounds.maxY) - px(11)} fontSize={px(11)} className="plan-copy-label">
                Copy
              </text>
            )}
          </g>
        )}

        {layers.dimensions && (
          <g className="plan-dimensions">
            {shown.walls.map((w) => (
              <WallDimension key={w.id} wall={w} px={px} scale={s} />
            ))}
          </g>
        )}

        {layers.dimensions && (
          <g className="plan-dimlines">
            {shown.dimensions.map((d) => (
              <DimensionMark key={d.id} a={d.a} b={d.b} offset={d.offset} px={px} selected={selection?.kind === "dimension" && selection.id === d.id} />
            ))}
          </g>
        )}

        {layers.rooms && (
          <g className="plan-room-labels">
            {shown.rooms.map((r) => {
              const c = centroid(r.points);
              const small = Math.sqrt(polygonArea(r.points)) * s < 70;
              return small ? null : (
                <text key={r.id} x={c.x} y={Y(c.y)} textAnchor="middle" fontSize={px(13)}>
                  <tspan x={c.x} dy={0} className="plan-room-name">{r.name}</tspan>
                  {look === "ceiling" ? (
                    <tspan x={c.x} dy={px(16)} className="plan-room-area">{`CH ${ceilingHeight(plan, r).toLocaleString("en-US")}, ${(CEILINGS.find((k) => k.key === (r.ceiling ?? "plaster"))?.label ?? "").toLowerCase()}`}</tspan>
                  ) : (
                    <tspan x={c.x} dy={px(16)} className="plan-room-area">{m2(roomArea(r))}</tspan>
                  )}
                </text>
              );
            })}
          </g>
        )}

        {layers.notes && (
          <g className="plan-notes-layer">
            {shown.notes.map((n) => (
              <text
                key={n.id}
                x={n.at.x}
                y={Y(n.at.y)}
                fontSize={px(12.5)}
                data-selected={selection?.kind === "note" && selection.id === n.id}
              >
                {n.text}
              </text>
            ))}
          </g>
        )}

        {(plan.cameras ?? []).some((c) => c.levelId === levelId) && (
          <g className="plan-cameras" aria-hidden>
            {(plan.cameras ?? [])
              .filter((c) => c.levelId === levelId)
              .map((c) => {
                // A view cone from the camera towards what it looks at, as on a Revit plan.
                const dx = c.target.x - c.eye.x;
                const dy = c.target.y - c.eye.y;
                const len = Math.hypot(dx, dy) || 1;
                const reach = px(46);
                const half = c.projection === "perspective" ? Math.tan(((c.fov / 2) * Math.PI) / 180) * reach : px(14);
                const ux = dx / len;
                const uy = dy / len;
                const fx = c.eye.x + ux * reach;
                const fy = c.eye.y + uy * reach;
                const a = { x: fx - uy * half, y: fy + ux * half };
                const b = { x: fx + uy * half, y: fy - ux * half };
                return (
                  <g key={c.id}>
                    <polygon points={`${c.eye.x},${Y(c.eye.y)} ${a.x},${Y(a.y)} ${b.x},${Y(b.y)}`} />
                    <circle cx={c.eye.x} cy={Y(c.eye.y)} r={px(4.5)} />
                    <text x={c.eye.x + px(8)} y={Y(c.eye.y) - px(8)} fontSize={px(11)}>{c.name}</text>
                  </g>
                );
              })}
          </g>
        )}

        {hoverWall && (
          <g className="plan-preview" data-valid={openingPreviewValid}>
            <line
              x1={pointAlong(hoverWall.wall, Math.max(0, hoverWall.at - DEFAULTS[tool as "door" | "window"] / 2)).x}
              y1={Y(pointAlong(hoverWall.wall, Math.max(0, hoverWall.at - DEFAULTS[tool as "door" | "window"] / 2)).y)}
              x2={pointAlong(hoverWall.wall, Math.min(wallLength(hoverWall.wall), hoverWall.at + DEFAULTS[tool as "door" | "window"] / 2)).x}
              y2={Y(pointAlong(hoverWall.wall, Math.min(wallLength(hoverWall.wall), hoverWall.at + DEFAULTS[tool as "door" | "window"] / 2)).y)}
              strokeWidth={hoverWall.wall.thickness + px(4)}
            />
          </g>
        )}

        {ghost && cursor && (
          <g className="plan-ghost">
            <ItemMark
              item={{ id: "ghost", levelId, type: ghost.type, ...(ghost.id === `std:${ghost.type}` ? {} : { blueprintId: ghost.id }), at: { x: roundTo(cursor.x, 10), y: roundTo(cursor.y, 10) }, width: ghost.size.w, depth: ghost.size.d, rotation: placeRotation }}
              selected={false}
              px={px}
            />
          </g>
        )}

        {wallStart && previewEnd && (
          <g className="plan-draft">
            <line
              x1={wallStart.x}
              y1={Y(wallStart.y)}
              x2={previewEnd.x}
              y2={Y(previewEnd.y)}
              strokeWidth={tool === "partition" ? DEFAULTS.partitionThickness : DEFAULTS.wallThickness}
            />
            <text
              x={(wallStart.x + previewEnd.x) / 2}
              y={Y((wallStart.y + previewEnd.y) / 2) - px(14)}
              fontSize={px(12)}
              textAnchor="middle"
              className="plan-draft-label"
            >
              {typed ? `${typed} mm` : mm(distance(wallStart, previewEnd))}
            </text>
          </g>
        )}

        {tool === "outline" && points.length > 0 && (
          <g className="plan-draft-room">
            <polyline points={pts(cursor ? [...points, snap(cursor, points).point] : points)} vectorEffect="non-scaling-stroke" />
            {points.map((p, i) => (
              <circle key={i} cx={p.x} cy={Y(p.y)} r={px(i === 0 ? 6 : 4)} />
            ))}
          </g>
        )}

        {dimPreview && (
          <g className="plan-dimlines plan-dim-draft">
            <DimensionMark
              a={dimPreview[0]}
              b={dimPreview[1]}
              offset={points.length === 2 && cursor ? offsetTo(points[0], points[1], cursor) : 0}
              px={px}
              selected
            />
          </g>
        )}

        {chainPts && cursor && (
          <g className="plan-draft-preview">
            {chainPts.slice(1).map((q, i) => {
              const at = snap(cursor).point;
              const d: Draft = { id: `chain-${i}`, levelId, shape: "dimension", dim: linearKind(chainPts[0], chainPts[chainPts.length - 1], at), points: [chainPts[i], q, at] };
              return <DraftMark key={i} plan={plan} d={d} px={px} preview />;
            })}
          </g>
        )}
        {stretching && cursor && points.length > 0 && (() => {
          const end = points.length < 2 ? cursor : points[1];
          const box = { x: Math.min(points[0].x, end.x), y: Math.max(points[0].y, end.y), w: Math.abs(end.x - points[0].x), h: Math.abs(end.y - points[0].y) };
          const to = points.length === 3 ? draftSnap(cursor) : null;
          const d = to ? { x: to.x - points[2].x, y: to.y - points[2].y } : null;
          return (
            <g className="plan-draft-preview">
              <rect className="plan-marquee" x={box.x} y={Y(box.y)} width={box.w} height={box.h} />
              {d && <rect className="plan-stretch-ghost" x={box.x + d.x} y={Y(box.y + d.y)} width={box.w} height={box.h} vectorEffect="non-scaling-stroke" />}
              {to && (
                <>
                  <line x1={points[2].x} y1={Y(points[2].y)} x2={to.x} y2={Y(to.y)} vectorEffect="non-scaling-stroke" />
                  <circle cx={points[2].x} cy={Y(points[2].y)} r={px(3)} />
                  <text x={to.x + px(10)} y={Y(to.y) - px(10)} fontSize={px(12)} className="plan-draft-label">
                    {`${Math.round(distance(points[2], to)).toLocaleString("en-ZA")} mm < ${angleOf(points[2], to)}°`}
                  </text>
                </>
              )}
            </g>
          );
        })()}
        {lineish && !free && draftEnd && points.length > 0 && !(cornerHint?.snapped) && (() => {
          // Polar tracking: a faint ray along the locked angle.
          const last = points[points.length - 1];
          const L = distance(last, draftEnd);
          if (L < 1) return null;
          const far = { x: last.x + ((draftEnd.x - last.x) / L) * 200_000, y: last.y + ((draftEnd.y - last.y) / L) * 200_000 };
          return <line className="plan-tracking" x1={last.x} y1={Y(last.y)} x2={far.x} y2={Y(far.y)} vectorEffect="non-scaling-stroke" />;
        })()}
        {draftPreview && draftEnd && (
          <g className="plan-draft-preview">
            <DraftMark plan={plan} d={draftPreview} px={px} preview />
            {points.map((q, i) => <circle key={i} cx={q.x} cy={Y(q.y)} r={px(3)} />)}
            {lineish && (
              <text x={draftEnd.x + px(10)} y={Y(draftEnd.y) - px(10)} fontSize={px(12)} className="plan-draft-label">
                {typed ? `${typed} ↵` : `${Math.round(distance(points[points.length - 1], draftEnd)).toLocaleString("en-ZA")} mm < ${angleOf(points[points.length - 1], draftEnd)}°`}
              </text>
            )}
            {!lineish && typed && (
              <text x={draftEnd.x + px(10)} y={Y(draftEnd.y) - px(10)} fontSize={px(12)} className="plan-draft-label">{`${typed} ↵`}</text>
            )}
          </g>
        )}

        {areaLive && areaLive.length >= 2 && (
          <g className="plan-tape">
            <polygon className="plan-tape-area" points={areaLive.map((q) => `${q.x},${Y(q.y)}`).join(" ")} vectorEffect="non-scaling-stroke" />
            {areaLive.map((q, i) => <circle key={i} cx={q.x} cy={Y(q.y)} r={px(4)} />)}
            {areaLive.length >= 3 && (() => {
              const c = centroid(areaLive);
              return (
                <text x={c.x} y={Y(c.y) + px(44)} fontSize={px(13)} textAnchor="middle">
                  {areaReading(areaLive).split(",")[0]}
                </text>
              );
            })()}
          </g>
        )}
        {tool === "tape" && tapeMode === "point" && idAt && (
          <g className="plan-tape">
            <circle cx={idAt.x} cy={Y(idAt.y)} r={px(4)} />
            <text x={idAt.x + px(10)} y={Y(idAt.y) - px(10)} fontSize={px(13)}>{pointReading(idAt)}</text>
          </g>
        )}
        {tapeLine && (
          <g className="plan-tape">
            <line x1={tapeLine[0].x} y1={Y(tapeLine[0].y)} x2={tapeLine[1].x} y2={Y(tapeLine[1].y)} vectorEffect="non-scaling-stroke" />
            {tapeLine.map((q, i) => <circle key={i} cx={q.x} cy={Y(q.y)} r={px(4)} />)}
            <text x={(tapeLine[0].x + tapeLine[1].x) / 2} y={Y((tapeLine[0].y + tapeLine[1].y) / 2) - px(10)} fontSize={px(13)} textAnchor="middle">
              {Math.round(distance(tapeLine[0], tapeLine[1])).toLocaleString("en-US")}
            </text>
          </g>
        )}

        {tool === "calibrate" && points.length === 1 && cursor && (
          <g className="plan-draft-room">
            <polyline points={pts([points[0], snap(cursor).point])} vectorEffect="non-scaling-stroke" />
            <circle cx={points[0].x} cy={Y(points[0].y)} r={px(5)} />
          </g>
        )}

        {cornerHint?.snapped && (
          <g className="plan-snap-mark" transform={`translate(${cornerHint.point.x} ${Y(cornerHint.point.y)}) scale(${px(1)})`}>
            {cornerHint.kind === "middle" ? (
              <polygon className="plan-snap" points="0,-8 7,5 -7,5" />
            ) : cornerHint.kind === "centre" ? (
              <path className="plan-snap" d="M-8 0h16M0 -8v16" />
            ) : cornerHint.kind === "wall" ? (
              <path className="plan-snap" d="M-6 -6l12 12M6 -6l-12 12" />
            ) : (
              <circle className="plan-snap" r={7} />
            )}
            {cornerHint.kind && <text className="plan-snap-label" x={11} y={-9}>{SNAP_LABEL[cornerHint.kind]}</text>}
          </g>
        )}
        {cornerHint?.guides?.map((g, i) => <line key={`align-${i}`} className="plan-alignment-guide" x1={g.a.x} y1={Y(g.a.y)} x2={g.b.x} y2={Y(g.b.y)} vectorEffect="non-scaling-stroke" />)}
        <g className="plan-spacing-guides">{spacingGuides.map((g) => <SpacingMark key={g.id} guide={g} px={px} onAdjust={tool === "select" && !drag && onDistanceSelect ? () => onDistanceSelect(g.id) : undefined} />)}</g>
        {marquee && <rect x={Math.min(marquee.a.x, marquee.b.x)} y={Y(Math.max(marquee.a.y, marquee.b.y))} width={Math.abs(marquee.a.x - marquee.b.x)} height={Math.abs(marquee.a.y - marquee.b.y)} className="plan-marquee" vectorEffect="non-scaling-stroke" />}
      </svg>

      {noteDraft && (
        <input
          className="input plan-note-input"
          style={{ left: noteDraft.screen.x, top: noteDraft.screen.y }}
          autoFocus
          placeholder="Type the note, then Enter"
          aria-label="Note"
          value={noteDraft.text}
          maxLength={500}
          onChange={(e) => setNoteDraft({ ...noteDraft, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitNote();
            if (e.key === "Escape") {
              setNoteDraft(null);
              boxRef.current?.focus({ preventScroll: true });
            }
          }}
          onBlur={commitNote}
        />
      )}

      {wordsDraft && (
        <input
          className="input plan-note-input"
          style={{ left: wordsDraft.screen.x, top: wordsDraft.screen.y }}
          autoFocus
          placeholder={wordsDraft.leader ? "The leader's words (optional), then Enter" : "Type the text, then Enter"}
          aria-label={wordsDraft.leader ? "Leader text" : "Text"}
          value={wordsDraft.text}
          maxLength={500}
          onChange={(e) => setWordsDraft({ ...wordsDraft, text: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitWords();
            if (e.key === "Escape") {
              setWordsDraft(null);
              boxRef.current?.focus({ preventScroll: true });
            }
          }}
          onBlur={commitWords}
        />
      )}

      {(tool === "draft" || tool === "hatch") && (
        <form
          className="plan-command"
          onPointerDown={(e) => e.stopPropagation()}
          onSubmit={(e) => {
            e.preventDefault();
            runCommand();
          }}
        >
          <span className="plan-command-prompt" aria-hidden>Command:</span>
          <input
            className="input"
            value={command}
            placeholder={points.length ? "@dx,dy  @len<angle  x,y" : "L, PL, REC, C, TR, O 100…"}
            aria-label="Command line"
            autoComplete="off"
            spellCheck={false}
            maxLength={60}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setCommand("");
                boxRef.current?.focus({ preventScroll: true });
              }
            }}
          />
          <button type="button" className="icon-btn" aria-label="Commands" aria-expanded={commandHelp} title="Commands" onClick={() => setCommandHelp((o) => !o)}>?</button>
          {commandHelp && (
            <dl className="plan-command-help">
              {COMMAND_HELP.map((h) => (
                <div key={h.keys}>
                  <dt>{h.keys}</dt>
                  <dd>{h.what}</dd>
                </div>
              ))}
            </dl>
          )}
        </form>
      )}

      <div className={`plan-hint${message ? " plan-hint-error" : ""}`} role={message ? "alert" : "status"}>
        {hint}
        {drawing && wallStart && typed && <span className="plan-typed">{typed} mm ↵</span>}
      </div>
      <div className="plan-scale" aria-label={`Scale bar, ${scaleBar.label}`}>
        <span style={{ width: scaleBar.px }} />
        {scaleBar.label}
      </div>
    </div>
  );
}

function SpacingMark({ guide, px, onAdjust }: { guide: SpacingGuide; px: (n: number) => number; onAdjust?: () => void }) {
  const [a, b] = dimensionLine(guide.a, guide.b, px(guide.offset));
  const label = { x: (a.x + b.x) / 2, y: Y((a.y + b.y) / 2) - px(8) };
  const len = distance(a, b) || 1;
  const tick = { x: -(b.y - a.y) / len * px(4), y: (b.x - a.x) / len * px(4) };
  return <g data-distance-id={guide.id} data-distance-value={guide.value} aria-label={`${guide.label}: ${mm(guide.value)}`}>
    {[ [guide.a, a], [guide.b, b] ].map(([from, to], i) => <line key={`ext-${i}`} x1={from.x} y1={Y(from.y)} x2={to.x} y2={Y(to.y)} className="plan-spacing-extension" vectorEffect="non-scaling-stroke" />)}
    <line x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} vectorEffect="non-scaling-stroke" />
    {[a, b].map((p, i) => <line key={`tick-${i}`} x1={p.x - tick.x} y1={Y(p.y - tick.y)} x2={p.x + tick.x} y2={Y(p.y + tick.y)} vectorEffect="non-scaling-stroke" />)}
    <g className={onAdjust ? "plan-distance-label" : undefined} role={onAdjust ? "button" : undefined} tabIndex={onAdjust ? 0 : undefined} aria-label={onAdjust ? `Adjust ${guide.label.toLowerCase()}: ${mm(guide.value)}` : undefined} onClick={onAdjust ? (e) => { e.stopPropagation(); onAdjust(); } : undefined} onKeyDown={onAdjust ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onAdjust(); } } : undefined}>
      <rect x={label.x - px(42)} y={label.y - px(23)} width={px(84)} height={px(44)} rx={px(8)} />
      <text x={label.x} y={label.y} dominantBaseline="middle" textAnchor="middle" fontSize={px(12)}>{mm(guide.value)}</text>
    </g>
  </g>;
}

/** Furniture drawn from its library shapes, turned and placed. */
function ItemMark({ item, selected, flagged, px, phase }: { item: Item; selected: boolean; flagged?: boolean; px: (n: number) => number; phase?: string }) {
  const lib = useResolver();
  return (
    <g transform={`translate(${item.at.x} ${Y(item.at.y)}) rotate(${-item.rotation})`} data-item-id={item.id} style={item.color && !selected ? { color: item.color } : undefined} data-selected={selected} data-flagged={flagged || undefined} data-phase={phase}>
      <ShapeList shapes={itemSymbol(lib, item)} />
      {item.label && item.width > px(30) && (
        <text x={0} y={0} fontSize={Math.min(px(11), item.depth / 3)} textAnchor="middle" dominantBaseline="middle" className="plan-item-label">
          {item.label}
        </text>
      )}
    </g>
  );
}

/** Library shapes in the item's own frame, y up. */
export function ShapeList({ shapes }: { shapes: Shape[] }) {
  return (
    <>
      {shapes.map((sh, i) =>
        sh.t === "rect" ? (
          <rect key={i} x={sh.x} y={Y(sh.y + sh.h)} width={sh.w} height={sh.h} rx={sh.r} vectorEffect="non-scaling-stroke" />
        ) : sh.t === "circle" ? (
          <circle key={i} cx={sh.x} cy={Y(sh.y)} r={sh.r} vectorEffect="non-scaling-stroke" />
        ) : sh.t === "ellipse" ? (
          <ellipse key={i} cx={sh.x} cy={Y(sh.y)} rx={sh.rx} ry={sh.ry} transform={`rotate(${(-sh.rotation * 180) / Math.PI} ${sh.x} ${Y(sh.y)})`} vectorEffect="non-scaling-stroke" />
        ) : sh.t === "poly" ? (
          <polygon key={i} points={sh.points.map((p) => `${p.x},${Y(p.y)}`).join(" ")} vectorEffect="non-scaling-stroke" />
        ) : (
          <line key={i} x1={sh.x1} y1={Y(sh.y1)} x2={sh.x2} y2={Y(sh.y2)} vectorEffect="non-scaling-stroke" />
        )
      )}
    </>
  );
}

/** A door as a gap with its leaves and swings, a sliding door as two offset panels; a window as a gap with glazing lines. */
function OpeningMark({ wall, opening, px, selected }: { wall: Wall; opening: Opening; px: (n: number) => number; selected: boolean }) {
  const { at, width, kind } = opening;
  const start = pointAlong(wall, at - width / 2);
  const end = pointAlong(wall, at + width / 2);
  const len = wallLength(wall) || 1;
  const ux = (wall.b.x - wall.a.x) / len;
  const uy = (wall.b.y - wall.a.y) / len;
  const nx = -uy;
  const ny = ux;
  const t = wall.thickness / 2;
  const off = (p: Point, d: number, along = 0) => ({ x: p.x + nx * d + ux * along, y: p.y + ny * d + uy * along });
  const gap = <line x1={start.x} y1={Y(start.y)} x2={end.x} y2={Y(end.y)} strokeWidth={wall.thickness + px(2)} className="plan-gap" />;
  const seg = (p: Point, q: Point, key: string | number, className?: string) => (
    <line key={key} x1={p.x} y1={Y(p.y)} x2={q.x} y2={Y(q.y)} vectorEffect="non-scaling-stroke" className={className} />
  );
  if (kind === "window") {
    return (
      <g data-selected={selected} className="plan-window">
        {gap}
        {[-t, 0, t].map((d) => seg(off(start, d), off(end, d), d))}
      </g>
    );
  }
  const style = opening.style ?? "single";
  if (style === "sliding") {
    const half = width / 2;
    return (
      <g data-selected={selected} className="plan-door">
        {gap}
        {seg(off(start, t / 3), off(start, t / 3, half + 50), "a")}
        {seg(off(end, -t / 3), off(end, -t / 3, -half - 50), "b")}
      </g>
    );
  }
  if (style === "opening") {
    return (
      <g data-selected={selected} className="plan-door">
        {gap}
        {seg(off(start, -t), off(start, t), "a")}
        {seg(off(end, -t), off(end, t), "b")}
      </g>
    );
  }
  // Each leaf stands open at right angles from its hinge, and its swing runs back to the jamb it closes on.
  const side = opening.side ?? 1;
  return (
    <g data-selected={selected} className="plan-door">
      {gap}
      {doorLeaves(wall, opening).map((leaf, i) => {
        const hinge = off(leaf.hinge, t * side);
        const open = off(leaf.open, t * side);
        const r = distance(leaf.hinge, leaf.open);
        const toJamb = { x: (leaf.jamb.x - leaf.hinge.x) / r, y: (leaf.jamb.y - leaf.hinge.y) / r };
        const toOpen = { x: (leaf.open.x - leaf.hinge.x) / r, y: (leaf.open.y - leaf.hinge.y) / r };
        const swing: Point[] = [];
        for (let k = 0; k <= 16; k++) {
          const a = (Math.PI / 2) * (k / 16);
          swing.push({ x: hinge.x + (toOpen.x * Math.cos(a) + toJamb.x * Math.sin(a)) * r, y: hinge.y + (toOpen.y * Math.cos(a) + toJamb.y * Math.sin(a)) * r });
        }
        return (
          <g key={i}>
            {seg(hinge, open, "leaf")}
            <polyline points={pts(swing)} vectorEffect="non-scaling-stroke" className="plan-swing" />
          </g>
        );
      })}
    </g>
  );
}

/** A dimension line with its extension lines, ticks and the true distance. */
function DimensionMark({ a, b, offset, px, selected }: { a: Point; b: Point; offset: number; px: (n: number) => number; selected: boolean }) {
  const len = distance(a, b);
  if (len < 1) return null;
  const [p, q] = dimensionLine(a, b, offset);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const tick = px(5);
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  let angle = (-Math.atan2(uy, ux) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  const t = (c: Point) => ({ x1: c.x - (ux + uy * -1) * tick, y1: Y(c.y - (uy + ux) * tick), x2: c.x + (ux + uy * -1) * tick, y2: Y(c.y + (uy + ux) * tick) });
  return (
    <g data-selected={selected}>
      <line x1={a.x} y1={Y(a.y)} x2={p.x} y2={Y(p.y)} vectorEffect="non-scaling-stroke" className="plan-dim-ext" />
      <line x1={b.x} y1={Y(b.y)} x2={q.x} y2={Y(q.y)} vectorEffect="non-scaling-stroke" className="plan-dim-ext" />
      <line x1={p.x} y1={Y(p.y)} x2={q.x} y2={Y(q.y)} vectorEffect="non-scaling-stroke" />
      <line {...t(p)} vectorEffect="non-scaling-stroke" />
      <line {...t(q)} vectorEffect="non-scaling-stroke" />
      <text
        x={mid.x}
        y={Y(mid.y)}
        dy={-px(5)}
        fontSize={px(11)}
        textAnchor="middle"
        transform={`rotate(${angle} ${mid.x} ${Y(mid.y)})`}
      >
        {Math.round(len).toLocaleString("en-ZA")}
      </text>
    </g>
  );
}

/** A wall's length written beside it, upright, when there is room to read it. */
function WallDimension({ wall, px, scale }: { wall: Wall; px: (n: number) => number; scale: number }) {
  const len = wallLength(wall);
  if (len * scale < 54) return null;
  const mid = { x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 };
  const nx = -(wall.b.y - wall.a.y) / len;
  const ny = (wall.b.x - wall.a.x) / len;
  const off = wall.thickness / 2 + px(9);
  const at = { x: mid.x + nx * off, y: mid.y + ny * off };
  let angle = (-Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return (
    <text x={at.x} y={Y(at.y)} fontSize={px(10.5)} textAnchor="middle" dominantBaseline="middle" transform={`rotate(${angle} ${at.x} ${Y(at.y)})`}>
      {Math.round(len).toLocaleString("en-ZA")}
    </text>
  );
}
