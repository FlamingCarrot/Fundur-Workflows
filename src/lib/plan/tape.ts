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
