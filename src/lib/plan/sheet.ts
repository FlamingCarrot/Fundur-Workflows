import { buildPdf, PdfPageBuilder, textWidth, type Pt } from "@/lib/export/vector-pdf";
import { STANDARD, type Resolver } from "@/lib/blueprints/resolve";
import { itemSymbol } from "@/lib/blueprints/symbol";
import { doorLeaves, sortedLevels } from "./elements";
import { centroid, distance, levelOf, m2, onLevel, planBounds, pointAlong, roomArea, samePoint, wallLength, type Plan, type Point } from "./geometry";

/**
 * Drawing sheets (Revit's Sheets): each floor drawn to a true scale on a
 * paper size, inside a border with a title block, as a vector PDF that prints
 * sharp. "Fit" picks the largest standard scale that fits the paper.
 */

export const PAPERS = {
  A4: { w: 297, h: 210, margin: 7, strip: 18 },
  A3: { w: 420, h: 297, margin: 10, strip: 22 },
  A2: { w: 594, h: 420, margin: 10, strip: 26 },
  A1: { w: 841, h: 594, margin: 12, strip: 30 },
} as const;
export type Paper = keyof typeof PAPERS;
export const STANDARD_SCALES = [10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 500, 1000] as const;

export interface SheetOptions {
  paper: Paper;
  /** 1:scale, or the largest standard scale that fits. */
  scale: number | "fit";
  projectName: string;
  /** The drawing's name; the floor's name is added on each sheet. */
  title?: string;
  practice?: string;
  /** The first sheet's number, e.g. "A-101"; later sheets count up. */
  number?: string;
  revision?: string;
  date?: string;
  /** Floors to draw, one sheet each; every floor when left out. */
  levelIds?: string[];
  /** Pictures to add on sheets of their own, e.g. 3D views. */
  views?: { jpeg: Uint8Array; width: number; height: number; title: string }[];
}

export type SheetResult = { ok: true; pdf: Uint8Array; sheets: number; scale: number } | { ok: false; error: string };

const INK: [number, number, number] = [26, 26, 24];
const GREY: [number, number, number] = [110, 110, 104];
const WHITE: [number, number, number] = [255, 255, 255];

/** "A-101" then "A-102"; a number with no digits gets "-2", "-3". */
export function sheetNumber(first: string, index: number): string {
  if (!index) return first;
  const m = first.match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return `${first}-${index + 1}`;
  return `${m[1]}${String(Number(m[2]) + index).padStart(m[2].length, "0")}${m[3]}`;
}

/** The drawing area inside the border, above the title block. */
function frame(paper: Paper) {
  const p = PAPERS[paper];
  return { x: p.margin + 6, y: p.margin + p.strip + 6, w: p.w - p.margin * 2 - 12, h: p.h - p.margin * 2 - p.strip - 12 };
}

/** What a floor's sheet must show: the plan, its dimension lines and its notes. */
function sheetBounds(plan: Plan, levelId: string) {
  const floor = onLevel(plan, levelId);
  const b = planBounds(floor);
  const pts: Point[] = [];
  for (const d of floor.dimensions) {
    const L = distance(d.a, d.b) || 1;
    const n = { x: (-(d.b.y - d.a.y) / L) * d.offset, y: ((d.b.x - d.a.x) / L) * d.offset };
    pts.push({ x: d.a.x + n.x, y: d.a.y + n.y }, { x: d.b.x + n.x, y: d.b.y + n.y });
  }
  for (const n of floor.notes) pts.push(n.at);
  if (!b && !pts.length) return null;
  const all = b ? [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }, ...pts] : pts;
  return { minX: Math.min(...all.map((p) => p.x)), maxX: Math.max(...all.map((p) => p.x)), minY: Math.min(...all.map((p) => p.y)), maxY: Math.max(...all.map((p) => p.y)) };
}

/** The largest standard scale (the smallest number) at which every floor asked for fits. */
export function fitScale(plan: Plan, paper: Paper, levelIds: string[]): number | null {
  const area = frame(paper);
  let need = 0;
  for (const id of levelIds) {
    const b = sheetBounds(plan, id);
    if (!b) continue;
    need = Math.max(need, (b.maxX - b.minX) / area.w, (b.maxY - b.minY) / area.h);
  }
  return STANDARD_SCALES.find((s) => s >= need) ?? null;
}

