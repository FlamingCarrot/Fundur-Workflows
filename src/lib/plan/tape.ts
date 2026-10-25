import type { Point } from "./geometry";

/** A quick reading between two points: the length, how far across and up, and the angle. */
export function tapeReading(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const n = (v: number) => Math.round(Math.abs(v)).toLocaleString("en-US");
  // The slope from the across direction, 0 to 90°, whichever way it was drawn.
  const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
  const parts = Math.abs(dx) >= 1 && Math.abs(dy) >= 1 ? ` (${n(dx)} across, ${n(dy)} up, ${Math.round(angle * 10) / 10}°)` : "";
  return `${n(Math.hypot(dx, dy))} mm${parts}`;
}

/** The area and perimeter of an outline clicked point by point, as AutoCAD's AREA reads it. */
export function areaReading(points: Point[]): string {
  let twice = 0;
  let around = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    twice += p.x * q.y - q.x * p.y;
    around += Math.hypot(q.x - p.x, q.y - p.y);
  });
  const m2 = Math.abs(twice) / 2 / 1_000_000;
  return `${m2.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m², perimeter ${Math.round(around).toLocaleString("en-US")} mm`;
}

/** Where a point is, as AutoCAD's ID reads it. */
export function pointReading(p: Point): string {
  const n = (v: number) => Math.round(v).toLocaleString("en-US");
  return `x ${n(p.x)}, y ${n(p.y)}`;
}
