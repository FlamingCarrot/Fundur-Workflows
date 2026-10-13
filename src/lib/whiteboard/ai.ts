import { z } from "zod";
import { bounds, byId, union, type Pt, type Rect } from "./geometry";
import * as ops from "./ops";
import { FILL_COLORS, INK_COLORS, SHAPES, STICKY_COLORS, WB_LIMIT, type ConnectorEnd, type WbElement } from "./types";
import { cardHeight } from "./board";

/**
 * The whiteboard as the assistant reads and edits it: a short line per
 * element with its id, and a list of steps (add stickies, shapes, text,
 * frames, images; join them; change, move, line up, group or remove them)
 * applied with the same edits a person makes on the board. New things can be
 * given a `ref` so later steps in the same call can join or move them.
 * Safe in the browser and on the server.
 */

const STICKY_NAMES: Record<string, string> = { yellow: STICKY_COLORS[0], orange: STICKY_COLORS[1], pink: STICKY_COLORS[2], purple: STICKY_COLORS[3], blue: STICKY_COLORS[4], green: STICKY_COLORS[5], olive: STICKY_COLORS[6], white: STICKY_COLORS[7] };
const INK_NAMES: Record<string, string> = { black: INK_COLORS[0], grey: INK_COLORS[1], gray: INK_COLORS[1], red: INK_COLORS[2], orange: INK_COLORS[3], teal: INK_COLORS[4], blue: INK_COLORS[5], purple: INK_COLORS[6], white: INK_COLORS[7] };
const FILL_NAMES: Record<string, string> = { white: FILL_COLORS[0], stone: FILL_COLORS[1], pink: FILL_COLORS[2], yellow: FILL_COLORS[3], green: FILL_COLORS[4], blue: FILL_COLORS[5], purple: FILL_COLORS[6], black: FILL_COLORS[7] };
const colour = z.string().max(20);
const hexOr = (value: string | undefined, names: Record<string, string>, fallback?: string) => {
  if (!value) return fallback;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  return names[v] ?? fallback;
};

const n = z.number().finite().min(-100_000).max(100_000);
const size = z.number().finite().min(10).max(20_000);
const ids = z.array(z.string().min(1).max(64)).min(1).max(500);
const ref = z.string().min(1).max(40).optional();