function titleBlock(page: PdfPageBuilder, paper: Paper, cells: [string, string][]) {
  const p = PAPERS[paper];
  const x0 = p.margin;
  const y0 = p.margin;
  const w = p.w - p.margin * 2;
  page.lineWidth(0.5).stroke(INK).rect(x0, y0, w, p.h - p.margin * 2);
  page.lineWidth(0.35).line({ x: x0, y: y0 + p.strip }, { x: x0 + w, y: y0 + p.strip });
  const weights = [1.3, 2, 2, 0.8, 0.9, 0.8, 0.5];
  const total = weights.reduce((a, b) => a + b, 0);
  const label = Math.max(1.8, p.strip * 0.1);
  const value = Math.max(2.8, p.strip * 0.19);
  let x = x0;
  cells.forEach(([name, text], i) => {
    const cw = (w * weights[i]) / total;
    if (i) page.lineWidth(0.25).line({ x, y: y0 }, { x, y: y0 + p.strip });
    page.text({ x: x + 2.5, y: y0 + p.strip - label - 2 }, name.toUpperCase(), label, { colour: GREY });
    // Long values shrink to fit their cell.
    let size = value;
    while (size > 2 && textWidth(text, size, true) > cw - 5) size -= 0.2;
    page.text({ x: x + 2.5, y: y0 + p.strip * 0.32 }, text, size, { bold: true });
    x += cw;
  });
}

function scaleBar(page: PdfPageBuilder, at: Pt, scale: number) {
  // Four steps of a round length, about 40 mm long on paper.
  const steps = [100, 200, 250, 500, 1_000, 2_000, 2_500, 5_000, 10_000, 20_000, 50_000];
  const step = steps.find((s) => (s * 4) / scale >= 30) ?? 50_000;
  const seg = step / scale;
  page.lineWidth(0.18).stroke(INK);
  for (let i = 0; i < 4; i++) {
    page.fill(i % 2 ? WHITE : INK).rect(at.x + i * seg, at.y, seg, 1.6, "both");
  }
  const label = (mm: number) => (mm >= 1_000 ? `${mm / 1_000} m` : `${mm} mm`);
  page.text({ x: at.x, y: at.y + 2.6 }, "0", 2, { align: "centre" });
  page.text({ x: at.x + seg * 4, y: at.y + 2.6 }, label(step * 4), 2, { align: "centre" });
  page.text({ x: at.x + seg * 4 + 4, y: at.y + 0.2 }, `1:${scale}`, 2.4, { bold: true });
}

