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
  planBounds,
  pointAlong,
  pointInPolygon,
  polygonArea,
  removeItem,
  roomArea,
  snapToCorner,
  wallLength,
  DEFAULTS,
  type EditResult,
  type Plan,
  type PlanItem,
  type Point,
  type Wall,
} from "@/lib/plan/geometry";

/**
 * The plan on screen (P3-04, P3-05, P3-08): pan and zoom with a mouse,
 * trackpad or fingers, pick things to edit, and draw walls, rooms, doors,
 * windows and columns with typed lengths.
 *
 * The drawing is SVG in millimetres with y pointing up, as in CAD; it is
 * flipped to screen only where points are written out, so text stays upright.
 */

export type Tool = "select" | "wall" | "room" | "door" | "window" | "column";

export interface Layers {
  walls: boolean;
  openings: boolean;
  columns: boolean;
  rooms: boolean;
  dimensions: boolean;
  reference: boolean;
}

export const ALL_LAYERS: Layers = { walls: true, openings: true, columns: true, rooms: true, dimensions: true, reference: true };

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

const HINTS: Record<Tool, string[]> = {
  select: ["Click a wall, room, door or column to edit it. Drag to move around; scroll or pinch to zoom."],
  wall: ["Click where the wall starts.", "Click where it ends, or type its length in mm and press Enter. Esc to stop."],
  room: ["Click the room's first corner.", "Click each corner in turn. Click the first corner or press Enter to finish."],
  door: ["Click a wall to put a door in it."],
  window: ["Click a wall to put a window in it."],
  column: ["Click where the column stands."],
};

const Y = (y: number) => -y;
const pts = (points: Point[]) => points.map((p) => `${p.x},${Y(p.y)}`).join(" ");

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