export const boardOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add_sticky"), ref, text: z.string().max(4000), color: colour.optional(), x: n.optional(), y: n.optional(), size: z.enum(["s", "m", "l"]).optional(), frame: z.string().max(64).optional() }).strict(),
  z.object({ op: z.literal("add_stickies"), texts: z.array(z.string().max(4000)).min(1).max(100), color: colour.optional(), x: n.optional(), y: n.optional(), columns: z.number().int().min(1).max(20).optional(), frame: z.string().max(64).optional(), refs: z.array(z.string().max(40)).max(100).optional() }).strict(),
  z.object({ op: z.literal("add_shape"), ref, shape: z.enum(SHAPES), text: z.string().max(4000).optional(), x: n.optional(), y: n.optional(), w: size.optional(), h: size.optional(), fill: colour.optional(), stroke: colour.optional(), frame: z.string().max(64).optional() }).strict(),
  z.object({ op: z.literal("add_text"), ref, text: z.string().max(10_000), x: n.optional(), y: n.optional(), w: size.optional(), fontSize: z.number().min(8).max(300).optional(), bold: z.boolean().optional(), color: colour.optional(), frame: z.string().max(64).optional() }).strict(),
  z.object({ op: z.literal("add_frame"), ref, title: z.string().max(200), x: n.optional(), y: n.optional(), w: size.optional(), h: size.optional(), fill: colour.optional() }).strict(),
  z.object({ op: z.literal("add_image"), ref, documentId: z.uuid(), title: z.string().max(200).optional(), note: z.string().max(5000).optional(), x: n.optional(), y: n.optional(), width: z.number().min(80).max(2000).optional(), frame: z.string().max(64).optional() }).strict(),
  z.object({
    op: z.literal("connect"),
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    label: z.string().max(500).optional(),
    route: z.enum(["elbow", "straight", "curve"]).optional(),
    arrow: z.enum(["end", "both", "none"]).optional(),
    dashed: z.boolean().optional(),
    color: colour.optional(),
  }).strict(),
  z.object({
    op: z.literal("update"),
    id: z.string().min(1).max(64),
    text: z.string().max(10_000).optional(),
    title: z.string().max(200).optional(),
    color: colour.optional(),
    fill: colour.optional(),
    stroke: colour.optional(),
    shape: z.enum(SHAPES).optional(),
    x: n.optional(),
    y: n.optional(),
    w: size.optional(),
    h: size.optional(),
    rotation: z.number().min(-360).max(360).optional(),
    fontSize: z.number().min(6).max(300).optional(),
    locked: z.boolean().optional(),
  }).strict(),
  z.object({ op: z.literal("move"), ids, dx: n.optional(), dy: n.optional(), x: n.optional(), y: n.optional() }).strict(),
  z.object({ op: z.literal("remove"), ids }).strict(),
  z.object({ op: z.literal("group"), ids }).strict(),
  z.object({ op: z.literal("ungroup"), ids }).strict(),
  z.object({ op: z.literal("align"), ids, how: z.enum(["left", "centre", "right", "top", "middle", "bottom"]) }).strict(),
  z.object({ op: z.literal("distribute"), ids, axis: z.enum(["x", "y"]) }).strict(),
  z.object({ op: z.literal("tidy"), ids, gap: z.number().min(0).max(1000).optional() }).strict(),
  z.object({ op: z.literal("reorder"), ids, to: z.enum(["front", "back", "forward", "backward"]) }).strict(),
  z.object({ op: z.literal("wrap_in_frame"), ref, ids, title: z.string().max(200), padding: z.number().min(0).max(1000).optional() }).strict(),
]);
export type BoardOp = z.infer<typeof boardOp>;

export class BoardOpError extends Error {}

const cut = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s).replace(/\s+/g, " ");
const at = (e: { x: number; y: number; w: number; h: number }) => `at (${Math.round(e.x)}, ${Math.round(e.y)}) ${Math.round(e.w)}×${Math.round(e.h)}`;

/** The board in a line per element, for the model: ids, kinds, words, colours and where things are. */
export function describeBoard(els: WbElement[], limit = 400): string {
  if (!els.length) return "The board is empty.";
  const all = byId(els);
  const box = union(els.map((e) => bounds(e, all)))!;
  const lines = [`${els.length} element(s), spanning (${Math.round(box.x)}, ${Math.round(box.y)}) to (${Math.round(box.x + box.w)}, ${Math.round(box.y + box.h)}). Units are pixels at 100%, x right, y down.`];
  const sorted = [...els].sort((a, b) => (a.kind === "frame" ? -1 : 0) - (b.kind === "frame" ? -1 : 0) || a.y - b.y || a.x - b.x);
  for (const e of sorted.slice(0, limit)) {
    const extra = [e.groupId ? `group ${e.groupId.slice(0, 8)}` : "", e.locked ? "locked" : "", e.rotation ? `turned ${e.rotation}°` : ""].filter(Boolean).join(", ");
    const tail = extra ? ` (${extra})` : "";
    switch (e.kind) {
      case "sticky":
        lines.push(`[${e.id}] sticky ${e.color} ${at(e)}: "${cut(e.text)}"${tail}`);
        break;
      case "shape":
        lines.push(`[${e.id}] ${e.shape} fill ${e.fill} ${at(e)}${e.text ? `: "${cut(e.text)}"` : ""}${tail}`);
        break;
      case "text":
        lines.push(`[${e.id}] text ${e.fontSize}px${e.bold ? " bold" : ""} ${at(e)}: "${cut(e.text)}"${tail}`);
        break;
      case "frame":
        lines.push(`[${e.id}] frame "${cut(e.title, 60)}" ${at(e)}${tail}`);
        break;
      case "card":
        lines.push(`[${e.id}] ${e.documentId ? `image card [document ${e.documentId}]` : "note card"} ${at(e)}: "${cut(e.title, 60)}"${e.body ? ` (${cut(e.body, 60)})` : ""}${e.tags.length ? ` tags ${e.tags.join(", ")}` : ""}${e.group ? ` group "${e.group}"` : ""}${tail}`);
        break;
      case "connector":
        lines.push(`[${e.id}] line ${e.route} from ${e.from.id ? `[${e.from.id}]` : `(${Math.round(e.from.x)}, ${Math.round(e.from.y)})`} to ${e.to.id ? `[${e.to.id}]` : `(${Math.round(e.to.x)}, ${Math.round(e.to.y)})`}${e.label ? ` "${cut(e.label, 40)}"` : ""}${tail}`);
        break;
      case "pen":
        lines.push(`[${e.id}] ${e.highlight ? "highlighter" : "pen"} stroke ${at(e)}${tail}`);
        break;
    }
  }
  if (els.length > limit) lines.push(`…and ${els.length - limit} more.`);
  return lines.join("\n");
}

