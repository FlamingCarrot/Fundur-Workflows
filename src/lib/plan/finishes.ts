import { ceilingHeight } from "./ceilings";
import { levelOf, polygonArea, wallLength, type EditResult, type Plan, type Point, type Room } from "./geometry";
import { wallPieces } from "./scene";
import type { Resolver } from "@/lib/blueprints/resolve";

/**
 * Wall finishes per room: paint, tiles or panelling on the faces of the
 * walls round a room, up to its ceiling, with the doors and windows left
 * open. Each face is its own panel, so the kitchen's tiles and the meeting
 * room's paint can sit on the two sides of one partition.
 */

export interface FinishPanel {
  wallId: string;
  /** The panel's ends on the room's face of the wall (mm, plan coordinates). */
  a: Point;
  b: Point;
  /** Above the floor (mm). */
  bottom: number;
  top: number;
}

const NEAR = 5;

/** The faces of the walls round a room, cut round its doors and windows, up to its ceiling. */
export function wallFinishPanels(plan: Plan, room: Room): FinishPanel[] {
  const pts = room.points;
  if (pts.length < 3) return [];
  // Anticlockwise rooms have their inside on the left of each edge.
  const signed = pts.reduce((s, p, i) => s + (p.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * p.y), 0);
  const inside = signed > 0 ? 1 : -1;
  const level = levelOf(plan, room.levelId);
  const ceiling = ceilingHeight(plan, room);
  const walls = plan.walls.filter((w) => w.levelId === room.levelId);
  const out: FinishPanel[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1) continue;
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    const n = { x: -u.y * inside, y: u.x * inside };
    for (const w of walls) {
      const off = (r: Point) => Math.abs((r.x - p.x) * u.y - (r.y - p.y) * u.x);
      if (off(w.a) > NEAR || off(w.b) > NEAR) continue;
      const along = (r: Point) => (r.x - p.x) * u.x + (r.y - p.y) * u.y;
      // At the room's corners the face stops at the wall across it (taken as this wall's thickness).
      const lo = Math.max(0, Math.min(along(w.a), along(w.b))) + (Math.min(along(w.a), along(w.b)) <= 1 ? w.thickness / 2 : 0);
      const hi = Math.min(len, Math.max(along(w.a), along(w.b))) - (Math.max(along(w.a), along(w.b)) >= len - 1 ? w.thickness / 2 : 0);
      if (hi - lo < 10) continue;
      // In the wall's own measure from its start, which is how its openings are placed.
      const L = wallLength(w);
      const wu = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
      const toWall = (t: number) => ((p.x + u.x * t - w.a.x) * wu.x + (p.y + u.y * t - w.a.y) * wu.y);
      const [s0, s1] = [toWall(lo), toWall(hi)].sort((x, y) => x - y);
      const height = Math.min(ceiling, w.height ?? level.height);
      const face = w.thickness / 2 + 1;
      for (const piece of wallPieces(w, plan.openings, height)) {
        const from = Math.max(piece.from, s0);
        const to = Math.min(piece.to, s1);
        if (to - from < 1) continue;
        const at = (s: number) => ({ x: w.a.x + wu.x * s + n.x * face, y: w.a.y + wu.y * s + n.y * face });
        out.push({ wallId: w.id, a: at(from), b: at(to), bottom: piece.bottom, top: piece.top });
      }
    }
  }
  return out;
}

/** The area of a room's wall finish, in m². */
export function wallFinishArea(plan: Plan, room: Room): number {
  const mm2 = wallFinishPanels(plan, room).reduce((s, f) => s + Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y) * (f.top - f.bottom), 0);
  return Math.round(mm2 / 1e4) / 100;
}

/** Sets or clears a room's wall finish. */
export function setRoomWalls(plan: Plan, lib: Resolver, roomId: string, materialId: string | null): EditResult {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "That room is no longer on the plan." };
  if (materialId && !lib.material(materialId)) return { ok: false, error: "That material is not in the library." };
  if ((room.wallMaterial ?? null) === materialId) return { ok: true, plan, summary: "" };
  const next = { ...room };
  if (materialId) next.wallMaterial = materialId;
  else delete next.wallMaterial;
  if (materialId && !wallFinishPanels(plan, room).length && polygonArea(room.points) > 0)
    return { ok: false, error: `${room.name} has no walls drawn round it to finish.` };
  return {
    ok: true,
    plan: { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? next : r)) },
    summary: materialId ? `${room.name} walls finished in ${lib.material(materialId)!.name.toLowerCase()}` : `${room.name} wall finish removed`,
  };
}