function drawFloor(page: PdfPageBuilder, plan: Plan, levelId: string, scale: number, area: ReturnType<typeof frame>, lib: Resolver) {
  const floor = onLevel(plan, levelId);
  const b = sheetBounds(plan, levelId);
  if (!b) {
    page.text({ x: area.x + area.w / 2, y: area.y + area.h / 2 }, "Nothing drawn on this floor yet.", 4, { align: "centre", colour: GREY });
    return;
  }
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const P = (p: Point): Pt => ({ x: area.x + area.w / 2 + (p.x - cx) / scale, y: area.y + area.h / 2 + (p.y - cy) / scale });
  const len = (mm: number) => mm / scale;
  // Text stays readable on paper whatever the scale, but never larger than the room it names.
  page.save().clip(area.x - 4, area.y - 4, area.w + 8, area.h + 8);

  // Furniture, under the walls.
  page.lineWidth(0.13).stroke(GREY);
  for (const item of floor.items) {
    if (item.hidden) continue;
    const a = (item.rotation * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (x: number, y: number) => P({ x: item.at.x + x * c - y * s, y: item.at.y + x * s + y * c });
    for (const sh of itemSymbol(lib, item)) {
      if (sh.t === "rect") page.polyline([at(sh.x, sh.y), at(sh.x + sh.w, sh.y), at(sh.x + sh.w, sh.y + sh.h), at(sh.x, sh.y + sh.h)], true);
      else if (sh.t === "circle") page.circle(at(sh.x, sh.y), len(sh.r));
      else if (sh.t === "poly") page.polyline(sh.points.map((q) => at(q.x, q.y)), true);
      else if (sh.t === "line") page.line(at(sh.x1, sh.y1), at(sh.x2, sh.y2));
      else
        page.polyline(
          Array.from({ length: 28 }, (_, k) => {
            const t = (k / 28) * Math.PI * 2;
            const ex = sh.rx * Math.cos(t);
            const ey = sh.ry * Math.sin(t);
            return at(sh.x + ex * Math.cos(sh.rotation) - ey * Math.sin(sh.rotation), sh.y + ex * Math.sin(sh.rotation) + ey * Math.cos(sh.rotation));
          }),
          true,
        );
    }
  }

  // Walls, cut and filled.
  // A wall end that meets another wall runs on by half its thickness, so corners close.
  const joined = (p: Point, self: string) => floor.walls.some((o) => o.id !== self && (samePoint(o.a, p) || samePoint(o.b, p)));
  for (const w of floor.walls) {
    const L = wallLength(w);
    if (!L) continue;
    const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const ea = joined(w.a, w.id) ? w.thickness / 2 : 0;
    const eb = joined(w.b, w.id) ? w.thickness / 2 : 0;
    const a = { x: w.a.x - u.x * ea, y: w.a.y - u.y * ea };
    const z = { x: w.b.x + u.x * eb, y: w.b.y + u.y * eb };
    const n = { x: -u.y * (w.thickness / 2), y: u.x * (w.thickness / 2) };
    page.fill(w.kind === "partition" ? [70, 70, 66] : INK).polygon([P({ x: a.x + n.x, y: a.y + n.y }), P({ x: z.x + n.x, y: z.y + n.y }), P({ x: z.x - n.x, y: z.y - n.y }), P({ x: a.x - n.x, y: a.y - n.y })]);
  }
  // Doors and windows: a gap in the wall, then the frame, glass or swing.
  for (const o of floor.openings) {
    const w = floor.walls.find((x) => x.id === o.wallId);
    if (!w) continue;
    const L = wallLength(w) || 1;
    const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const n = { x: -u.y * (w.thickness / 2 + 2 * scale * 0.05), y: u.x * (w.thickness / 2 + 2 * scale * 0.05) };
    const s = pointAlong(w, o.at - o.width / 2);
    const e = pointAlong(w, o.at + o.width / 2);
    page.fill(WHITE).polygon([P({ x: s.x + n.x, y: s.y + n.y }), P({ x: e.x + n.x, y: e.y + n.y }), P({ x: e.x - n.x, y: e.y - n.y }), P({ x: s.x - n.x, y: s.y - n.y })]);
    const t = w.thickness / 2;
    const face = (k: number) => [P({ x: s.x - u.y * t * k, y: s.y + u.x * t * k }), P({ x: e.x - u.y * t * k, y: e.y + u.x * t * k })] as const;
    page.lineWidth(0.18).stroke(INK);
    for (const k of [1, -1]) {
      page.line(P({ x: s.x - u.y * t * k, y: s.y + u.x * t * k }), P({ x: s.x, y: s.y }));
      page.line(P({ x: e.x - u.y * t * k, y: e.y + u.x * t * k }), P({ x: e.x, y: e.y }));
    }
    if (o.kind === "window") {
      for (const k of [1, -1]) page.line(...face(k));
      page.lineWidth(0.13).line(...face(0));
    } else {
      for (const leaf of doorLeaves(w, o)) {
        page.lineWidth(0.25).line(P(leaf.hinge), P(leaf.open));
        const a0 = Math.atan2(leaf.jamb.y - leaf.hinge.y, leaf.jamb.x - leaf.hinge.x);
        const a1 = Math.atan2(leaf.open.y - leaf.hinge.y, leaf.open.x - leaf.hinge.x);
        let d = a1 - a0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        page.lineWidth(0.13).dash([0.8, 0.6]).arc(P(leaf.hinge), len(distance(leaf.hinge, leaf.open)), a0, a0 + d).dash();
      }
      if ((o.style ?? "single") === "sliding") page.lineWidth(0.25).line(...face(0.3));
    }
  }
  for (const c of floor.columns) {
    const hw = c.width / 2;
    const hd = (c.round ? c.width : c.depth) / 2;
    if (c.round) page.fill(INK).circle(P(c.at), len(hw), "fill");
    else page.fill(INK).polygon([P({ x: c.at.x - hw, y: c.at.y - hd }), P({ x: c.at.x + hw, y: c.at.y - hd }), P({ x: c.at.x + hw, y: c.at.y + hd }), P({ x: c.at.x - hw, y: c.at.y + hd })]);
  }
  // Dimension lines.
  page.lineWidth(0.13).stroke(INK);
  for (const d of floor.dimensions) {
    const L = distance(d.a, d.b);
    if (L < 1) continue;
    const n = { x: (-(d.b.y - d.a.y) / L) * d.offset, y: ((d.b.x - d.a.x) / L) * d.offset };
    const a = P({ x: d.a.x + n.x, y: d.a.y + n.y });
    const bb = P({ x: d.b.x + n.x, y: d.b.y + n.y });
    page.line(P(d.a), a).line(P(d.b), bb).line(a, bb);
    for (const q of [a, bb]) page.lineWidth(0.25).line({ x: q.x - 0.9, y: q.y - 0.9 }, { x: q.x + 0.9, y: q.y + 0.9 }).lineWidth(0.13);
    let angle = Math.atan2(bb.y - a.y, bb.x - a.x);
    if (angle > Math.PI / 2 + 0.01) angle -= Math.PI;
    if (angle < -Math.PI / 2 - 0.01) angle += Math.PI;
    const mid = { x: (a.x + bb.x) / 2 - Math.sin(angle) * 1, y: (a.y + bb.y) / 2 + Math.cos(angle) * 1 };
    page.text(mid, String(Math.round(L)), 2, { align: "centre", angle });
  }
  // Room names and areas.
  for (const r of floor.rooms) {
    const c = P(centroid(r.points));
    const rb = r.points.reduce((acc, p) => ({ w: Math.max(acc.w, Math.abs(p.x - centroid(r.points).x)) }), { w: 0 });
    const size = Math.max(1.8, Math.min(3, len(rb.w * 2) / Math.max(4, r.name.length * 0.6)));
    page.text({ x: c.x, y: c.y + 0.6 }, r.name, size, { bold: true, align: "centre" });
    page.text({ x: c.x, y: c.y - size * 0.95 }, m2(roomArea(r)), size * 0.8, { align: "centre", colour: GREY });
  }
  for (const note of floor.notes) page.text(P(note.at), note.text.slice(0, 140), 2.2, { colour: INK });
  for (const i of floor.items) if (i.label && !i.hidden) page.text(P(i.at), i.label, 1.8, { align: "centre", colour: GREY });
  page.restore();
}

/** Every floor asked for on a sheet of its own, plus any views, as one PDF. */
export function planSheets(plan: Plan, options: SheetOptions, lib: Resolver = STANDARD): SheetResult {
  const levels = sortedLevels(plan).filter((l) => !options.levelIds?.length || options.levelIds.includes(l.id));
  if (!levels.length && !options.views?.length) return { ok: false, error: "Pick a floor to print." };
  const ids = levels.map((l) => l.id);
  const fit = fitScale(plan, options.paper, ids);
  const scale = options.scale === "fit" ? fit : options.scale;
  if (!scale) return { ok: false, error: `The plan is too big for ${options.paper} even at 1:1000. Choose a bigger paper.` };
  if (options.scale !== "fit" && fit && scale < fit)
    return { ok: false, error: `At 1:${scale} the plan does not fit on ${options.paper}. Use 1:${fit}, or a bigger paper.` };
  if (!Number.isFinite(scale) || scale < 1 || scale > 10_000) return { ok: false, error: "Choose a scale between 1:1 and 1:10000." };
  const paper = PAPERS[options.paper];
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const pages: PdfPageBuilder[] = [];
  const cells = (drawing: string, n: number, sc: string): [string, string][] => [
    ["Practice", options.practice || "Fundur"],
    ["Project", options.projectName],
    ["Drawing", drawing],
    ["Scale", sc],
    ["Date", date],
    ["Sheet", sheetNumber(options.number || "A-101", n)],
    ["Rev", options.revision || "-"],
  ];
  for (const level of levels) {
    const page = new PdfPageBuilder(paper.w, paper.h);
    const area = frame(options.paper);
    drawFloor(page, plan, level.id, scale, area, lib);
    scaleBar(page, { x: area.x, y: area.y - 3.5 }, scale);
    titleBlock(page, options.paper, cells(`${options.title ? `${options.title}, ` : ""}${levelOf(plan, level.id).name}`, pages.length, `1:${scale} at ${options.paper}`));
    pages.push(page);
  }
  for (const view of options.views ?? []) {
    const page = new PdfPageBuilder(paper.w, paper.h);
    const area = frame(options.paper);
    const k = Math.min(area.w / view.width, area.h / view.height);
    const w = view.width * k;
    const h = view.height * k;
    page.image(view.jpeg, view, area.x + (area.w - w) / 2, area.y + (area.h - h) / 2, w, h);
    titleBlock(page, options.paper, cells(view.title, pages.length, "Not to scale"));
    pages.push(page);
  }
  return { ok: true, pdf: buildPdf(pages, `${options.projectName} ${options.title ?? "Drawings"}`), sheets: pages.length, scale };
}