const STICKY_SIZE = { s: 140, m: 200, l: 280 } as const;

/**
 * Applies the steps in order. Returns the new elements and a line per step
 * for the change log. Throws BoardOpError, naming the step, when one cannot
 * be applied; nothing is applied then.
 */
export function applyBoardOps(start: WbElement[], steps: BoardOp[], options: { images?: Set<string>; newId?: () => string } = {}): { els: WbElement[]; changes: string[]; made: Record<string, string> } {
  let els = start;
  const made: Record<string, string> = {};
  const changes: string[] = [];
  const fresh = new Set<string>();
  // New things without a place flow in rows to the right of what is there.
  const content = union(start.map((e) => bounds(e, byId(start))));
  const flow = { x: content ? content.x + content.w + 120 : 0, y: content ? content.y : 0, rowStart: content ? content.x + content.w + 120 : 0, rowH: 0 };
  const place = (w: number, h: number, x?: number, y?: number): Pt => {
    if (x !== undefined && y !== undefined) return { x, y };
    if (flow.x - flow.rowStart > 1800) {
      flow.x = flow.rowStart;
      flow.y += flow.rowH + 60;
      flow.rowH = 0;
    }
    const p = { x: x ?? flow.x, y: y ?? flow.y };
    flow.x += w + 40;
    flow.rowH = Math.max(flow.rowH, h);
    return p;
  };
  const resolve = (id: string, step: number): WbElement => {
    const real = made[id] ?? id;
    const el = els.find((e) => e.id === real);
    if (!el) throw new BoardOpError(`Step ${step}: there is no element [${id}] on this board. Read the board for ids.`);
    return el;
  };
  const list = (want: string[], step: number) => want.map((id) => resolve(id, step).id);
  // Inside a frame: a free spot in it, in rows from its top-left corner.
  const frameSpots = new Map<string, { x: number; y: number; rowH: number }>();
  const inFrame = (frameId: string, w: number, h: number, step: number): Pt => {
    const f = resolve(frameId, step);
    if (f.kind !== "frame") throw new BoardOpError(`Step ${step}: [${frameId}] is not a frame.`);
    const kids = els.filter((e) => e.id !== f.id && e.kind !== "connector" && e.kind !== "frame" && e.x >= f.x && e.y >= f.y && e.x + e.w <= f.x + f.w && e.y + e.h <= f.y + f.h);
    let spot = frameSpots.get(f.id);
    if (!spot) {
      const lowest = kids.length ? Math.max(...kids.map((k) => k.y + k.h)) + 40 : f.y + 40;
      spot = { x: f.x + 40, y: kids.length ? lowest : f.y + 40, rowH: 0 };
    }
    if (spot.x + w > f.x + f.w - 40 && spot.x > f.x + 40) {
      spot.x = f.x + 40;
      spot.y += spot.rowH + 40;
      spot.rowH = 0;
    }
    const p = { x: spot.x, y: spot.y };
    spot.x += w + 40;
    spot.rowH = Math.max(spot.rowH, h);
    frameSpots.set(f.id, spot);
    // The frame grows to hold what is put in it.
    const needW = p.x + w + 40 - f.x;
    const needH = p.y + h + 40 - f.y;
    if (needW > f.w || needH > f.h) els = ops.update(els, [f.id], { w: Math.max(f.w, needW), h: Math.max(f.h, needH) });
    return p;
  };
  const add = (el: WbElement, r: string | undefined, step: number) => {
    if (r) {
      if (made[r]) throw new BoardOpError(`Step ${step}: ref "${r}" is already used in this call.`);
      made[r] = el.id;
    }
    fresh.add(el.id);
    els = [...els, el];
  };
  const z = () => ops.topZ(els);

  steps.forEach((s, i) => {
    const step = i + 1;
    switch (s.op) {
      case "add_sticky": {
        const w = STICKY_SIZE[s.size ?? "m"];
        const p = s.frame ? inFrame(s.frame, w, w, step) : place(w, w, s.x, s.y);
        add(ops.sticky({ x: p.x + w / 2, y: p.y + w / 2 }, z(), { text: s.text, color: hexOr(s.color, STICKY_NAMES, STICKY_COLORS[0])!, w, h: w, x: p.x, y: p.y }), s.ref, step);
        changes.push(`Added a sticky "${cut(s.text, 40)}"`);
        break;
      }
      case "add_stickies": {
        const cols = s.columns ?? Math.min(6, Math.ceil(Math.sqrt(s.texts.length)));
        const w = 200;
        const origin = s.frame ? null : place(cols * (w + 30) - 30, Math.ceil(s.texts.length / cols) * (w + 30) - 30, s.x, s.y);
        s.texts.forEach((text, k) => {
          const p = s.frame ? inFrame(s.frame, w, w, step) : { x: origin!.x + (k % cols) * (w + 30), y: origin!.y + Math.floor(k / cols) * (w + 30) };
          add(ops.sticky({ x: 0, y: 0 }, z(), { text, color: hexOr(s.color, STICKY_NAMES, STICKY_COLORS[0])!, x: p.x, y: p.y }), s.refs?.[k], step);
        });
        changes.push(`Added ${s.texts.length} stickies`);
        break;
      }
      case "add_shape": {
        const w = s.w ?? (s.shape === "rect" || s.shape === "rounded" || s.shape === "parallelogram" ? 200 : 160);
        const h = s.h ?? (s.shape === "rect" || s.shape === "rounded" || s.shape === "parallelogram" ? 120 : 160);
        const p = s.frame ? inFrame(s.frame, w, h, step) : place(w, h, s.x, s.y);
        add(ops.shape(s.shape, { x: p.x, y: p.y, w, h }, z(), { text: s.text ?? "", fill: hexOr(s.fill, FILL_NAMES, "#ffffff")!, stroke: s.stroke === "none" ? "none" : hexOr(s.stroke, INK_NAMES, "#1f2421")! }), s.ref, step);
        changes.push(`Added a ${s.shape}${s.text ? ` "${cut(s.text, 40)}"` : ""}`);
        break;
      }
      case "add_text": {
        const fontSize = s.fontSize ?? 24;
        const w = s.w ?? Math.min(900, Math.max(80, Math.max(...s.text.split("\n").map((l) => l.length)) * fontSize * 0.55 + 10));
        const h = Math.max(fontSize * 1.3, s.text.split("\n").length * fontSize * 1.3);
        const p = s.frame ? inFrame(s.frame, w, h, step) : place(w, h, s.x, s.y);
        add(ops.text({ x: p.x, y: p.y }, z(), { text: s.text, fontSize, bold: s.bold || undefined, w, h, color: hexOr(s.color, INK_NAMES, "#1f2421")! }), s.ref, step);
        changes.push(`Added text "${cut(s.text, 40)}"`);
        break;
      }
      case "add_frame": {
        const w = s.w ?? 1000;
        const h = s.h ?? 700;
        const p = place(w, h, s.x, s.y);
        add(ops.frame({ x: p.x, y: p.y, w, h }, Math.min(0, ...els.map((e) => e.z)) - 1, { title: s.title, fill: hexOr(s.fill, FILL_NAMES, "#ffffff")! }), s.ref, step);
        changes.push(`Added a frame "${cut(s.title, 40)}"`);
        break;
      }
      case "add_image": {
        if (options.images && !options.images.has(s.documentId)) throw new BoardOpError(`Step ${step}: [document ${s.documentId}] is not an image in this project. Use one from the project's documents.`);
        const w = s.width ?? 260;
        const h = cardHeight({ width: w, documentId: s.documentId, title: s.title ?? "", body: s.note ?? "" });
        const p = s.frame ? inFrame(s.frame, w, h, step) : place(w, h, s.x, s.y);
        add({ id: options.newId?.() ?? ops.newId(), kind: "card", x: p.x, y: p.y, w, h, z: z(), title: s.title ?? "", body: s.note ?? "", tags: [], group: "", documentId: s.documentId, color: "#f6f2e8" }, s.ref, step);
        changes.push(`Pinned an image${s.title ? ` "${cut(s.title, 40)}"` : ""}`);
        break;
      }
      case "connect": {
        const a = resolve(s.from, step);
        const b = resolve(s.to, step);
        if (a.kind === "connector" || b.kind === "connector") throw new BoardOpError(`Step ${step}: lines join things, not other lines.`);
        const from: ConnectorEnd = { id: a.id, x: a.x + a.w / 2, y: a.y + a.h / 2 };
        const to: ConnectorEnd = { id: b.id, x: b.x + b.w / 2, y: b.y + b.h / 2 };
        add(
          ops.connector(from, to, z(), {
            route: s.route ?? "elbow",
            startArrow: s.arrow === "both",
            endArrow: s.arrow !== "none",
            ...(s.dashed ? { dash: true } : {}),
            ...(s.label ? { label: s.label } : {}),
            stroke: hexOr(s.color, INK_NAMES, "#1f2421")!,
          }),
          undefined,
          step
        );
        els = ops.syncConnectors(els);
        changes.push(`Joined [${a.id.slice(0, 8)}] to [${b.id.slice(0, 8)}]${s.label ? ` "${cut(s.label, 30)}"` : ""}`);
        break;
      }
      case "update": {
        const e = resolve(s.id, step);
        const patch: Record<string, unknown> = {};
        if (s.text !== undefined) {
          if (e.kind === "sticky" || e.kind === "shape" || e.kind === "text") patch.text = s.text;
          else if (e.kind === "connector") patch.label = s.text || undefined;
          else if (e.kind === "card") patch.body = s.text.slice(0, 5000);
          else throw new BoardOpError(`Step ${step}: a ${e.kind} has no words; give a frame or card a title instead.`);
        }
        if (s.title !== undefined) {
          if (e.kind === "frame" || e.kind === "card") patch.title = s.title;
          else throw new BoardOpError(`Step ${step}: only frames and cards have titles.`);
        }
        if (s.color !== undefined) {
          if (e.kind === "sticky") patch.color = hexOr(s.color, STICKY_NAMES);
          else if (e.kind === "text") patch.color = hexOr(s.color, INK_NAMES);
          else if (e.kind === "card") patch.color = hexOr(s.color, FILL_NAMES);
          else if (e.kind === "connector" || e.kind === "pen") patch.stroke = hexOr(s.color, INK_NAMES);
          else if (e.kind === "shape" || e.kind === "frame") patch.fill = hexOr(s.color, FILL_NAMES);
          if (Object.values(patch).includes(undefined)) throw new BoardOpError(`Step ${step}: "${s.color}" is not a colour; use a name like yellow or blue, or a hex code like #a3b18a.`);
        }
        if (s.fill !== undefined && (e.kind === "shape" || e.kind === "frame")) patch.fill = s.fill === "none" && e.kind === "shape" ? "none" : hexOr(s.fill, FILL_NAMES, (e as { fill: string }).fill);
        if (s.stroke !== undefined && e.kind === "shape") patch.stroke = s.stroke === "none" ? "none" : hexOr(s.stroke, INK_NAMES, e.stroke);
        if (s.shape && e.kind === "shape") patch.shape = s.shape;
        if (s.fontSize !== undefined && (e.kind === "text" || e.kind === "sticky" || e.kind === "shape")) patch.fontSize = s.fontSize;
        if (s.rotation !== undefined) patch.rotation = s.rotation || undefined;
        if (s.locked !== undefined) patch.locked = s.locked || undefined;
        els = ops.update(els, [e.id], patch);
        if (s.w !== undefined || s.h !== undefined) {
          const cur = els.find((x) => x.id === e.id)!;
          if (cur.kind === "connector") throw new BoardOpError(`Step ${step}: a line's size follows what it joins.`);
          els = ops.resize(els, [e.id], { x: cur.x, y: cur.y, w: cur.w, h: cur.h }, { x: cur.x, y: cur.y, w: s.w ?? cur.w, h: s.h ?? cur.h });
        }
        if (s.x !== undefined || s.y !== undefined) {
          const cur = els.find((x) => x.id === e.id)!;
          els = ops.move(els, [e.id], (s.x ?? cur.x) - cur.x, (s.y ?? cur.y) - cur.y);
        }
        changes.push(`Changed [${e.id.slice(0, 8)}]`);
        break;
      }
      case "move": {
        const want = list(s.ids, step);
        let dx = s.dx ?? 0;
        let dy = s.dy ?? 0;
        if (s.x !== undefined || s.y !== undefined) {
          const box = union(els.filter((e) => want.includes(e.id)).map((e) => bounds(e, byId(els))))!;
          dx = (s.x ?? box.x) - box.x;
          dy = (s.y ?? box.y) - box.y;
        }
        const locked = els.filter((e) => want.includes(e.id) && e.locked && !fresh.has(e.id));
        if (locked.length) throw new BoardOpError(`Step ${step}: [${locked[0].id}] is locked; she locked it so it stays put.`);
        els = ops.move(els, want, dx, dy);
        changes.push(`Moved ${want.length} element(s)`);
        break;
      }
      case "remove": {
        const want = list(s.ids, step);
        const locked = els.filter((e) => want.includes(e.id) && e.locked);
        if (locked.length) throw new BoardOpError(`Step ${step}: [${locked[0].id}] is locked; unlock it first if she asks.`);
        els = ops.remove(els, want);
        changes.push(`Removed ${want.length} element(s)`);
        break;
      }
      case "group":
        els = ops.group(els, list(s.ids, step));
        changes.push(`Grouped ${s.ids.length} element(s)`);
        break;
      case "ungroup":
        els = ops.ungroup(els, list(s.ids, step));
        changes.push(`Ungrouped`);
        break;
      case "align":
        els = ops.align(els, list(s.ids, step), s.how);
        changes.push(`Lined up ${s.ids.length} element(s) by their ${s.how}`);
        break;
      case "distribute":
        els = ops.distribute(els, list(s.ids, step), s.axis);
        changes.push(`Spaced out ${s.ids.length} element(s)`);
        break;
      case "tidy":
        els = ops.tidy(els, list(s.ids, step), s.gap);
        changes.push(`Tidied ${s.ids.length} element(s) into a grid`);
        break;
      case "reorder":
        els = ops.reorder(els, list(s.ids, step), s.to);
        changes.push(`Brought ${s.ids.length} element(s) ${s.to === "front" || s.to === "forward" ? "forward" : "back"}`);
        break;
      case "wrap_in_frame": {
        const want = list(s.ids, step);
        const box = union(els.filter((e) => want.includes(e.id)).map((e) => bounds(e, byId(els))))!;
        const pad = s.padding ?? 60;
        const r: Rect = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
        add(ops.frame(r, Math.min(0, ...els.map((e) => e.z)) - 1, { title: s.title }), s.ref, step);
        changes.push(`Framed ${want.length} element(s) as "${cut(s.title, 40)}"`);
        break;
      }
    }
    if (els.length > WB_LIMIT) throw new BoardOpError(`Step ${step}: a board holds up to ${WB_LIMIT} elements.`);
  });
  return { els, changes, made };
}
