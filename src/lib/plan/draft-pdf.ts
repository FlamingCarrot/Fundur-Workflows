import type { PdfPageBuilder, Pt } from "@/lib/export/vector-pdf";
import type { Plan, Point } from "./geometry";
import { DEFAULT_TEXT_HEIGHT, dimensionParts, draftPolyline, drafts, ellipsePoints, segmentsOf, styleOf, tableTexts, type Draft, type Hatch, type Linetype } from "./drafting";

/**
 * Drawn shapes on a sheet: each line in its layer's colour, line type and
 * weight (a weight is paper millimetres, as in CAD plotting), hatches as
 * pattern lines clipped to their shape, text at its plan height to scale.
 */

/** Dash patterns in paper mm. */
const DASH: Record<Linetype, number[]> = {
  continuous: [],
  dashed: [3, 1.5],
  hidden: [1.5, 1],
  center: [6, 1.2, 1, 1.2],
  phantom: [7, 1.2, 1, 1.2, 1, 1.2],
  dot: [0.15, 0.9],
};

/** At most this many pattern lines per hatch, so a tiny repeat on a big room stays printable. */
const MAX_LINES = 1500;

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0) as [number, number, number];
const lighten = (c: [number, number, number], k: number): [number, number, number] => c.map((v) => Math.round(v + (255 - v) * k)) as [number, number, number];

