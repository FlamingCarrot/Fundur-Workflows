import { bounds, byId, centre, connectorPoints, boxOf, union, type Pt, type Rect } from "./geometry";
import { STICKY_COLORS, type Connector, type ConnectorEnd, type Frame, type Pen, type ShapeEl, type ShapeKind, type Side, type Sticky, type TextEl, type WbElement } from "./types";

/**
 * Whiteboard edits, each a pure function from the elements to the changed
 * elements. The board on screen and the assistant make the same edits.
 */

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
export const topZ = (els: WbElement[]) => (els.length ? Math.max(...els.map((e) => e.z)) + 1 : 1);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function sticky(at: Pt, z: number, patch: Partial<Sticky> = {}): Sticky {
  return { id: newId(), kind: "sticky", x: r1(at.x - 100), y: r1(at.y - 100), w: 200, h: 200, z, text: "", color: STICKY_COLORS[0], ...patch };
}
export function shape(kind: ShapeKind, box: Rect, z: number, patch: Partial<ShapeEl> = {}): ShapeEl {
  return { id: newId(), kind: "shape", shape: kind, x: r1(box.x), y: r1(box.y), w: Math.max(8, r1(box.w)), h: Math.max(8, r1(box.h)), z, fill: "#ffffff", stroke: "#1f2421", strokeWidth: 2, text: "", ...patch };
}
export function text(at: Pt, z: number, patch: Partial<TextEl> = {}): TextEl {
  return { id: newId(), kind: "text", x: r1(at.x), y: r1(at.y), w: 260, h: 40, z, text: "", color: "#1f2421", fontSize: 24, align: "left", ...patch };
}
export function frame(box: Rect, z: number, patch: Partial<Frame> = {}): Frame {
  return { id: newId(), kind: "frame", x: r1(box.x), y: r1(box.y), w: Math.max(40, r1(box.w)), h: Math.max(40, r1(box.h)), z, title: "Frame", fill: "#ffffff", ...patch };
}
export function connector(from: ConnectorEnd, to: ConnectorEnd, z: number, patch: Partial<Connector> = {}): Connector {
  return { id: newId(), kind: "connector", x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.max(1, Math.abs(to.x - from.x)), h: Math.max(1, Math.abs(to.y - from.y)), z, from, to, route: "elbow", stroke: "#1f2421", strokeWidth: 2, startArrow: false, endArrow: true, ...patch };
}
/** A pen stroke from the points drawn (board units). */
export function pen(points: Pt[], z: number, patch: Partial<Pen> = {}): Pen {
  const box = boxOf(points);
  return {
    id: newId(),
    kind: "pen",
    x: r1(box.x),
    y: r1(box.y),
    w: Math.max(1, r1(box.w)),
    h: Math.max(1, r1(box.h)),
    z,
    points: points.flatMap((p) => [r1(p.x - box.x), r1(p.y - box.y)]),
    stroke: "#1f2421",
    strokeWidth: 3,
    ...patch,
  };
}

/** Keeps each connector's stored box and loose ends in step with what it joins. */
export function syncConnectors(els: WbElement[]): WbElement[] {
  const all = byId(els);
  return els.map((e) => {
    if (e.kind !== "connector") return e;
    const pts = connectorPoints(e, all);
    const box = boxOf(pts);
    const fix = (end: ConnectorEnd, p: Pt): ConnectorEnd => (end.id && all.has(end.id) ? { ...end, x: r1(p.x), y: r1(p.y) } : end);
    return { ...e, x: r1(box.x), y: r1(box.y), w: r1(box.w), h: r1(box.h), from: fix(e.from, pts[0]), to: fix(e.to, pts[pts.length - 1]) };
  });
}

/** Moves elements; loose connector ends move with them when the connector moves. */
export function move(els: WbElement[], ids: string[], dx: number, dy: number): WbElement[] {
  const set = new Set(ids);
  return syncConnectors(
    els.map((e) => {
      if (!set.has(e.id) || e.locked) return e;
      if (e.kind === "connector") {
        const shift = (end: ConnectorEnd): ConnectorEnd => (end.id && !set.has(end.id) ? end : end.id ? end : { ...end, x: r1(end.x + dx), y: r1(end.y + dy) });
        return { ...e, from: shift(e.from), to: shift(e.to) };
      }
      return { ...e, x: r1(e.x + dx), y: r1(e.y + dy) };
    })
  );
}