export function PlanCanvas({
  plan,
  compare,
  layers,
  tool,
  selection,
  onSelect,
  onEdit,
  onToolDone,
  fitSignal,
}: {
  plan: Plan;
  compare?: Plan | null;
  layers: Layers;
  tool: Tool;
  selection: PlanItem | null;
  onSelect: (item: PlanItem | null) => void;
  onEdit: (result: EditResult) => string | null;
  onToolDone: () => void;
  fitSignal: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 0.05 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [free, setFree] = useState(false);
  const [wallStart, setWallStart] = useState<Point | null>(null);
  const [roomPoints, setRoomPoints] = useState<Point[]>([]);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; x: number; y: number; view: View; moved: boolean }
    | { kind: "pinch"; dist: number; mid: { x: number; y: number }; view: View }
    | null
  >(null);

  // Measure the canvas, and keep measuring as the window or panel changes.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the plan to the canvas when asked and once the canvas has a size; not on every edit.
  const fitKey = `${fitSignal}:${size.w > 0 && size.h > 0}`;
  const [fittedKey, setFittedKey] = useState("");
  if (size.w && size.h && fittedKey !== fitKey) {
    setFittedKey(fitKey);
    setView(fitView(plan, size));
  }

  // Leaving a tool drops whatever was half drawn.
  const [lastTool, setLastTool] = useState(tool);
  if (lastTool !== tool) {
    setLastTool(tool);
    setWallStart(null);
    setRoomPoints([]);
    setTyped("");
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

  /** Where a click lands once it is pulled onto a corner or rounded to 10 mm. */
  const snap = (p: Point, extra: Point[] = []): { point: Point; snapped: boolean } => {
    const within = SNAP_PX / view.scale;
    const corner = snapToCorner(plan, p, within) ?? extra.find((q) => distance(p, q) <= within) ?? null;
    if (corner) return { point: corner, snapped: true };
    return { point: { x: roundTo(p.x, 10), y: roundTo(p.y, 10) }, snapped: false };
  };

  /** The end of the wall being drawn: on a corner when one is close, else square to the start. */
  const wallEnd = (raw: Point): { point: Point; snapped: boolean } => {
    if (!wallStart) return snap(raw);
    const corner = snapToCorner(plan, raw, SNAP_PX / view.scale);
    if (corner && !(corner.x === wallStart.x && corner.y === wallStart.y)) return { point: corner, snapped: true };
    const c = constrain(wallStart, raw, free);
    const len = roundTo(distance(wallStart, c), 10);
    const d = distance(wallStart, c) || 1;
    return { point: { x: wallStart.x + ((c.x - wallStart.x) / d) * len, y: wallStart.y + ((c.y - wallStart.y) / d) * len }, snapped: false };
  };

  const pick = (p: Point): PlanItem | null => {
    const within = PICK_PX / view.scale;
    if (layers.openings) {
      for (const o of plan.openings) {
        const wall = plan.walls.find((w) => w.id === o.wallId);
        if (!wall) continue;
        const hit = nearestWall({ ...plan, walls: [wall] }, p, Math.max(wall.thickness / 2, within));
        if (hit && Math.abs(hit.at - o.at) <= o.width / 2) return { kind: "opening", id: o.id };
      }
    }
    if (layers.columns) {
      const c = plan.columns.find((c) => Math.abs(p.x - c.at.x) <= c.width / 2 + within && Math.abs(p.y - c.at.y) <= c.depth / 2 + within);
      if (c) return { kind: "column", id: c.id };
    }
    if (layers.walls) {
      const hit = plan.walls
        .map((w) => ({ w, hit: nearestWall({ ...plan, walls: [w] }, p, Math.max(w.thickness / 2, within)) }))
        .filter((x) => x.hit)
        .sort((a, b) => a.hit!.off - b.hit!.off)[0];
      if (hit) return { kind: "wall", id: hit.w.id };
    }
    if (layers.rooms) {
      const room = plan.rooms
        .filter((r) => pointInPolygon(p, r.points))
        .sort((a, b) => polygonArea(a.points) - polygonArea(b.points))[0];
      if (room) return { kind: "room", id: room.id };
    }
    return null;
  };

  const finishRoom = (points: Point[]) => {
    const result = addRoom(plan, points);
    if (edit(result) && result.ok) {
      setRoomPoints([]);
      onSelect({ kind: "room", id: result.id! });
      onToolDone();
    }
  };

  const click = (raw: Point) => {
    switch (tool) {
      case "select":
        onSelect(pick(raw));
        return;
      case "wall": {
        const { point } = wallEnd(raw);
        if (!wallStart) {
          setWallStart(point);
          return;
        }
        const result = addWall(plan, wallStart, point);
        // Each wall starts where the last one ended, until Esc.
        if (edit(result)) setWallStart(point);
        setTyped("");
        return;
      }
      case "room": {
        const { point } = snap(raw, roomPoints);
        if (roomPoints.length >= 3 && distance(point, roomPoints[0]) <= SNAP_PX / view.scale) {
          finishRoom(roomPoints);
          return;
        }
        setRoomPoints([...roomPoints, point]);
        return;
      }
      case "door":
      case "window": {
        const hit = nearestWall(plan, raw, Math.max(PICK_PX / view.scale, 300));
        if (!hit) {
          setMessage(`Click on a wall to put the ${tool} in it.`);
          return;
        }
        const result = addOpening(plan, hit.wall.id, tool, roundTo(hit.at, 10));
        if (edit(result) && result.ok) onSelect({ kind: "opening", id: result.id! });
        return;
      }
      case "column": {
        const result = addColumn(plan, snap(raw).point);
        if (edit(result) && result.ok) onSelect({ kind: "column", id: result.id! });
        return;
      }
    }
  };

  // ---------------------------------------------------------------- pointer

  const onPointerDown = (e: React.PointerEvent) => {
    boxRef.current?.focus({ preventScroll: true });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view,
      };
      return;
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
    if (g.kind === "pan") {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < CLICK_PX) return;
      g.moved = true;
      setView({ ...g.view, cx: g.view.cx - dx / g.view.scale, cy: g.view.cy + dy / g.view.scale });
    }
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
    if (g?.kind === "pan" && !g.moved && e.button === 0) click(toWorld(e.clientX, e.clientY));
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== boxRef.current) return;
    if (e.key === "Alt") setFree(true);
    if (e.key === "Escape") {
      if (wallStart || roomPoints.length) {
        setWallStart(null);
        setRoomPoints([]);
        setTyped("");
      } else if (tool !== "select") onToolDone();
      else onSelect(null);
      e.preventDefault();
      return;
    }
    if (tool === "wall" && wallStart) {
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
        if (edit(addWall(plan, wallStart, end))) setWallStart(end);
        setTyped("");
        e.preventDefault();
        return;
      }
    }
    if (tool === "room" && e.key === "Enter" && roomPoints.length >= 3) {
      finishRoom(roomPoints);
      e.preventDefault();
      return;
    }
    if (tool === "room" && e.key === "Backspace" && roomPoints.length) {
      setRoomPoints((p) => p.slice(0, -1));
      e.preventDefault();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selection && tool === "select") {
      if (edit(removeItem(plan, selection))) onSelect(null);
      e.preventDefault();
    }
  };

  // ---------------------------------------------------------------- drawing

  const s = view.scale;
  const px = (n: number) => n / s; // screen pixels as millimetres
  const viewBox = size.w
    ? `${view.cx - size.w / 2 / s} ${Y(view.cy) - size.h / 2 / s} ${size.w / s} ${size.h / s}`
    : "0 0 1 1";

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

  const selectedWall = selection?.kind === "wall" ? plan.walls.find((w) => w.id === selection.id) : undefined;
  const hoverWall =
    (tool === "door" || tool === "window") && cursor ? nearestWall(plan, cursor, Math.max(PICK_PX / s, 300)) : null;
  const preview = tool === "wall" && wallStart && cursor ? wallEnd(cursor) : null;
  const previewEnd =
    preview && typed
      ? (() => {
          const towards = constrain(wallStart!, cursor!, free);
          const d = distance(wallStart!, towards) || 1;
          const length = Number.parseFloat(typed) || 0;
          return { x: wallStart!.x + ((towards.x - wallStart!.x) / d) * length, y: wallStart!.y + ((towards.y - wallStart!.y) / d) * length };
        })()
      : preview?.point;
  const cornerHint = cursor && (tool === "wall" || tool === "room") ? (tool === "wall" && wallStart ? preview : snap(cursor, roomPoints)) : null;
  const hint = message ?? HINTS[tool][tool === "wall" ? (wallStart ? 1 : 0) : tool === "room" ? (roomPoints.length ? 1 : 0) : 0];

  return (
    <div
      ref={boxRef}
      className="plan-canvas"
      tabIndex={0}
      role="application"
      aria-label="Floor plan. Use the tools above to draw; arrow keys are not used."
      data-tool={tool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        gesture.current = null;
      }}
      onPointerLeave={() => setCursor(null)}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => e.key === "Alt" && setFree(false)}
      onDoubleClick={() => {
        if (tool === "wall") setWallStart(null);
      }}
    >
      <svg viewBox={viewBox} width={size.w || undefined} height={size.h || undefined} aria-hidden>
        <g className="plan-grid">
          {grid.map((l, i) => (
            <line key={i} x1={l.x1} y1={Y(l.y1)} x2={l.x2} y2={Y(l.y2)} data-major={l.major || undefined} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {layers.reference && (
          <g className="plan-reference">
            {plan.reference.map((l, i) => (
              <line key={i} x1={l.a.x} y1={Y(l.a.y)} x2={l.b.x} y2={Y(l.b.y)} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}

        {layers.rooms && (
          <g className="plan-rooms">
            {plan.rooms.map((r) => (
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

        {layers.walls && (
          <g className="plan-walls">
            {plan.walls.map((w) => (
              <line key={w.id} x1={w.a.x} y1={Y(w.a.y)} x2={w.b.x} y2={Y(w.b.y)} strokeWidth={Math.max(w.thickness, px(1.5))} />
            ))}
          </g>
        )}

        {layers.openings && (
          <g className="plan-openings">
            {plan.openings.map((o) => {
              const wall = plan.walls.find((w) => w.id === o.wallId);
              return wall ? (
                <OpeningMark
                  key={o.id}
                  wall={wall}
                  at={o.at}
                  width={o.width}
                  kind={o.kind}
                  px={px}
                  selected={selection?.kind === "opening" && selection.id === o.id}
                />
              ) : null;
            })}
          </g>
        )}

        {layers.columns && (
          <g className="plan-columns">
            {plan.columns.map((c) => (
              <rect
                key={c.id}
                x={c.at.x - c.width / 2}
                y={Y(c.at.y + c.depth / 2)}
                width={c.width}
                height={c.depth}
                data-selected={selection?.kind === "column" && selection.id === c.id}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}

        {compare && (
          <g className="plan-compare">
            {compare.rooms.map((r) => (
              <polygon key={r.id} points={pts(r.points)} vectorEffect="non-scaling-stroke" />
            ))}
            {compare.walls.map((w) => (
              <line key={w.id} x1={w.a.x} y1={Y(w.a.y)} x2={w.b.x} y2={Y(w.b.y)} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}

        {selectedWall && (
          <g className="plan-selected">
            <line x1={selectedWall.a.x} y1={Y(selectedWall.a.y)} x2={selectedWall.b.x} y2={Y(selectedWall.b.y)} vectorEffect="non-scaling-stroke" />
            <circle cx={selectedWall.a.x} cy={Y(selectedWall.a.y)} r={px(6)} className="plan-end-start" />
            <text x={selectedWall.a.x + px(9)} y={Y(selectedWall.a.y) - px(9)} fontSize={px(11)} className="plan-end-label">
              start
            </text>
            <circle cx={selectedWall.b.x} cy={Y(selectedWall.b.y)} r={px(5)} className="plan-end" />
          </g>
        )}

        {layers.dimensions && (
          <g className="plan-dimensions">
            {plan.walls.map((w) => (
              <WallDimension key={w.id} wall={w} px={px} scale={s} />
            ))}
          </g>
        )}

        {layers.rooms && (
          <g className="plan-room-labels">
            {plan.rooms.map((r) => {
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

        {wallStart && previewEnd && (
          <g className="plan-draft">
            <line x1={wallStart.x} y1={Y(wallStart.y)} x2={previewEnd.x} y2={Y(previewEnd.y)} strokeWidth={DEFAULTS.wallThickness} />
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

        {roomPoints.length > 0 && (
          <g className="plan-draft-room">
            <polyline points={pts(cursor ? [...roomPoints, snap(cursor, roomPoints).point] : roomPoints)} vectorEffect="non-scaling-stroke" />
            {roomPoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={Y(p.y)} r={px(i === 0 ? 6 : 4)} />
            ))}
          </g>
        )}

        {cornerHint?.snapped && (
          <circle className="plan-snap" cx={cornerHint.point.x} cy={Y(cornerHint.point.y)} r={px(7)} vectorEffect="non-scaling-stroke" />
        )}
      </svg>

      <div className={`plan-hint${message ? " plan-hint-error" : ""}`} role={message ? "alert" : "status"}>
        {hint}
        {tool === "wall" && wallStart && typed && <span className="plan-typed">{typed} mm ↵</span>}
      </div>
      <div className="plan-scale" aria-label={`Scale bar, ${scaleBar.label}`}>
        <span style={{ width: scaleBar.px }} />
        {scaleBar.label}
      </div>
    </div>
  );
}

/** A door as a gap with its leaf and swing; a window as a gap with glazing lines. */
function OpeningMark({
  wall,
  at,
  width,
  kind,
  px,
  selected,
}: {
  wall: Wall;
  at: number;
  width: number;
  kind: "door" | "window";
  px: (n: number) => number;
  selected: boolean;
}) {
  const start = pointAlong(wall, at - width / 2);
  const end = pointAlong(wall, at + width / 2);
  const len = wallLength(wall) || 1;
  const ux = (wall.b.x - wall.a.x) / len;
  const uy = (wall.b.y - wall.a.y) / len;
  const nx = -uy;
  const ny = ux;
  const t = wall.thickness / 2;
  const gap = (
    <line x1={start.x} y1={Y(start.y)} x2={end.x} y2={Y(end.y)} strokeWidth={wall.thickness + px(2)} className="plan-gap" />
  );
  if (kind === "window") {
    const off = (d: number) => [
      { x: start.x + nx * d, y: start.y + ny * d },
      { x: end.x + nx * d, y: end.y + ny * d },
    ];
    return (
      <g data-selected={selected} className="plan-window">
        {gap}
        {[-t, 0, t].map((d) => {
          const [p, q] = off(d);
          return <line key={d} x1={p.x} y1={Y(p.y)} x2={q.x} y2={Y(q.y)} vectorEffect="non-scaling-stroke" />;
        })}
      </g>
    );
  }
  // The leaf stands open at right angles from the hinge, and the swing runs back to the far jamb.
  const hinge = { x: start.x + nx * t, y: start.y + ny * t };
  const leafEnd = { x: hinge.x + nx * width, y: hinge.y + ny * width };
  const swing: Point[] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (Math.PI / 2) * (i / 16);
    swing.push({
      x: hinge.x + (nx * Math.cos(a) + ux * Math.sin(a)) * width,
      y: hinge.y + (ny * Math.cos(a) + uy * Math.sin(a)) * width,
    });
  }
  return (
    <g data-selected={selected} className="plan-door">
      {gap}
      <line x1={hinge.x} y1={Y(hinge.y)} x2={leafEnd.x} y2={Y(leafEnd.y)} vectorEffect="non-scaling-stroke" />
      <polyline points={pts(swing)} vectorEffect="non-scaling-stroke" className="plan-swing" />
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
    <text
      x={at.x}
      y={Y(at.y)}
      fontSize={px(10.5)}
      textAnchor="middle"
      dominantBaseline="middle"
      transform={`rotate(${angle} ${at.x} ${Y(at.y)})`}
    >
      {Math.round(len).toLocaleString("en-ZA")}
    </text>
  );
}
