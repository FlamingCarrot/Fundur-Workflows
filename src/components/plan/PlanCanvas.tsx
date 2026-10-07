"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { addDimension, addItem, addNote, doorLeaves, duplicate, moveBy, moveCorner, roomAt, rotateItem } from "@/lib/plan/elements";
import { snapItemDelta } from "@/lib/layout/options";
import { libraryItem, type Shape } from "@/lib/plan/library";
import { useViewSetting } from "@/lib/view-settings/client";

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
  | "calibrate";

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
}

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

const HINTS: Record<Tool, string[]> = {
  select: ["Click anything to edit it, drag it to move it. Drag empty space to move around; scroll or pinch to zoom."],
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
};

const Y = (y: number) => -y;
const pts = (points: Point[]) => points.map((p) => `${p.x},${Y(p.y)}`).join(" ");
const DRAGGABLE = new Set<PlanItem["kind"]>(["item", "column", "note", "dimension", "opening", "wall"]);

function niceLength(target: number): number {
  const power = 10 ** Math.floor(Math.log10(target));
  const n = target / power;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
}

/** Angles snap to 45° steps unless Alt is held, so walls come out square. */
function constrain(from: Point, to: Point, free: boolean): Point {
  if (free) return to;
  const len = distance(from, to);
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / step) * step;
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len };
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

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
  | { kind: "pan"; x: number; y: number; view: View; moved: boolean }
  | { kind: "pinch"; dist: number; mid: { x: number; y: number }; view: View }
  | { kind: "drag"; target: PlanItem; from: Point; x: number; y: number; moved: boolean }
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
  onSelect,
  onEdit,
  onToolDone,
  onCalibrate,
  fitSignal,
  flagged,
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
  onSelect: (item: PlanItem | null) => void;
  onEdit: (result: EditResult) => string | null;
  onToolDone: () => void;
  onCalibrate: (a: Point, b: Point) => void;
  fitSignal: number;
  /** Items the layout check flags, drawn in the warning colour. */
  flagged?: ReadonlySet<string>;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 0.05 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [free, setFree] = useState(false);
  const [wallStart, setWallStart] = useState<Point | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [placeRotation, setPlaceRotation] = useState(0);
  const [noteDraft, setNoteDraft] = useState<{ at: Point; screen: { x: number; y: number }; text: string } | null>(null);
  const [drag, setDrag] = useState<{ target: PlanItem | { kind: "corner"; from: Point }; delta: Point } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  // This floor only: drawing, picking and snapping all work on it.
  const level = useMemo(() => onLevel(plan, levelId), [plan, levelId]);
  const below = useMemo(() => {
    const here = plan.levels.find((l) => l.id === levelId);
    const lower = plan.levels.filter((l) => here && l.elevation < here.elevation).sort((p, q) => q.elevation - p.elevation)[0];
    return lower ? plan.walls.filter((w) => w.levelId === lower.id) : [];
  }, [plan, levelId]);

  // While something is dragged, the plan is drawn as it would be if dropped there.
  const dragged = useMemo(() => {
    if (!drag) return null;
    const result =
      drag.target.kind === "corner"
        ? moveCorner(plan, drag.target.from, { x: drag.target.from.x + drag.delta.x, y: drag.target.from.y + drag.delta.y }, levelId)
        : moveBy(plan, drag.target, drag.delta);
    return result.ok ? onLevel(result.plan, levelId) : null;
  }, [drag, plan, levelId]);
  const shown = dragged ?? level;

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
  const [savedView, saveView] = useViewSetting<View | null>(viewKey, null, isViewOrNull);
  const fitKey = `${fitSignal}:${levelId}:${size.w > 0 && size.h > 0}`;
  const [fittedKey, setFittedKey] = useState("");
  if (size.w && size.h && fittedKey !== fitKey) {
    const asked = fittedKey !== "" && !fittedKey.startsWith(`${fitSignal}:`);
    setFittedKey(fitKey);
    const own = planBounds(level) ? level : plan;
    setView(!asked && savedView ? savedView : fitView(own, size));
  }

  // Remember the view once it settles, not on every frame of a pan.
  useEffect(() => {
    if (!fittedKey) return;
    const t = setTimeout(() => saveView(view), 500);
    return () => clearTimeout(t);
  }, [view, fittedKey, saveView]);

  // Leaving a tool drops whatever was half drawn.
  const [lastTool, setLastTool] = useState(`${tool}:${levelId}`);
  if (lastTool !== `${tool}:${levelId}`) {
    setLastTool(`${tool}:${levelId}`);
    setWallStart(null);
    setPoints([]);
    setTyped("");
    setNoteDraft(null);
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
  const snap = (p: Point, extra: Point[] = []): { point: Point; snapped: boolean } => {
    const within = SNAP_PX / view.scale;
    const corner = cornerNear(p, within) ?? extra.find((q) => distance(p, q) <= within) ?? null;
    if (corner) return { point: corner, snapped: true };
    return { point: { x: roundTo(p.x, 10), y: roundTo(p.y, 10) }, snapped: false };
  };

  /** The end of the wall being drawn: on a corner when one is close, else square to the start. */
  const wallEnd = (raw: Point): { point: Point; snapped: boolean } => {
    if (!wallStart) return snap(raw);
    const corner = cornerNear(raw, SNAP_PX / view.scale, wallStart);
    if (corner) return { point: corner, snapped: true };
    const c = constrain(wallStart, raw, free);
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
      const hits = level.items.filter((i) => inItem(i, p, within / 2));
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

  const click = (raw: Point, screen: { x: number; y: number }) => {
    switch (tool) {
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
        const result = addOpening(plan, hit.wall.id, tool, roundTo(hit.at, 10));
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
        edit(addItem(plan, placeType, at, levelId, placeRotation));
        return;
      }
      case "note": {
        setNoteDraft({ at: snap(raw).point, screen, text: "" });
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
    if ((e.target as HTMLElement).closest(".plan-note-input")) return;
    if (noteDraft) {
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
      // The ends of a selected wall are handles: drag one to move that corner.
      if (selectedWall) {
        const end = [selectedWall.a, selectedWall.b].find((q) => distance(p, q) <= (PICK_PX + 3) / view.scale);
        if (end) {
          gesture.current = { kind: "corner", from: end, x: e.clientX, y: e.clientY, moved: false };
          return;
        }
      }
      const target = pick(p);
      if (target && DRAGGABLE.has(target.kind)) {
        gesture.current = { kind: "drag", target, from: p, x: e.clientX, y: e.clientY, moved: false };
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
    if (g.kind === "corner") {
      const to = cornerNear(p, SNAP_PX / view.scale, g.from) ?? constrainedCorner(g.from, p);
      setDrag({ target: { kind: "corner", from: g.from }, delta: { x: to.x - g.from.x, y: to.y - g.from.y } });
      return;
    }
    const delta = { x: roundTo(p.x - g.from.x, 10), y: roundTo(p.y - g.from.y, 10) };
    // Furniture lines up with, or butts against, its neighbours as it nears them.
    setDrag({ target: g.target, delta: g.target.kind === "item" ? snapItemDelta(plan, levelId, g.target.id, delta, SNAP_PX / view.scale) : delta });
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
      } else {
        const target = current.target;
        if (edit(moveBy(plan, target, current.delta))) onSelect(target);
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
    if (e.key === "Escape") {
      if (wallStart || points.length) {
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
    if (tool !== "select" || !selection) return;
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
  const hoverWall = (tool === "door" || tool === "window") && cursor ? nearestWall(level, cursor, Math.max(PICK_PX / s, 300)) : null;
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
  const snapsHere = drawing || tool === "outline" || tool === "dimension" || tool === "column" || tool === "calibrate";
  const cornerHint = cursor && snapsHere ? (drawing && wallStart ? preview : snap(cursor, points)) : null;
  const step = drawing ? (wallStart ? 1 : 0) : tool === "outline" ? (points.length ? 1 : 0) : tool === "dimension" || tool === "calibrate" ? points.length : 0;
  const hint = message ?? HINTS[tool][Math.min(step, HINTS[tool].length - 1)];
  const underlay = shown.underlays[0];
  const compareHere = compare ? onLevel(compare, levelId) : null;
  const ghost = tool === "item" && cursor ? libraryItem(placeType) : null;
  const dimPreview = tool === "dimension" && cursor && points.length ? (points.length === 1 ? [points[0], snap(cursor).point] : points) : null;

  return (
    <div
      ref={boxRef}
      className="plan-canvas"
      tabIndex={0}
      role="application"
      aria-label="Floor plan. Use the tools above to draw. With something selected, arrow keys nudge it, Space turns it and Delete removes it."
      data-tool={tool}
      data-dragging={drag ? "true" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        gesture.current = null;
        setDrag(null);
      }}
      onPointerLeave={() => setCursor(null)}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key === "Alt" && setFree(false)}
      onDoubleClick={() => {
        if (drawing) setWallStart(null);
      }}
    >
      <svg viewBox={viewBox} width={size.w || undefined} height={size.h || undefined} aria-hidden>
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
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {layers.furniture && (
          <g className="plan-items">
            {shown.items.map((i) => (
              <ItemMark key={i.id} item={i} selected={selection?.kind === "item" && selection.id === i.id} flagged={flagged?.has(i.id)} px={px} />
            ))}
          </g>
        )}

        {layers.walls && (
          <g className="plan-walls">
            {shown.walls.map((w) => (
              <line
                key={w.id}
                x1={w.a.x}
                y1={Y(w.a.y)}
                x2={w.b.x}
                y2={Y(w.b.y)}
                strokeWidth={Math.max(w.thickness, px(1.5))}
                data-kind={w.kind}
              />
            ))}
          </g>
        )}

        {layers.openings && (
          <g className="plan-openings">
            {shown.openings.map((o) => {
              const wall = shown.walls.find((w) => w.id === o.wallId);
              return wall ? (
                <OpeningMark key={o.id} wall={wall} opening={o} px={px} selected={selection?.kind === "opening" && selection.id === o.id} />
              ) : null;
            })}
          </g>
        )}

        {layers.columns && (
          <g className="plan-columns">
            {shown.columns.map((c) =>
              c.round ? (
                <circle key={c.id} cx={c.at.x} cy={Y(c.at.y)} r={c.width / 2} data-selected={selection?.kind === "column" && selection.id === c.id} />
              ) : (
                <rect
                  key={c.id}
                  x={c.at.x - c.width / 2}
                  y={Y(c.at.y + c.depth / 2)}
                  width={c.width}
                  height={c.depth}
                  data-selected={selection?.kind === "column" && selection.id === c.id}
                />
              )
            )}
          </g>
        )}

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
                  <tspan x={c.x} dy={px(16)} className="plan-room-area">{m2(roomArea(r))}</tspan>
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

        {hoverWall && (
          <g className="plan-preview">
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
              item={{ id: "ghost", levelId, type: ghost.type, at: { x: roundTo(cursor.x, 10), y: roundTo(cursor.y, 10) }, width: ghost.width, depth: ghost.depth, rotation: placeRotation }}
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

        {tool === "calibrate" && points.length === 1 && cursor && (
          <g className="plan-draft-room">
            <polyline points={pts([points[0], snap(cursor).point])} vectorEffect="non-scaling-stroke" />
            <circle cx={points[0].x} cy={Y(points[0].y)} r={px(5)} />
          </g>
        )}

        {cornerHint?.snapped && (
          <circle className="plan-snap" cx={cornerHint.point.x} cy={Y(cornerHint.point.y)} r={px(7)} vectorEffect="non-scaling-stroke" />
        )}
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

/** Furniture drawn from its library shapes, turned and placed. */
function ItemMark({ item, selected, flagged, px }: { item: Item; selected: boolean; flagged?: boolean; px: (n: number) => number }) {
  const kind = libraryItem(item.type);
  return (
    <g transform={`translate(${item.at.x} ${Y(item.at.y)}) rotate(${-item.rotation})`} data-selected={selected} data-flagged={flagged || undefined}>
      <ShapeList shapes={kind.draw(item.width, item.depth)} />
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