/** Stretches elements from one box to another, as dragging a selection's corner does. */
export function resize(els: WbElement[], ids: string[], from: Rect, to: Rect): WbElement[] {
  const set = new Set(ids);
  const kx = to.w / (from.w || 1);
  const ky = to.h / (from.h || 1);
  const mx = (x: number) => r1(to.x + (x - from.x) * kx);
  const my = (y: number) => r1(to.y + (y - from.y) * ky);
  return syncConnectors(
    els.map((e) => {
      if (!set.has(e.id) || e.locked) return e;
      if (e.kind === "connector") {
        const end = (p: ConnectorEnd): ConnectorEnd => (p.id ? p : { ...p, x: mx(p.x), y: my(p.y) });
        return { ...e, from: end(e.from), to: end(e.to) };
      }
      const next = { ...e, x: mx(e.x), y: my(e.y), w: Math.max(4, r1(e.w * kx)), h: Math.max(4, r1(e.h * ky)) };
      if (next.kind === "pen") next.points = e.kind === "pen" ? e.points.map((v, i) => r1(i % 2 ? v * ky : v * kx)) : [];
      // Text grows with its box, as on a whiteboard.
      if (next.kind === "text" && e.kind === "text") next.fontSize = Math.max(6, Math.min(400, r1(e.fontSize * Math.sqrt(kx * ky))));
      return next;
    })
  );
}

/** Changes fields on elements; the caller passes fields that fit their kinds. */
export function update(els: WbElement[], ids: string[], patch: Record<string, unknown> | ((e: WbElement) => Record<string, unknown>)): WbElement[] {
  const set = new Set(ids);
  return syncConnectors(els.map((e) => (set.has(e.id) ? ({ ...e, ...(typeof patch === "function" ? patch(e) : patch) } as WbElement) : e)));
}

/** Removes elements, and the connectors that held on to them. */
export function remove(els: WbElement[], ids: string[]): WbElement[] {
  const set = new Set(ids.filter((id) => !els.find((e) => e.id === id)?.locked));
  return els.filter((e) => !set.has(e.id) && !(e.kind === "connector" && ((e.from.id && set.has(e.from.id)) || (e.to.id && set.has(e.to.id)))));
}

/** Copies of elements, offset, with new ids; connectors among them join the copies, and groups stay groups of their own. */
export function copies(els: WbElement[], source: WbElement[], offset: Pt): WbElement[] {
  const ids = new Map(source.map((e) => [e.id, newId()]));
  const groups = new Map<string, string>();
  let z = topZ(els);
  const end = (p: ConnectorEnd): ConnectorEnd => (p.id && ids.has(p.id) ? { ...p, id: ids.get(p.id)!, x: r1(p.x + offset.x), y: r1(p.y + offset.y) } : { x: r1(p.x + offset.x), y: r1(p.y + offset.y), ...(p.side ? { side: p.side } : {}) });
  return [...source]
    .sort((a, b) => a.z - b.z)
    .map((e) => {
      const copy = { ...structuredClone(e), id: ids.get(e.id)!, x: r1(e.x + offset.x), y: r1(e.y + offset.y), z: z++ } as WbElement;
      delete copy.locked;
      if (copy.groupId) {
        if (!groups.has(copy.groupId)) groups.set(copy.groupId, newId());
        copy.groupId = groups.get(copy.groupId);
      }
      if (copy.kind === "connector" && e.kind === "connector") {
        copy.from = end(e.from);
        copy.to = end(e.to);
      }
      return copy;
    });
}

export function duplicate(els: WbElement[], ids: string[], offset: Pt = { x: 24, y: 24 }): { els: WbElement[]; made: string[] } {
  const source = els.filter((e) => ids.includes(e.id));
  const made = copies(els, source, offset);
  return { els: syncConnectors([...els, ...made]), made: made.map((e) => e.id) };
}