/** Parallel lines at `angle` degrees, `spacing` mm apart, across the box round `outline`. */
export function hatchLines(outline: Point[], angle: number, spacing: number, offset = 0): [Point, Point][] {
  if (outline.length < 3 || !(spacing > 0)) return [];
  const a = (angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const n = { x: -u.y, y: u.x };
  const along = outline.map((p) => p.x * u.x + p.y * u.y);
  const across = outline.map((p) => p.x * n.x + p.y * n.y);
  const lo = Math.min(...along);
  const hi = Math.max(...along);
  let from = Math.floor((Math.min(...across) - offset) / spacing) * spacing + offset;
  const to = Math.max(...across);
  const step = Math.max(spacing, (to - from) / MAX_LINES);
  const out: [Point, Point][] = [];
  for (; from <= to; from += step) out.push([{ x: u.x * lo + n.x * from, y: u.y * lo + n.y * from }, { x: u.x * hi + n.x * from, y: u.y * hi + n.y * from }]);
  return out;
}

/** The pattern of a hatch as families of lines: angle and spacing for each. */
function families(h: Hatch): { angle: number; spacing: number; dash?: number[] }[] {
  const s = h.scale;
  const a = h.angle;
  switch (h.pattern) {
    case "diagonal":
      return [{ angle: a + 45, spacing: s / Math.SQRT2 }];
    case "cross":
      return [{ angle: a + 45, spacing: s / Math.SQRT2 }, { angle: a - 45, spacing: s / Math.SQRT2 }];
    case "tiles":
      return [{ angle: a, spacing: s }, { angle: a + 90, spacing: s }];
    case "brick":
      return [{ angle: a, spacing: s / 4 }, { angle: a + 90, spacing: s / 2, dash: [] }];
    case "herringbone":
      return [{ angle: a + 45, spacing: s / 2 }, { angle: a - 45, spacing: s }];
    case "timber":
      return [{ angle: a, spacing: s }];
    case "insulation":
      return [{ angle: a + 60, spacing: s / 2 }, { angle: a - 60, spacing: s / 2 }];
    case "concrete":
    case "dots":
    case "solid":
      return [];
  }
}

export function drawDrafts(page: PdfPageBuilder, floor: Plan, P: (p: Point) => Pt, scale: number) {
  const len = (mm: number) => mm / scale;
  for (const d of drafts(floor)) {
    const st = styleOf(floor, d);
    if (st.hidden) continue;
    const ink = rgb(st.color);
    if (d.fill) hatch(page, d, P, rgb(d.fill.color ?? st.color));
    page.lineWidth(Math.max(0.05, st.weight)).stroke(ink).dash(DASH[st.linetype]);
    if (d.shape === "text") {
      text(page, d, P, len, ink);
      continue;
    }
    if (d.shape === "dimension") {
      dimension(page, d, P, len, ink, st.weight);
      continue;
    }
    if (d.shape === "ellipse") page.polyline(ellipsePoints(d, 96).map(P), true);
    else
      for (const s of segmentsOf(d)) {
        if (s.t === "line") page.line(P(s.a), P(s.b));
        else page.arc(P(s.c), len(s.r), s.a0, s.a0 + s.sweep);
      }
    page.dash();
    if (d.shape === "table") {
      const h = len(d.height ?? DEFAULT_TEXT_HEIGHT);
      for (const t of tableTexts(d)) page.text(P(t.at), t.value.slice(0, 200), h, { colour: ink });
    }
    if (d.shape === "leader" && d.points.length >= 2) {
      const [tip, next] = d.points;
      const L = Math.hypot(next.x - tip.x, next.y - tip.y) || 1;
      const u = { x: (next.x - tip.x) / L, y: (next.y - tip.y) / L };
      const size = 2.5 * scale;
      const base = { x: tip.x + u.x * size, y: tip.y + u.y * size };
      page.fill(ink).polygon([P(tip), P({ x: base.x - u.y * size * 0.3, y: base.y + u.x * size * 0.3 }), P({ x: base.x + u.y * size * 0.3, y: base.y - u.x * size * 0.3 })]);
      if (d.text) {
        const end = d.points[d.points.length - 1];
        const before = d.points[d.points.length - 2];
        const right = end.x >= before.x;
        const h = len(d.height ?? DEFAULT_TEXT_HEIGHT);
        page.text({ x: P(end).x + (right ? 1 : -1), y: P(end).y - h * 0.35 }, d.text.slice(0, 200), h, { align: right ? "left" : "right", colour: ink });
      }
    }
  }
  page.dash();
}

function dimension(page: PdfPageBuilder, d: Draft, P: (p: Point) => Pt, len: (mm: number) => number, ink: [number, number, number], weight: number) {
  const parts = dimensionParts(d);
  const h = d.height ?? DEFAULT_TEXT_HEIGHT;
  page.dash();
  for (const [a, b] of parts.lines) page.line(P(a), P(b));
  for (const a of parts.arcs) page.arc(P(a.c), len(a.r), a.a0, a.a0 + a.sweep);
  page.lineWidth(Math.max(0.25, weight * 2));
  for (const k of parts.ticks) {
    const a = k.angle + Math.PI / 4;
    const r = h * 0.35;
    page.line(P({ x: k.at.x - Math.cos(a) * r, y: k.at.y - Math.sin(a) * r }), P({ x: k.at.x + Math.cos(a) * r, y: k.at.y + Math.sin(a) * r }));
  }
  for (const { tip, from } of parts.arrows) {
    const L = Math.hypot(from.x - tip.x, from.y - tip.y) || 1;
    const u = { x: (from.x - tip.x) / L, y: (from.y - tip.y) / L };
    const size = h * 0.8;
    const base = { x: tip.x + u.x * size, y: tip.y + u.y * size };
    page.fill(ink).polygon([P(tip), P({ x: base.x - u.y * size * 0.3, y: base.y + u.x * size * 0.3 }), P({ x: base.x + u.y * size * 0.3, y: base.y - u.x * size * 0.3 })]);
  }
  page.text(P(parts.text.at), parts.text.value, len(h), { align: "centre", angle: parts.text.angle, colour: ink });
}

function text(page: PdfPageBuilder, d: Draft, P: (p: Point) => Pt, len: (mm: number) => number, ink: [number, number, number]) {
  const h = d.height ?? DEFAULT_TEXT_HEIGHT;
  const a = ((d.rotation ?? 0) * Math.PI) / 180;
  const at = d.points[0];
  (d.text ?? "").split("\n").forEach((line, i) => {
    const down = i * h * 1.4;
    page.text(P({ x: at.x + Math.sin(a) * down, y: at.y - Math.cos(a) * down }), line.slice(0, 200), len(h), { angle: a, colour: ink });
  });
}

function hatch(page: PdfPageBuilder, d: Draft, P: (p: Point) => Pt, ink: [number, number, number]) {
  const fill = d.fill!;
  const { points } = draftPolyline(d);
  if (points.length < 3) return;
  page.save().clipPolygon(points.map(P));
  if (fill.pattern === "solid") page.fill(lighten(ink, 0.45)).polygon(points.map(P));
  else if (fill.pattern === "concrete" || fill.pattern === "dots") {
    // Dots on a grid, every other row shifted, as stipple.
    const grid = hatchLines(points, fill.angle, fill.scale);
    page.fill(ink);
    let count = 0;
    grid.forEach(([a, b], row) => {
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const step = Math.max(fill.scale, L / 200);
      for (let t = (row % 2) * step * 0.5; t <= L && count < 20_000; t += step, count++)
        page.circle(P({ x: a.x + ((b.x - a.x) / (L || 1)) * t, y: a.y + ((b.y - a.y) / (L || 1)) * t }), Math.max(0.12, 0.2 * (fill.pattern === "concrete" ? 1.3 : 1)), "fill");
    });
  } else {
    page.lineWidth(0.09).stroke(ink).dash();
    for (const f of families(fill)) for (const [a, b] of hatchLines(points, f.angle, f.spacing)) page.line(P(a), P(b));
  }
  page.restore();
}
