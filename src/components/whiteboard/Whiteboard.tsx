"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowUpRight,
  BringToFront,
  Circle,
  Copy,
  Diamond,
  Eraser,
  Frame as FrameIcon,
  Group,
  Hand,
  Hexagon,
  Highlighter,
  ImagePlus,
  LayoutGrid,
  Lock,
  Maximize,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Redo2,
  SendToBack,
  Square,
  StickyNote,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Ungroup,
  Unlock,
} from "lucide-react";
import { autoSize, WhiteboardScene } from "./WhiteboardScene";
import { bounds, byId, centre, shapePath, facingSide, inside, overlaps, sidePoint, simplify, snapBox, topAt, union, withAttached, type Guide, type Pt, type Rect } from "@/lib/whiteboard/geometry";
import * as ops from "@/lib/whiteboard/ops";
import { FILL_COLORS, INK_COLORS, SHAPES, STICKY_COLORS, WB_LIMIT, type ConnectorEnd, type ShapeKind, type Side, type WbElement } from "@/lib/whiteboard/types";
import "./whiteboard.css";

/**
 * The whiteboard engine: an endless canvas to pan and zoom (wheel, trackpad,
 * pinch, space-drag), with stickies, shapes, text, image cards, connectors
 * that hold on to what they join, pen and highlighter, frames that carry
 * what is in them, and groups. Select by tapping or dragging a box; move with
 * snapping guides; size and turn with handles; type straight onto anything.
 * Copy, paste, duplicate, line up, space out, tidy, layer, lock, undo and redo
 * all work from the keys people know from Miro and FigJam, and from a bar
 * over the selection, so it all works with a finger too.
 */

export type Tool = "select" | "hand" | "sticky" | "shape" | "text" | "connector" | "pen" | "highlighter" | "eraser" | "frame";
interface Camera {
  x: number;
  y: number;
  zoom: number;
}
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Drag =
  | { kind: "pan"; start: Pt; cam: Camera }
  | { kind: "move"; start: Pt; ids: string[]; base: WbElement[]; box: Rect; moved: boolean; alt: boolean }
  | { kind: "resize"; handle: Handle; start: Pt; ids: string[]; base: WbElement[]; box: Rect }
  | { kind: "rotate"; id: string; base: WbElement[]; centre: Pt; startAngle: number; startRotation: number }
  | { kind: "marquee"; start: Pt; now: Pt; additive: boolean; before: string[] }
  | { kind: "create"; tool: "shape" | "frame" | "text" | "sticky"; start: Pt; now: Pt }
  | { kind: "connect"; from: ConnectorEnd; now: Pt; moved: boolean; growFrom?: { id: string; side: Side } }
  | { kind: "end"; connectorId: string; which: "from" | "to"; base: WbElement[]; now: Pt }
  | { kind: "draw"; points: Pt[] }
  | { kind: "erase"; base: WbElement[]; gone: Set<string> };

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 8;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const CLIP_MARK = "fundur-whiteboard:";
let clipboard: WbElement[] = [];

const SHAPE_LABEL: Record<ShapeKind, string> = { rect: "Rectangle", rounded: "Rounded", ellipse: "Ellipse", diamond: "Diamond", triangle: "Triangle", hexagon: "Hexagon", parallelogram: "Slant", star: "Star", cylinder: "Cylinder", speech: "Speech" };
const TOOL_KEYS: Record<string, Tool | ShapeKind> = { v: "select", h: "hand", n: "sticky", s: "sticky", r: "rect", o: "ellipse", t: "text", l: "connector", c: "connector", p: "pen", m: "highlighter", e: "eraser", f: "frame" };