/** Brings to the front, sends to the back, or steps one place. */
export function reorder(els: WbElement[], ids: string[], to: "front" | "back" | "forward" | "backward"): WbElement[] {
  const set = new Set(ids);
  const sorted = [...els].sort((a, b) => a.z - b.z);
  let order: WbElement[];
  if (to === "front") order = [...sorted.filter((e) => !set.has(e.id)), ...sorted.filter((e) => set.has(e.id))];
  else if (to === "back") order = [...sorted.filter((e) => set.has(e.id)), ...sorted.filter((e) => !set.has(e.id))];
  else {
    order = [...sorted];
    const step = to === "forward" ? 1 : -1;
    const indices = order.map((e, i) => (set.has(e.id) ? i : -1)).filter((i) => i >= 0);
    for (const i of step > 0 ? indices.reverse() : indices) {
      const j = i + step;
      if (j < 0 || j >= order.length || set.has(order[j].id)) continue;
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const z = new Map(order.map((e, i) => [e.id, i + 1]));
  return els.map((e) => ({ ...e, z: z.get(e.id)! }));
}

export type AlignHow = "left" | "centre" | "right" | "top" | "middle" | "bottom";

/** Lines up elements' edges or middles with the selection's. */
export function align(els: WbElement[], ids: string[], how: AlignHow): WbElement[] {
  const all = byId(els);
  const picked = els.filter((e) => ids.includes(e.id) && e.kind !== "connector" && !e.locked);
  const box = union(picked.map((e) => bounds(e, all)));
  if (!box || picked.length < 2) return els;
  let out = els;
  for (const e of picked) {
    const b = bounds(e, all);
    const dx = how === "left" ? box.x - b.x : how === "right" ? box.x + box.w - (b.x + b.w) : how === "centre" ? box.x + box.w / 2 - (b.x + b.w / 2) : 0;
    const dy = how === "top" ? box.y - b.y : how === "bottom" ? box.y + box.h - (b.y + b.h) : how === "middle" ? box.y + box.h / 2 - (b.y + b.h / 2) : 0;
    out = move(out, [e.id], dx, dy);
  }
  return out;
}

/** Spaces elements evenly across or down, keeping the outer two where they are. */
export function distribute(els: WbElement[], ids: string[], axis: "x" | "y"): WbElement[] {
  const all = byId(els);
  const picked = els.filter((e) => ids.includes(e.id) && e.kind !== "connector" && !e.locked).map((e) => ({ e, b: bounds(e, all) }));
  if (picked.length < 3) return els;
  const key = axis === "x" ? "x" : "y";
  const size = axis === "x" ? "w" : "h";
  picked.sort((a, b) => a.b[key] - b.b[key]);
  const start = picked[0].b[key];
  const end = picked[picked.length - 1].b[key] + picked[picked.length - 1].b[size];
  const gap = (end - start - picked.reduce((s, p) => s + p.b[size], 0)) / (picked.length - 1);
  let at = start;
  let out = els;
  for (const p of picked) {
    const d = at - p.b[key];
    out = move(out, [p.e.id], axis === "x" ? d : 0, axis === "y" ? d : 0);
    at += p.b[size] + gap;
  }
  return out;
}

/** Arranges elements in a neat grid in reading order, as "tidy up" does. */
export function tidy(els: WbElement[], ids: string[], gap = 24): WbElement[] {
  const all = byId(els);
  const picked = els.filter((e) => ids.includes(e.id) && e.kind !== "connector" && e.kind !== "frame" && !e.locked).map((e) => ({ e, b: bounds(e, all) }));
  if (picked.length < 2) return els;
  const box = union(picked.map((p) => p.b))!;
  picked.sort((a, b) => Math.round(a.b.y / 80) - Math.round(b.b.y / 80) || a.b.x - b.b.x);
  const cols = Math.max(1, Math.round(Math.sqrt(picked.length * (box.w / Math.max(box.h, 1)))));
  const cellW = Math.max(...picked.map((p) => p.b.w));
  const cellH = Math.max(...picked.map((p) => p.b.h));
  let out = els;
  picked.forEach((p, i) => {
    const x = box.x + (i % cols) * (cellW + gap) + (cellW - p.b.w) / 2;
    const y = box.y + Math.floor(i / cols) * (cellH + gap) + (cellH - p.b.h) / 2;
    out = move(out, [p.e.id], x - p.b.x, y - p.b.y);
  });
  return out;
}

export function group(els: WbElement[], ids: string[]): WbElement[] {
  if (ids.length < 2) return els;
  const g = newId();
  return els.map((e) => (ids.includes(e.id) ? { ...e, groupId: g } : e));
}
export function ungroup(els: WbElement[], ids: string[]): WbElement[] {
  const groups = new Set(els.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId));
  return els.map((e) => {
    if (!e.groupId || !groups.has(e.groupId)) return e;
    const next = { ...e };
    delete next.groupId;
    return next;
  });
}

/** A sticky next to another, joined to it, as the "+" beside a selected sticky makes. */
export function growFrom(els: WbElement[], fromId: string, side: Side, gap = 80): { els: WbElement[]; made: string } | null {
  const from = els.find((e) => e.id === fromId);
  if (!from || from.kind === "connector" || from.kind === "pen") return null;
  const d = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }[side];
  const copy: WbElement = { ...structuredClone(from), id: newId(), x: r1(from.x + d.x * (from.w + gap)), y: r1(from.y + d.y * (from.h + gap)), z: topZ(els) } as WbElement;
  if ("text" in copy && copy.kind !== "text") copy.text = "";
  if (copy.kind === "card") {
    copy.title = "";
    copy.body = "";
    copy.documentId = null;
  }
  delete copy.groupId;
  delete copy.locked;
  const opposite = { top: "bottom", right: "left", bottom: "top", left: "right" } as const;
  const c = connector({ id: from.id, side, ...centre(from) }, { id: copy.id, side: opposite[side], ...centre(copy) }, topZ(els) + 1, { route: "straight" });
  return { els: syncConnectors([...els, copy, c]), made: copy.id };
}