export function Whiteboard({
  elements,
  onChange,
  imageUrl,
  readOnly = false,
  camera: savedCamera,
  onCamera,
  onSelection,
  onAddImage,
  onFiles,
  onOpen,
  selectRequest,
  sideBar,
}: {
  elements: WbElement[];
  /** A finished change: one undo step, saved by the page. */
  onChange: (next: WbElement[]) => void;
  imageUrl: (documentId: string) => string | undefined;
  readOnly?: boolean;
  camera?: Camera | null;
  onCamera?: (camera: Camera) => void;
  onSelection?: (ids: string[]) => void;
  /** The image button: the page picks or uploads one and adds it at this point. */
  onAddImage?: (at: Pt) => void;
  /** Image files pasted or dropped on the board, and where. */
  onFiles?: (files: File[], at: Pt) => void;
  /** Double-click on an image card: the page shows its details. */
  onOpen?: (id: string) => void;
  /** Selects these and brings them into view (e.g. a card picked in a list). */
  selectRequest?: { ids: string[]; signal: number };
  sideBar?: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState<Camera>(() => savedCamera ?? { x: -400, y: -300, zoom: 1 });
  const camRef = useRef(cam);
  useLayoutEffect(() => {
    camRef.current = cam;
  }, [cam]);
  const [tool, setTool] = useState<Tool>("select");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [shapesOpen, setShapesOpen] = useState(false);
  const [picked, setSelected] = useState<string[]>([]);
  // Selected things that were removed (undo, another tab) drop out of the selection.
  const selected = useMemo(() => {
    const ids = new Set(elements.map((e) => e.id));
    return picked.every((id) => ids.has(id)) ? picked : picked.filter((id) => ids.has(id));
  }, [picked, elements]);
  const [preview, setPreview] = useState<WbElement[] | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing, setEditing] = useState<{ id: string; fresh: boolean } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const undoStack = useRef<WbElement[][]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const countHistory = () => setHistory({ undo: undoStack.current.length, redo: redoStack.current.length });
  const redoStack = useRef<WbElement[][]>([]);
  const pointers = useRef(new Map<number, Pt>());
  const pinch = useRef<{ dist: number; mid: Pt; cam: Camera } | null>(null);
  const shown = preview ?? elements;
  const all = useMemo(() => byId(shown), [shown]);
  const elsRef = useRef(elements);
  useLayoutEffect(() => {
    elsRef.current = elements;
  }, [elements]);

  // Remembers where she was looking, a moment after she stops moving.
  const camTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!onCamera) return;
    if (camTimer.current) clearTimeout(camTimer.current);
    camTimer.current = setTimeout(() => onCamera(cam), 700);
    return () => {
      if (camTimer.current) clearTimeout(camTimer.current);
    };
  }, [cam, onCamera]);

  useEffect(() => onSelection?.(selected), [selected, onSelection]);

  useLayoutEffect(() => {
    const node = host.current;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) }));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const commit = useCallback(
    (next: WbElement[]) => {
      if (next === elsRef.current) return;
      if (next.length > WB_LIMIT) return;
      undoStack.current = [...undoStack.current.slice(-99), elsRef.current];
      redoStack.current = [];
      countHistory();
      onChange(next);
    },
    [onChange]
  );
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(elsRef.current);
    countHistory();
    onChange(prev);
  }, [onChange]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(elsRef.current);
    countHistory();
    onChange(next);
  }, [onChange]);

  const toWorld = useCallback((clientX: number, clientY: number): Pt => {
    const r = svg.current!.getBoundingClientRect();
    const c = camRef.current;
    return { x: c.x + (clientX - r.left) / c.zoom, y: c.y + (clientY - r.top) / c.zoom };
  }, []);
  const toScreen = (p: Pt): Pt => ({ x: (p.x - cam.x) * cam.zoom, y: (p.y - cam.y) * cam.zoom });
  const viewCentre = (): Pt => ({ x: cam.x + size.w / 2 / cam.zoom, y: cam.y + size.h / 2 / cam.zoom });

  const zoomAt = useCallback((zoom: number, at: Pt /* screen, relative to the board */) => {
    setCam((c) => {
      const z = clampZoom(zoom);
      const wx = c.x + at.x / c.zoom;
      const wy = c.y + at.y / c.zoom;
      return { x: wx - at.x / z, y: wy - at.y / z, zoom: z };
    });
  }, []);

  /** Brings a box into view, with a margin. */
  const fitTo = useCallback(
    (box: Rect | null, maxZoom = 1.5) => {
      if (!box) {
        setCam({ x: -size.w / 2, y: -size.h / 2, zoom: 1 });
        return;
      }
      const pad = 60;
      const zoom = clampZoom(Math.min(maxZoom, (size.w - pad * 2) / Math.max(box.w, 1), (size.h - pad * 2) / Math.max(box.h, 1)));
      setCam({ x: box.x + box.w / 2 - size.w / 2 / zoom, y: box.y + box.h / 2 - size.h / 2 / zoom, zoom });
    },
    [size]
  );
  const fitAll = useCallback(() => fitTo(union(elsRef.current.map((e) => bounds(e, byId(elsRef.current))))), [fitTo]);

  // The first time there is a size and no remembered view, show everything.
  const fitted = useRef(!!savedCamera);
  useEffect(() => {
    if (fitted.current || size.w < 10) return;
    fitted.current = true;
    fitAll();
  }, [size, fitAll]);

  useEffect(() => {
    if (!selectRequest?.ids.length) return;
    // A request from outside the board (a card picked in a list) selects and shows it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(selectRequest.ids);
    const box = union(elsRef.current.filter((e) => selectRequest.ids.includes(e.id)).map((e) => bounds(e, byId(elsRef.current))));
    if (box) fitTo(box, Math.max(camRef.current.zoom, 0.6));
    // Only a new request moves the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectRequest?.signal]);

  // Wheel: scroll pans, pinch on a trackpad or Ctrl+wheel zooms about the pointer.
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 2.5 : 1));
        zoomAt(camRef.current.zoom * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
        setCam((c) => ({ ...c, x: c.x + dx / c.zoom, y: c.y + dy / c.zoom }));
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const selectedEls = shown.filter((e) => selected.includes(e.id));
  const selBox = union(selectedEls.map((e) => (e.rotation ? { x: e.x, y: e.y, w: e.w, h: e.h } : bounds(e, all))));
  const single = selectedEls.length === 1 ? selectedEls[0] : null;
  const slop = 6 / cam.zoom;

  const pick = (p: Pt) => topAt(shown, p, slop);
  /** A tap selects what it hits, with its group. */
  const selectFor = (el: WbElement, additive: boolean): string[] => {
    const ids = el.groupId ? shown.filter((e) => e.groupId === el.groupId).map((e) => e.id) : [el.id];
    if (!additive) return selected.includes(el.id) ? selected : ids;
    return selected.includes(el.id) ? selected.filter((id) => !ids.includes(id)) : [...selected, ...ids];
  };

  const startTextEdit = (id: string, fresh = false) => {
    if (readOnly) return;
    const el = elsRef.current.find((e) => e.id === id);
    if (!el || el.locked || el.kind === "pen") return;
    setSelected([id]);
    setEditing({ id, fresh });
  };

  // Pointer handling: one state machine for every tool.
  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    host.current?.focus({ preventScroll: true });
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      // Two fingers: pinch to zoom and pan, whatever else was starting.
      const [a, b] = [...pointers.current.values()];
      const r = svg.current!.getBoundingClientRect();
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, cam: camRef.current };
      setPreview(null);
      setGuides([]);
      setDrag(null);
      return;
    }
    if (pointers.current.size > 2) return;
    const p = toWorld(e.clientX, e.clientY);
    const handle = (e.target as Element).closest?.("[data-handle]")?.getAttribute("data-handle");
    if (e.button === 1 || spaceDown || tool === "hand" || (readOnly && e.button === 0)) {
      setDrag({ kind: "pan", start: { x: e.clientX, y: e.clientY }, cam: camRef.current });
      return;
    }
    if (e.button !== 0) return;
    if (handle) {
      if (handle === "rotate" && single) {
        const c = centre(single);
        setDrag({ kind: "rotate", id: single.id, base: elements, centre: c, startAngle: Math.atan2(p.y - c.y, p.x - c.x), startRotation: single.rotation ?? 0 });
        return;
      }
      if (handle.startsWith("dot-") && single) {
        const side = handle.slice(4) as Side;
        setDrag({ kind: "connect", from: { id: single.id, side, ...sidePoint(single, side) }, now: p, moved: false, growFrom: { id: single.id, side } });
        return;
      }
      if (handle.startsWith("end-") && single?.kind === "connector") {
        setDrag({ kind: "end", connectorId: single.id, which: handle === "end-from" ? "from" : "to", base: elements, now: p });
        return;
      }
      if (selBox) {
        setDrag({ kind: "resize", handle: handle as Handle, start: p, ids: withAttached(selected, elements), base: elements, box: selBox });
        return;
      }
    }
    switch (tool) {
      case "select": {
        const hit = pick(p);
        if (!hit) {
          // On a phone, a finger on empty board pans; a mouse draws a selection box.
          if (e.pointerType === "touch") setDrag({ kind: "pan", start: { x: e.clientX, y: e.clientY }, cam: camRef.current });
          else {
            const additive = e.shiftKey || e.metaKey || e.ctrlKey;
            if (!additive) setSelected([]);
            setDrag({ kind: "marquee", start: p, now: p, additive, before: additive ? selected : [] });
          }
          return;
        }
        const ids = selectFor(hit, e.shiftKey || e.metaKey || e.ctrlKey);
        setSelected(ids);
        if (!ids.includes(hit.id) || readOnly) return;
        const moving = withAttached(ids, elements).filter((id) => !elements.find((x) => x.id === id)?.locked);
        if (!moving.length) return;
        setDrag({ kind: "move", start: p, ids: moving, base: elements, box: union(elements.filter((x) => moving.includes(x.id)).map((x) => bounds(x, all)))!, moved: false, alt: e.altKey });
        return;
      }
      case "sticky":
      case "shape":
      case "frame":
      case "text":
        setDrag({ kind: "create", tool, start: p, now: p });
        return;
      case "connector": {
        const hit = pick(p);
        const from: ConnectorEnd = hit && hit.kind !== "connector" && hit.kind !== "pen" ? { id: hit.id, ...p } : { ...p };
        setDrag({ kind: "connect", from, now: p, moved: false });
        return;
      }
      case "pen":
      case "highlighter":
        setDrag({ kind: "draw", points: [p] });
        return;
      case "eraser":
        setDrag({ kind: "erase", base: elements, gone: new Set() });
        eraseAt(p, { kind: "erase", base: elements, gone: new Set() });
        return;
    }
  };

  const eraseAt = (p: Pt, d: Extract<Drag, { kind: "erase" }>) => {
    const hit = topAt(d.base.filter((x) => !d.gone.has(x.id) && (x.kind === "pen" || x.kind === "connector")), p, 10 / cam.zoom);
    if (!hit) return;
    d.gone.add(hit.id);
    setPreview(d.base.filter((x) => !d.gone.has(x.id)));
    setDrag({ ...d });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const r = svg.current!.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const s = pinch.current;
      const zoom = clampZoom(s.cam.zoom * (dist / (s.dist || 1)));
      // The board point under the fingers' first middle stays under their middle now.
      const wx = s.cam.x + s.mid.x / s.cam.zoom;
      const wy = s.cam.y + s.mid.y / s.cam.zoom;
      setCam({ x: wx - mid.x / zoom, y: wy - mid.y / zoom, zoom });
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const p = toWorld(e.clientX, e.clientY);
    switch (d.kind) {
      case "pan": {
        const c = d.cam;
        setCam({ ...c, x: c.x - (e.clientX - d.start.x) / c.zoom, y: c.y - (e.clientY - d.start.y) / c.zoom });
        return;
      }
      case "move": {
        let dx = p.x - d.start.x;
        let dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * cam.zoom < 3) return;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const others = d.base.filter((x) => !d.ids.includes(x.id) && x.kind !== "connector" && x.kind !== "pen").map((x) => bounds(x));
        const near = others.filter((o) => overlaps(o, { x: d.box.x + dx - 2_000 / cam.zoom, y: d.box.y + dy - 2_000 / cam.zoom, w: d.box.w + 4_000 / cam.zoom, h: d.box.h + 4_000 / cam.zoom }));
        const snap = e.altKey || e.metaKey ? { dx: 0, dy: 0, guides: [] } : snapBox({ ...d.box, x: d.box.x + dx, y: d.box.y + dy }, near.slice(0, 400), 6 / cam.zoom);
        dx += snap.dx;
        dy += snap.dy;
        setGuides(snap.guides);
        // Alt-drag leaves the originals and moves copies, as in Figma.
        if (d.alt && !d.moved) {
          const made = ops.duplicate(d.base, d.ids, { x: 0, y: 0 });
          const fresh = made.made;
          const nd: Drag = { ...d, base: made.els, ids: fresh, moved: true };
          setSelected(fresh);
          setDrag(nd);
          setPreview(ops.move(made.els, fresh, dx, dy));
          return;
        }
        if (!d.moved) setDrag({ ...d, moved: true });
        setPreview(ops.move(d.base, d.ids, dx, dy));
        return;
      }
      case "resize": {
        const b = d.box;
        let x0 = b.x;
        let y0 = b.y;
        let x1 = b.x + b.w;
        let y1 = b.y + b.h;
        const h = d.handle;
        if (h.includes("w")) x0 = Math.min(p.x, x1 - 4);
        if (h.includes("e")) x1 = Math.max(p.x, x0 + 4);
        if (h.includes("n")) y0 = Math.min(p.y, y1 - 4);
        if (h.includes("s")) y1 = Math.max(p.y, y0 + 4);
        let to = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        const keep = e.shiftKey || d.base.filter((x) => d.ids.includes(x.id)).some((x) => x.kind === "card" || x.kind === "text");
        if (keep && h.length === 2) {
          const k = Math.max(to.w / b.w, to.h / b.h);
          const w = b.w * k;
          const hh = b.h * k;
          to = { x: h.includes("w") ? b.x + b.w - w : b.x, y: h.includes("n") ? b.y + b.h - hh : b.y, w, h: hh };
        }
        setPreview(ops.resize(d.base, d.ids, b, to));
        return;
      }
      case "rotate": {
        const a = Math.atan2(p.y - d.centre.y, p.x - d.centre.x);
        let deg = d.startRotation + ((a - d.startAngle) * 180) / Math.PI;
        deg = ((deg % 360) + 540) % 360 - 180;
        const near = Math.round(deg / 15) * 15;
        if (e.shiftKey || Math.abs(near - deg) < 3) deg = near;
        setPreview(ops.update(d.base, [d.id], { rotation: Math.round(deg * 10) / 10 || undefined }));
        return;
      }
      case "marquee": {
        const nd = { ...d, now: p };
        setDrag(nd);
        const box = rectOf(d.start, p);
        const hit = elements.filter((x) => !x.locked && (inside(bounds(x, all), box) || (x.kind !== "frame" && box.w * cam.zoom > 4 && overlaps(bounds(x, all), box) && e.altKey)));
        const ids = hit.flatMap((x) => (x.groupId ? elements.filter((g) => g.groupId === x.groupId).map((g) => g.id) : [x.id]));
        setSelected([...new Set([...d.before, ...ids])]);
        return;
      }
      case "create":
        setDrag({ ...d, now: p });
        return;
      case "connect":
        setDrag({ ...d, now: p, moved: d.moved || Math.hypot(p.x - d.from.x, p.y - d.from.y) * cam.zoom > 6 });
        return;
      case "end":
        setDrag({ ...d, now: p });
        return;
      case "draw": {
        const last = d.points[d.points.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) * cam.zoom < 1.5) return;
        d.points.push(p);
        setDrag({ ...d });
        return;
      }
      case "erase":
        eraseAt(p, d);
        return;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    const d = dragRef.current;
    setDrag(null);
    setGuides([]);
    if (!d) return;
    const p = toWorld(e.clientX, e.clientY);
    const z = ops.topZ(elements);
    switch (d.kind) {
      case "move":
      case "resize":
      case "rotate":
        if (preview && (d.kind !== "move" || d.moved)) commit(preview);
        setPreview(null);
        return;
      case "erase":
        if (d.gone.size) commit(ops.remove(d.base, [...d.gone]));
        setPreview(null);
        return;
      case "create": {
        const box = rectOf(d.start, p);
        const dragged = box.w * cam.zoom > 8 || box.h * cam.zoom > 8;
        let made: WbElement;
        if (d.tool === "sticky") made = ops.sticky(dragged ? centre(box) : p, z, dragged ? { x: box.x, y: box.y, w: Math.max(80, box.w), h: Math.max(80, box.h) } : {});
        else if (d.tool === "shape") made = ops.shape(shapeKind, dragged ? box : { x: p.x - 80, y: p.y - (shapeKind === "rect" || shapeKind === "rounded" ? 50 : 80), w: 160, h: shapeKind === "rect" || shapeKind === "rounded" ? 100 : 160 }, z);
        else if (d.tool === "frame") made = ops.frame(dragged ? box : { x: p.x - 400, y: p.y - 250, w: 800, h: 500 }, Math.min(0, ...elements.map((x) => x.z)) - 1, { title: `Frame ${elements.filter((x) => x.kind === "frame").length + 1}` });
        else made = ops.text(p, z, dragged ? { w: Math.max(60, box.w) } : {});
        commit([...elements, made]);
        setSelected([made.id]);
        setTool("select");
        if (made.kind !== "frame") setEditing({ id: made.id, fresh: true });
        return;
      }
      case "connect": {
        if (!d.moved) {
          // A tap on a side dot makes a joined copy there, as Miro's "+" does.
          if (d.growFrom) {
            const grown = ops.growFrom(elements, d.growFrom.id, d.growFrom.side);
            if (grown) {
              commit(grown.els);
              setSelected([grown.made]);
              setEditing({ id: grown.made, fresh: true });
            }
          }
          return;
        }
        const hit = topAt(elements.filter((x) => x.kind !== "connector" && x.kind !== "pen" && x.id !== d.from.id), p, slop);
        const to: ConnectorEnd = hit ? { id: hit.id, side: facingSide(hit, d.from), ...p } : { ...p };
        const made = ops.connector(d.from, to, z, d.growFrom || hit ? {} : { route: "straight" });
        commit(ops.syncConnectors([...elements, made]));
        setSelected([made.id]);
        setTool("select");
        return;
      }
      case "end": {
        const c = d.base.find((x) => x.id === d.connectorId);
        if (!c || c.kind !== "connector") return;
        const other = d.which === "from" ? c.to : c.from;
        const hit = topAt(d.base.filter((x) => x.kind !== "connector" && x.kind !== "pen" && x.id !== other.id), p, slop);
        const end: ConnectorEnd = hit ? { id: hit.id, side: facingSide(hit, p), ...p } : { ...p };
        commit(ops.update(d.base, [c.id], { [d.which]: end }));
        return;
      }
      case "draw": {
        const pts = simplify(d.points, 0.6 / cam.zoom);
        if (pts.length >= 1) {
          const made = ops.pen(pts.length === 1 ? [pts[0], { x: pts[0].x + 0.5, y: pts[0].y }] : pts, z, tool === "highlighter" ? { highlight: true, stroke: "#f4d03f", strokeWidth: 6 } : { stroke: penColour, strokeWidth: penWidth });
          commit([...elements, made]);
        }
        return;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    const p = toWorld(e.clientX, e.clientY);
    const hit = pick(p);
    if (hit?.kind === "card" && onOpen) return onOpen(hit.id);
    if (hit) return startTextEdit(hit.id);
    // Double-click on empty board: a sticky, as in FigJam.
    const made = ops.sticky(p, ops.topZ(elements));
    commit([...elements, made]);
    setSelected([made.id]);
    setEditing({ id: made.id, fresh: true });
  };

  const [penColour, setPenColour] = useState<string>(INK_COLORS[0]);
  const [penWidth, setPenWidth] = useState(3);

  // Keys, as in Miro and FigJam.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (!ours(e.target, node)) return;
      const k = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      const els = elsRef.current;
      if (k === " ") {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && k === "a") {
        e.preventDefault();
        setSelected(els.filter((x) => !x.locked).map((x) => x.id));
        return;
      }
      if ((k === "+" || k === "=") && !mod) return zoomAt(camRef.current.zoom * 1.2, { x: size.w / 2, y: size.h / 2 });
      if (k === "-" && !mod) return zoomAt(camRef.current.zoom / 1.2, { x: size.w / 2, y: size.h / 2 });
      if (e.shiftKey && (k === "1" || k === "!")) return fitAll();
      if (e.shiftKey && (k === "0" || k === ")")) return zoomAt(1, { x: size.w / 2, y: size.h / 2 });
      if (e.shiftKey && (k === "2" || k === "@") && selected.length) return fitTo(union(els.filter((x) => selected.includes(x.id)).map((x) => bounds(x, byId(els)))));
      if (k === "escape") {
        setSelected([]);
        setTool("select");
        return;
      }
      if (readOnly) return;
      if ((k === "delete" || k === "backspace") && selected.length) {
        e.preventDefault();
        commit(ops.remove(els, selected));
        setSelected([]);
        return;
      }
      if (mod && k === "d" && selected.length) {
        e.preventDefault();
        const r = ops.duplicate(els, selected);
        commit(r.els);
        setSelected(r.made);
        return;
      }
      if (mod && k === "g") {
        e.preventDefault();
        commit(e.shiftKey ? ops.ungroup(els, selected) : ops.group(els, selected));
        return;
      }
      if (mod && e.shiftKey && k === "l") {
        e.preventDefault();
        const locked = els.filter((x) => selected.includes(x.id)).every((x) => x.locked);
        commit(ops.update(els, selected, { locked: locked ? undefined : true }));
        return;
      }
      if ((k === "]" || k === "[") && selected.length) {
        e.preventDefault();
        commit(ops.reorder(els, selected, k === "]" ? (mod ? "front" : "forward") : mod ? "back" : "backward"));
        return;
      }
      if (k.startsWith("arrow") && selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0;
        const dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
        commit(ops.move(els, withAttached(selected, els), dx, dy));
        return;
      }
      if (k === "enter" && selected.length === 1) {
        e.preventDefault();
        startTextEdit(selected[0]);
        return;
      }
      if (!mod && !e.altKey && TOOL_KEYS[k]) {
        const t = TOOL_KEYS[k];
        if ((SHAPES as readonly string[]).includes(t)) {
          setShapeKind(t as ShapeKind);
          setTool("shape");
        } else setTool(t as Tool);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceDown(false);
    };
    // The board takes keys when it has focus, or when nothing else on the page does.
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKeyUp);
    };
  });

  // Copy, cut and paste: elements between boards and tabs, and text or images from anywhere.
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const els = () => elsRef.current;
    const onCopy = (e: ClipboardEvent) => {
      if (!ours(e.target, node) || !selected.length) return;
      const picked = els().filter((x) => withAttached(selected, els()).includes(x.id));
      clipboard = picked;
      e.clipboardData?.setData("text/plain", CLIP_MARK + JSON.stringify(picked));
      e.preventDefault();
    };
    const onCut = (e: ClipboardEvent) => {
      onCopy(e);
      if (readOnly || !selected.length || !ours(e.target, node)) return;
      commit(ops.remove(els(), selected));
      setSelected([]);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (readOnly || !ours(e.target, node)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      const at = viewCentre();
      if (files.length && onFiles) {
        e.preventDefault();
        onFiles(files, at);
        return;
      }
      const raw = e.clipboardData?.getData("text/plain") ?? "";
      let source: WbElement[] = [];
      if (raw.startsWith(CLIP_MARK)) {
        try {
          source = JSON.parse(raw.slice(CLIP_MARK.length)) as WbElement[];
        } catch {
          source = [];
        }
      } else if (!raw && clipboard.length) source = clipboard;
      e.preventDefault();
      if (source.length) {
        const box = union(source.map((x) => bounds(x)))!;
        const sameSpot = els().some((x) => source.some((s) => s.id === x.id));
        const offset = sameSpot ? { x: 24, y: 24 } : { x: at.x - (box.x + box.w / 2), y: at.y - (box.y + box.h / 2) };
        const made = ops.copies(els(), source, offset);
        commit(ops.syncConnectors([...els(), ...made]));
        setSelected(made.map((x) => x.id));
        return;
      }
      if (raw.trim()) {
        // Lines of text become a row of stickies, as pasting a list does in Miro.
        const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 60);
        const z = ops.topZ(els());
        const made = lines.length > 1 ? lines.map((l, i) => ops.sticky({ x: at.x + (i % 6) * 220 - 550, y: at.y + Math.floor(i / 6) * 220 }, z + i, { text: l.slice(0, 4_000) })) : [ops.text({ x: at.x - 130, y: at.y - 20 }, z, { text: raw.slice(0, 10_000), h: Math.max(40, raw.split("\n").length * 32) })];
        commit([...els(), ...made]);
        setSelected(made.map((x) => x.id));
      }
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  });

  const act = (next: WbElement[]) => commit(next);
  const selKinds = new Set(selectedEls.map((e) => e.kind));
  const allLocked = selectedEls.length > 0 && selectedEls.every((e) => e.locked);
  const grouped = selectedEls.length > 1 && selectedEls.every((e) => e.groupId && e.groupId === selectedEls[0].groupId);

  // What a drag is drawing right now.
  const draft = drag?.kind === "create" ? rectOf(drag.start, drag.now) : null;
  const marquee = drag?.kind === "marquee" ? rectOf(drag.start, drag.now) : null;
  const drawing = drag?.kind === "draw" ? drag.points : null;
  const linking = drag?.kind === "connect" && drag.moved ? drag : null;
  const endDrag = drag?.kind === "end" ? drag : null;
  const linkTarget = linking || endDrag ? topAt(shown.filter((x) => x.kind !== "connector" && x.kind !== "pen"), (linking ?? endDrag)!.now, slop) : null;

  const editingEl = editing ? shown.find((x) => x.id === editing.id) : null;
  const cursor = spaceDown || tool === "hand" || drag?.kind === "pan" ? (drag?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : tool === "text" ? "text" : "crosshair";

  return (
    <div className="wb" ref={host} tabIndex={0} aria-label="Whiteboard" data-tool={tool} onDragOver={(e) => onFiles && e.preventDefault()} onDrop={(e) => {
      if (!onFiles) return;
      e.preventDefault();
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) onFiles(files, toWorld(e.clientX, e.clientY));
    }}>
      <svg
        ref={svg}
        className="wb-canvas"
        style={{ cursor, backgroundSize: `${24 * cam.zoom}px ${24 * cam.zoom}px`, backgroundPosition: `${-cam.x * cam.zoom}px ${-cam.y * cam.zoom}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`scale(${cam.zoom}) translate(${-cam.x} ${-cam.y})`}>
          <WhiteboardScene elements={shown} imageUrl={imageUrl} editing={editing?.id} />
          {guides.map((g, i) => (g.axis === "x" ? <line key={i} x1={g.at} x2={g.at} y1={g.from} y2={g.to} className="wb-guide" strokeWidth={1 / cam.zoom} /> : <line key={i} y1={g.at} y2={g.at} x1={g.from} x2={g.to} className="wb-guide" strokeWidth={1 / cam.zoom} />))}
          {draft && drag?.kind === "create" && <rect {...draft2(draft)} className="wb-draft" strokeWidth={1.5 / cam.zoom} rx={drag.tool === "sticky" ? 0 : 2} />}
          {marquee && <rect {...draft2(marquee)} className="wb-marquee" strokeWidth={1 / cam.zoom} />}
          {drawing && <polyline points={drawing.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={tool === "highlighter" ? "#f4d03f" : penColour} strokeOpacity={tool === "highlighter" ? 0.35 : 1} strokeWidth={tool === "highlighter" ? 24 : penWidth} strokeLinecap="round" strokeLinejoin="round" />}
          {linkTarget && <rect {...draft2(bounds(linkTarget))} className="wb-link-target" strokeWidth={2 / cam.zoom} />}
          {linking && <line x1={linking.from.id ? sidePoint(all.get(linking.from.id)!, linking.from.side ?? facingSide(all.get(linking.from.id)!, linking.now)).x : linking.from.x} y1={linking.from.id ? sidePoint(all.get(linking.from.id)!, linking.from.side ?? facingSide(all.get(linking.from.id)!, linking.now)).y : linking.from.y} x2={linking.now.x} y2={linking.now.y} className="wb-link-draft" strokeWidth={2 / cam.zoom} />}
          {!editing && !readOnly && (
            <Selection els={selectedEls} box={selBox} zoom={cam.zoom} single={single} all={all} hideHandles={!!drag && drag.kind !== "resize" && drag.kind !== "rotate"} />
          )}
          {readOnly && selBox && <rect {...draft2(selBox)} className="wb-selection" strokeWidth={1.5 / cam.zoom} />}
        </g>
      </svg>

      {editingEl && (
        <TextEditor
          key={editingEl.id}
          el={editingEl}
          cam={cam}
          toScreen={toScreen}
          onDone={(value, height) => {
            const fresh = editing?.fresh;
            setEditing(null);
            host.current?.focus({ preventScroll: true });
            const current = elsRef.current.find((x) => x.id === editingEl.id);
            if (!current) return;
            if (current.kind === "text" && !value.trim()) {
              // An empty text box is not kept.
              if (fresh) onChange(elsRef.current.filter((x) => x.id !== current.id));
              else commit(ops.remove(elsRef.current, [current.id]));
              return;
            }
            const patch: Partial<WbElement> =
              current.kind === "frame" ? { title: value.slice(0, 200) } : current.kind === "connector" ? { label: value.slice(0, 500) || undefined } : current.kind === "card" ? { title: value.slice(0, 200) } : ({ text: value.slice(0, 10_000) } as Partial<WbElement>);
            if (current.kind === "text" && height) Object.assign(patch, { h: Math.max(20, Math.ceil(height)) });
            const next = ops.update(elsRef.current, [current.id], patch);
            if (fresh) {
              // The new element and its words are one step.
              onChange(next);
            } else commit(next);
          }}
        />
      )}

      {!readOnly && (
        <Toolbar
          tool={tool}
          setTool={(t) => {
            setTool(t);
            setShapesOpen(false);
          }}
          shapeKind={shapeKind}
          shapesOpen={shapesOpen}
          setShapesOpen={setShapesOpen}
          setShapeKind={(s) => {
            setShapeKind(s);
            setTool("shape");
            setShapesOpen(false);
          }}
          onImage={onAddImage ? () => onAddImage(viewCentre()) : undefined}
          undo={undo}
          redo={redo}
          canUndo={history.undo > 0}
          canRedo={history.redo > 0}
          penColour={penColour}
          setPenColour={setPenColour}
          penWidth={penWidth}
          setPenWidth={setPenWidth}
        />
      )}

      {!readOnly && selBox && !drag && !editing && selectedEls.length > 0 && (
        <ContextBar
          at={toScreen({ x: selBox.x + selBox.w / 2, y: selBox.y })}
          below={toScreen({ x: 0, y: selBox.y + selBox.h }).y}
          height={size.h}
          els={selectedEls}
          kinds={selKinds}
          locked={allLocked}
          grouped={grouped}
          onPatch={(patch) => act(ops.update(elements, selected, patch))}
          onDelete={() => {
            act(ops.remove(elements, selected));
            setSelected([]);
          }}
          onDuplicate={() => {
            const r = ops.duplicate(elements, selected);
            act(r.els);
            setSelected(r.made);
          }}
          onOrder={(to) => act(ops.reorder(elements, selected, to))}
          onAlign={(how) => act(ops.align(elements, selected, how))}
          onDistribute={(axis) => act(ops.distribute(elements, selected, axis))}
          onTidy={() => act(ops.tidy(elements, selected))}
          onGroup={() => act(grouped ? ops.ungroup(elements, selected) : ops.group(elements, selected))}
          onLock={() => act(ops.update(elements, selected, { locked: allLocked ? undefined : true }))}
          onEdit={single && single.kind !== "pen" ? () => startTextEdit(single.id) : undefined}
          onOpen={single?.kind === "card" && onOpen ? () => onOpen(single.id) : undefined}
        />
      )}

      <div className="wb-zoom" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomAt(cam.zoom / 1.25, { x: size.w / 2, y: size.h / 2 })} aria-label="Zoom out"><Minus size={15} /></button>
        <button type="button" className="wb-zoom-value" onClick={() => zoomAt(1, { x: size.w / 2, y: size.h / 2 })} title="Zoom to 100% (Shift+0)">{Math.round(cam.zoom * 100)}%</button>
        <button type="button" onClick={() => zoomAt(cam.zoom * 1.25, { x: size.w / 2, y: size.h / 2 })} aria-label="Zoom in"><Plus size={15} /></button>
        <button type="button" onClick={fitAll} aria-label="Fit everything" title="Fit everything (Shift+1)"><Maximize size={15} /></button>
      </div>
      {elements.length === 0 && !readOnly && (
        <div className="wb-empty">
          <StickyNote size={22} />
          <p>Double-click anywhere for a sticky, or pick a tool. Paste text for a row of stickies, or drop images straight in.</p>
        </div>
      )}
      {sideBar}
    </div>
  );
}

/** Whether a key or clipboard event is for the board: it has focus, or nothing else does. */
function ours(target: EventTarget | null, board: HTMLElement): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("input, textarea, select, [contenteditable]")) return false;
  return target === document.body || target === document.documentElement || board.contains(target);
}

const rectOf = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
const draft2 = (r: Rect) => ({ x: r.x, y: r.y, width: Math.max(r.w, 0.1), height: Math.max(r.h, 0.1) });

/** The selection's frame, its size and turn handles, the dots to join from, and a connector's ends. */
function Selection({ els, box, zoom, single, all, hideHandles }: { els: WbElement[]; box: Rect | null; zoom: number; single: WbElement | null; all: Map<string, WbElement>; hideHandles: boolean }) {
  if (!box || !els.length) return null;
  const s = 1 / zoom;
  if (single?.kind === "connector") {
    const from = single.from.id && all.get(single.from.id) ? null : single.from;
    void from;
    return (
      <g>
        {(["from", "to"] as const).map((which) => {
          const end = single[which];
          return <circle key={which} data-handle={`end-${which}`} cx={end.x} cy={end.y} r={7 * s} className="wb-end" strokeWidth={2 * s} />;
        })}
      </g>
    );
  }
  const turned = single?.rotation ? `rotate(${single.rotation} ${single.x + single.w / 2} ${single.y + single.h / 2})` : undefined;
  const handles: [Handle, number, number][] = [
    ["nw", box.x, box.y],
    ["n", box.x + box.w / 2, box.y],
    ["ne", box.x + box.w, box.y],
    ["e", box.x + box.w, box.y + box.h / 2],
    ["se", box.x + box.w, box.y + box.h],
    ["s", box.x + box.w / 2, box.y + box.h],
    ["sw", box.x, box.y + box.h],
    ["w", box.x, box.y + box.h / 2],
  ];
  const locked = els.every((e) => e.locked);
  const canJoin = single && single.kind !== "pen" && single.kind !== "frame" && !single.rotation;
  const small = box.w * zoom < 40 || box.h * zoom < 40;
  return (
    <g transform={turned}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} className="wb-selection" strokeWidth={1.5 * s} />
      {els.length > 1 && els.map((e) => <rect key={e.id} {...draft2(bounds(e, all))} className="wb-selection-each" strokeWidth={1 * s} />)}
      {!hideHandles && !locked && (
        <>
          {handles
            .filter(([h]) => !small || h.length === 2)
            .filter(([h]) => !(single?.kind === "text" && (h === "n" || h === "s")))
            .map(([h, x, y]) => (
              <rect key={h} data-handle={h} x={x - 5 * s} y={y - 5 * s} width={10 * s} height={10 * s} rx={2 * s} className={`wb-handle wb-handle-${h}`} strokeWidth={1.5 * s} />
            ))}
          {single && single.kind !== "card" && (
            // Turn from just outside the top-right corner, clear of the dots to join from.
            <g data-handle="rotate">
              <circle cx={box.x + box.w + 18 * s} cy={box.y - 18 * s} r={12 * s} className="wb-dot-hit" />
              <path d={`M${box.x + box.w + 11 * s},${box.y - 14 * s} A${8 * s},${8 * s} 0 1,1 ${box.x + box.w + 22 * s},${box.y - 11 * s}`} className="wb-rotate-stem" fill="none" strokeWidth={1.8 * s} strokeLinecap="round" />
            </g>
          )}
          {canJoin &&
            (["top", "right", "bottom", "left"] as const).map((side) => {
              const p = sidePoint(box, side);
              const out = 22 * s;
              const q = { x: p.x + (side === "right" ? out : side === "left" ? -out : 0), y: p.y + (side === "bottom" ? out : side === "top" ? -out : 0) };
              return (
                <g key={side} data-handle={`dot-${side}`} className="wb-dot">
                  <circle cx={q.x} cy={q.y} r={11 * s} className="wb-dot-hit" />
                  <circle cx={q.x} cy={q.y} r={6 * s} className="wb-dot-mark" strokeWidth={1.5 * s} />
                </g>
              );
            })}
        </>
      )}
    </g>
  );
}

/** Types straight onto the element, at its size on screen. */
function TextEditor({ el, cam, toScreen, onDone }: { el: WbElement; cam: Camera; toScreen: (p: Pt) => Pt; onDone: (value: string, height?: number) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const initial = el.kind === "frame" ? el.title : el.kind === "connector" ? (el.label ?? "") : el.kind === "card" ? el.title : "text" in el ? el.text : "";
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    const h = ref.current && el.kind === "text" ? ref.current.scrollHeight / cam.zoom : undefined;
    onDone(value, h);
  };
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus();
    t.select();
  }, []);
  let box: Rect;
  let size = 16;
  let align: "left" | "center" | "right" = "center";
  if (el.kind === "connector") {
    const mid = { x: (el.from.x + el.to.x) / 2, y: (el.from.y + el.to.y) / 2 };
    box = { x: mid.x - 90, y: mid.y - 16, w: 180, h: 32 };
    size = 14;
  } else if (el.kind === "frame") {
    box = { x: el.x, y: el.y - 34, w: Math.max(el.w, 160), h: 28 };
    size = 15;
    align = "left";
  } else {
    box = { x: el.x, y: el.y, w: el.w, h: el.h };
    if (el.kind === "text") {
      size = el.fontSize;
      align = el.align;
    } else if (el.kind === "sticky") size = el.fontSize ?? autoSize(value, el.w, el.h);
    else if (el.kind === "shape") size = el.fontSize ?? autoSize(value, el.w * 0.8, el.h * 0.7);
    else if (el.kind === "card") {
      box = { x: el.x, y: el.y + el.h - 44, w: el.w, h: 44 };
      align = "left";
    }
  }
  const tl = toScreen(box);
  const centred = el.kind === "sticky" || el.kind === "shape";
  return (
    <textarea
      ref={ref}
      className="wb-text-editor"
      data-kind={el.kind}
      value={value}
      maxLength={el.kind === "frame" || el.kind === "card" ? 200 : 10_000}
      aria-label="Text"
      onChange={(e) => {
        setValue(e.target.value);
        if (el.kind === "text" && ref.current) {
          ref.current.style.height = "auto";
          ref.current.style.height = `${ref.current.scrollHeight}px`;
        }
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey)) || (e.key === "Enter" && !e.shiftKey && (el.kind === "frame" || el.kind === "connector" || el.kind === "card"))) {
          e.preventDefault();
          finish();
        }
      }}
      style={{
        left: tl.x,
        top: tl.y,
        width: box.w * cam.zoom,
        height: el.kind === "text" ? undefined : box.h * cam.zoom,
        minHeight: el.kind === "text" ? box.h * cam.zoom : undefined,
        fontSize: size * cam.zoom,
        textAlign: align,
        padding: el.kind === "sticky" ? 16 * cam.zoom : el.kind === "shape" ? Math.min(el.w, el.h) * 0.12 * cam.zoom : 0,
        paddingTop: centred ? Math.max(0, (box.h * cam.zoom) / 2 - size * cam.zoom * 0.75 * Math.max(1, value.split("\n").length)) : undefined,
        fontWeight: el.kind === "text" && el.bold ? 650 : undefined,
        color: el.kind === "text" ? el.color : undefined,
        background: el.kind === "sticky" ? el.color : undefined,
      }}
    />
  );
}

function Toolbar({
  tool,
  setTool,
  shapeKind,
  shapesOpen,
  setShapesOpen,
  setShapeKind,
  onImage,
  undo,
  redo,
  canUndo,
  canRedo,
  penColour,
  setPenColour,
  penWidth,
  setPenWidth,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  shapeKind: ShapeKind;
  shapesOpen: boolean;
  setShapesOpen: (open: boolean) => void;
  setShapeKind: (s: ShapeKind) => void;
  onImage?: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  penColour: string;
  setPenColour: (c: string) => void;
  penWidth: number;
  setPenWidth: (w: number) => void;
}) {
  const btn = (t: Tool, label: string, key: string, icon: React.ReactNode) => (
    <button type="button" aria-pressed={tool === t} onClick={() => setTool(t)} title={`${label} (${key})`} aria-label={label}>
      {icon}
    </button>
  );
  return (
    <>
    <div className="wb-tools" role="toolbar" aria-label="Tools">
      {btn("select", "Select", "V", <MousePointer2 size={18} />)}
      {btn("hand", "Hand", "H or hold space", <Hand size={18} />)}
      <span className="wb-tools-gap" />
      {btn("sticky", "Sticky note", "N", <StickyNote size={18} />)}
      <div className="wb-tools-more">
        <button type="button" aria-pressed={tool === "shape"} onClick={() => (tool === "shape" ? setShapesOpen(!shapesOpen) : (setTool("shape"), setShapesOpen(true)))} title="Shapes (R, O)" aria-label="Shapes" aria-expanded={shapesOpen}>
          <ShapeIcon kind={shapeKind} />
        </button>
      </div>
      {btn("text", "Text", "T", <Type size={18} />)}
      {btn("connector", "Connector", "L", <ArrowUpRight size={18} />)}
      {btn("pen", "Pen", "P", <PenLine size={18} />)}
      {btn("highlighter", "Highlighter", "M", <Highlighter size={18} />)}
      {btn("eraser", "Eraser", "E", <Eraser size={18} />)}
      {btn("frame", "Frame", "F", <FrameIcon size={18} />)}
      {onImage && (
        <button type="button" onClick={onImage} title="Image" aria-label="Add an image">
          <ImagePlus size={18} />
        </button>
      )}
      <span className="wb-tools-gap" />
      <button type="button" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={18} /></button>
      <button type="button" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 size={18} /></button>
    </div>
      {shapesOpen && (
        <div className="wb-flyout wb-tool-flyout" role="group" aria-label="Shapes">
          {SHAPES.map((s) => (
            <button key={s} type="button" aria-pressed={shapeKind === s} onClick={() => setShapeKind(s)} title={SHAPE_LABEL[s]}>
              <ShapeIcon kind={s} />
            </button>
          ))}
        </div>
      )}
      {tool === "pen" && (
        <div className="wb-flyout wb-tool-flyout" role="group" aria-label="Pen">
          {INK_COLORS.slice(0, 7).map((c) => (
            <button key={c} type="button" className="wb-swatch" style={{ background: c }} aria-pressed={penColour === c} aria-label={`Ink ${c}`} onClick={() => setPenColour(c)} />
          ))}
          {[2, 4, 8].map((w) => (
            <button key={w} type="button" aria-pressed={penWidth === w} onClick={() => setPenWidth(w)} aria-label={`Width ${w}`}>
              <span className="wb-width" style={{ height: w + 1 }} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function ShapeIcon({ kind }: { kind: ShapeKind }) {
  if (kind === "ellipse") return <Circle size={18} />;
  if (kind === "diamond") return <Diamond size={18} />;
  if (kind === "triangle") return <Triangle size={18} />;
  if (kind === "hexagon") return <Hexagon size={18} />;
  if (kind === "rect") return <Square size={18} />;
  return (
    <svg width={18} height={18} viewBox="-2 -2 28 28" aria-hidden>
      <path d={shapePathIcon(kind)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
const shapePathIcon = (kind: ShapeKind) => shapePath(kind, 24, 24);

/** The bar over a selection: colours, type, ends, layers, alignment, grouping, lock and delete. */
function ContextBar({
  at,
  below,
  height,
  els,
  kinds,
  locked,
  grouped,
  onPatch,
  onDelete,
  onDuplicate,
  onOrder,
  onAlign,
  onDistribute,
  onTidy,
  onGroup,
  onLock,
  onEdit,
  onOpen,
}: {
  at: Pt;
  below: number;
  height: number;
  els: WbElement[];
  kinds: Set<string>;
  locked: boolean;
  grouped: boolean;
  onPatch: (patch: Partial<WbElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onOrder: (to: "front" | "back") => void;
  onAlign: (how: ops.AlignHow) => void;
  onDistribute: (axis: "x" | "y") => void;
  onTidy: () => void;
  onGroup: () => void;
  onLock: () => void;
  onEdit?: () => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState<"colour" | "stroke" | "align" | null>(null);
  const only = kinds.size === 1 ? [...kinds][0] : null;
  const first = els[0];
  // Above the selection, or under it when there is no room.
  const top = at.y - 64 < 8 ? Math.min(below + 16, height - 60) : at.y - 64;
  const colours = only === "sticky" ? STICKY_COLORS : only === "text" || only === "connector" || only === "pen" ? INK_COLORS : FILL_COLORS;
  const colourOf = (e: WbElement) => (e.kind === "sticky" || e.kind === "card" ? e.color : e.kind === "shape" ? e.fill : e.kind === "text" ? e.color : e.kind === "connector" || e.kind === "pen" ? e.stroke : e.kind === "frame" ? e.fill : "#ffffff");
  const setColour = (c: string) => {
    if (only === "sticky" || only === "card" || only === "text") onPatch({ color: c } as Partial<WbElement>);
    else if (only === "shape" || only === "frame") onPatch({ fill: c } as Partial<WbElement>);
    else if (only === "connector" || only === "pen") onPatch({ stroke: c } as Partial<WbElement>);
  };
  if (locked)
    return (
      <div className="wb-context" style={{ left: at.x, top }} role="toolbar" aria-label="Selection">
        <button type="button" onClick={onLock} title="Unlock (Ctrl+Shift+L)"><Unlock size={16} /> <span>Unlock</span></button>
      </div>
    );
  const sizes = only === "text" ? [16, 24, 36, 64, 120] : only === "sticky" || only === "shape" ? [0, 14, 20, 32, 48] : null;
  const currentSize = first && "fontSize" in first ? (first.fontSize ?? 0) : 0;
  return (
    <div className="wb-context" style={{ left: at.x, top }} role="toolbar" aria-label="Selection" onPointerDown={(e) => e.stopPropagation()}>
      {only && only !== "card" && (
        <div className="wb-context-more">
          <button type="button" onClick={() => setOpen(open === "colour" ? null : "colour")} aria-expanded={open === "colour"} title="Colour" aria-label="Colour">
            <span className="wb-swatch" style={{ background: colourOf(first) === "none" ? "transparent" : colourOf(first) }} />
          </button>
          {open === "colour" && (
            <div className="wb-flyout wb-colours">
              {colours.map((c) => (
                <button key={c} type="button" className="wb-swatch" style={{ background: c }} aria-label={c} onClick={() => setColour(c)} />
              ))}
              {only === "shape" && <button type="button" className="wb-swatch wb-swatch-none" aria-label="No fill" onClick={() => onPatch({ fill: "none" } as Partial<WbElement>)} />}
              <label className="wb-swatch wb-swatch-custom" title="Any colour">
                <input type="color" value={colourOf(first).startsWith("#") ? colourOf(first) : "#ffffff"} onChange={(e) => setColour(e.target.value)} />
              </label>
            </div>
          )}
        </div>
      )}
      {only === "shape" && (
        <div className="wb-context-more">
          <button type="button" onClick={() => setOpen(open === "stroke" ? null : "stroke")} aria-expanded={open === "stroke"} title="Outline and shape" aria-label="Outline and shape">
            <ShapeIcon kind={first.kind === "shape" ? first.shape : "rect"} />
          </button>
          {open === "stroke" && first.kind === "shape" && (
            <div className="wb-flyout wb-colours">
              {SHAPES.map((s) => (
                <button key={s} type="button" aria-pressed={first.shape === s} onClick={() => onPatch({ shape: s } as Partial<WbElement>)} title={SHAPE_LABEL[s]}><ShapeIcon kind={s} /></button>
              ))}
              <span className="wb-flyout-break" />
              {INK_COLORS.slice(0, 7).map((c) => (
                <button key={c} type="button" className="wb-swatch wb-swatch-ring" style={{ borderColor: c }} aria-label={`Outline ${c}`} onClick={() => onPatch({ stroke: c } as Partial<WbElement>)} />
              ))}
              <button type="button" className="wb-swatch wb-swatch-none" aria-label="No outline" onClick={() => onPatch({ stroke: "none" } as Partial<WbElement>)} />
              {[1, 2, 4, 8].map((w) => (
                <button key={w} type="button" aria-pressed={first.strokeWidth === w} onClick={() => onPatch({ strokeWidth: w } as Partial<WbElement>)} aria-label={`Outline ${w}`}><span className="wb-width" style={{ height: w }} /></button>
              ))}
              <button type="button" aria-pressed={!!first.dash} onClick={() => onPatch({ dash: first.dash ? undefined : true } as Partial<WbElement>)} title="Dashed">- -</button>
            </div>
          )}
        </div>
      )}
      {only === "connector" && first.kind === "connector" && (
        <>
          <select className="wb-select" value={first.route} onChange={(e) => onPatch({ route: e.target.value } as Partial<WbElement>)} aria-label="Line">
            <option value="elbow">Elbow</option>
            <option value="straight">Straight</option>
            <option value="curve">Curve</option>
          </select>
          <button type="button" aria-pressed={first.startArrow} onClick={() => onPatch({ startArrow: !first.startArrow } as Partial<WbElement>)} title="Arrow at the start">←</button>
          <button type="button" aria-pressed={first.endArrow} onClick={() => onPatch({ endArrow: !first.endArrow } as Partial<WbElement>)} title="Arrow at the end">→</button>
          <button type="button" aria-pressed={!!first.dash} onClick={() => onPatch({ dash: first.dash ? undefined : true } as Partial<WbElement>)} title="Dashed">- -</button>
          {[1, 2, 4].map((w) => (
            <button key={w} type="button" aria-pressed={first.strokeWidth === w} onClick={() => onPatch({ strokeWidth: w } as Partial<WbElement>)} aria-label={`Width ${w}`}><span className="wb-width" style={{ height: w + 1 }} /></button>
          ))}
        </>
      )}
      {sizes && (
        <select className="wb-select" value={sizes.includes(currentSize) ? currentSize : currentSize} onChange={(e) => onPatch({ fontSize: Number(e.target.value) || undefined } as Partial<WbElement>)} aria-label="Text size">
          {!sizes.includes(currentSize) && <option value={currentSize}>{currentSize}</option>}
          {sizes.map((s) => (
            <option key={s} value={s}>{s === 0 ? "Auto" : s}</option>
          ))}
        </select>
      )}
      {only === "text" && first.kind === "text" && (
        <>
          <button type="button" aria-pressed={!!first.bold} onClick={() => onPatch({ bold: first.bold ? undefined : true } as Partial<WbElement>)} title="Bold"><strong>B</strong></button>
          <select className="wb-select" value={first.align} onChange={(e) => onPatch({ align: e.target.value } as Partial<WbElement>)} aria-label="Align text">
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </>
      )}
      {onEdit && only !== "card" && (
        <button type="button" onClick={onEdit} title="Edit text (Enter)" aria-label="Edit text"><Type size={16} /></button>
      )}
      {onOpen && <button type="button" onClick={onOpen} title="Details">Details</button>}
      {els.length > 1 && (
        <div className="wb-context-more">
          <button type="button" onClick={() => setOpen(open === "align" ? null : "align")} aria-expanded={open === "align"} title="Line up and space" aria-label="Line up and space"><AlignStartVertical size={16} /></button>
          {open === "align" && (
            <div className="wb-flyout wb-colours">
              <button type="button" onClick={() => onAlign("left")} title="Left edges"><AlignStartVertical size={16} /></button>
              <button type="button" onClick={() => onAlign("centre")} title="Centres"><AlignCenterVertical size={16} /></button>
              <button type="button" onClick={() => onAlign("right")} title="Right edges"><AlignEndVertical size={16} /></button>
              <button type="button" onClick={() => onAlign("top")} title="Tops"><AlignStartHorizontal size={16} /></button>
              <button type="button" onClick={() => onAlign("middle")} title="Middles"><AlignCenterHorizontal size={16} /></button>
              <button type="button" onClick={() => onAlign("bottom")} title="Bottoms"><AlignEndHorizontal size={16} /></button>
              <span className="wb-flyout-break" />
              <button type="button" onClick={() => onDistribute("x")} title="Space evenly across">⇹</button>
              <button type="button" onClick={() => onDistribute("y")} title="Space evenly down">⇳</button>
              <button type="button" onClick={onTidy} title="Tidy into a grid"><LayoutGrid size={16} /></button>
            </div>
          )}
        </div>
      )}
      {els.length > 1 && (
        <button type="button" onClick={onGroup} title={grouped ? "Ungroup (Ctrl+Shift+G)" : "Group (Ctrl+G)"} aria-label={grouped ? "Ungroup" : "Group"}>
          {grouped ? <Ungroup size={16} /> : <Group size={16} />}
        </button>
      )}
      <button type="button" onClick={() => onOrder("front")} title="Bring to front (Ctrl+])" aria-label="Bring to front"><BringToFront size={16} /></button>
      <button type="button" onClick={() => onOrder("back")} title="Send to back (Ctrl+[)" aria-label="Send to back"><SendToBack size={16} /></button>
      <button type="button" onClick={onDuplicate} title="Duplicate (Ctrl+D)" aria-label="Duplicate"><Copy size={16} /></button>
      <button type="button" onClick={onLock} title="Lock (Ctrl+Shift+L)" aria-label="Lock"><Lock size={16} /></button>
      <button type="button" onClick={onDelete} title="Delete" aria-label="Delete" className="wb-danger"><Trash2 size={16} /></button>
    </div>
  );
}

