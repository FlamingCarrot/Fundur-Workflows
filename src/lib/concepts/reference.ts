import sharp from "sharp";
import type { Plan } from "@/lib/plan/geometry";
const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
/** Geometry-only reference: excludes private notes, underlays, working references and alternative layouts. */
export function planReferenceSvg(plan: Plan, levelId: string) {
  const walls = plan.walls.filter((w) => w.levelId === levelId),
    rooms = plan.rooms.filter((r) => r.levelId === levelId),
    items = plan.items.filter((i) => i.levelId === levelId),
    columns = plan.columns.filter((c) => c.levelId === levelId);
  const points = [
    ...walls.flatMap((w) => [w.a, w.b]),
    ...rooms.flatMap((r) => r.points),
    ...items.flatMap((i) => [
      { x: i.at.x - i.width, y: i.at.y - i.depth },
      { x: i.at.x + i.width, y: i.at.y + i.depth },
    ]),
  ];
  if (!points.length)
    throw new Error(
      "Draw and save geometry on this floor before generating concepts.",
    );
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x)),
    minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  const padding = Math.max(maxX - minX, maxY - minY, 1000) * 0.07;
  const box = [
    minX - padding,
    -maxY - padding,
    maxX - minX + padding * 2,
    maxY - minY + padding * 2,
  ];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="${box.join(" ")}"><rect x="${box[0]}" y="${box[1]}" width="${box[2]}" height="${box[3]}" fill="white"/>`;
  for (const room of rooms) {
    svg += `<polygon points="${room.points.map((p) => `${p.x},${-p.y}`).join(" ")}" fill="#f3f0e7" stroke="#ccc" stroke-width="20"/>`;
    if (room.points.length) {
      const x = room.points.reduce((s, p) => s + p.x, 0) / room.points.length,
        y = room.points.reduce((s, p) => s + p.y, 0) / room.points.length;
      svg += `<text x="${x}" y="${-y}" text-anchor="middle" font-size="${Math.max(box[2] / 65, 90)}" fill="#333">${xml(room.name)}</text>`;
    }
  }
  for (const wall of walls)
    svg += `<line x1="${wall.a.x}" y1="${-wall.a.y}" x2="${wall.b.x}" y2="${-wall.b.y}" stroke="#333" stroke-width="${wall.thickness}"/>`;
  for (const opening of plan.openings) {
    const w = walls.find((w) => w.id === opening.wallId);
    if (!w) continue;
    const len = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    if (!len) continue;
    const pt = (d: number) => ({
        x: w.a.x + ((w.b.x - w.a.x) * d) / len,
        y: w.a.y + ((w.b.y - w.a.y) * d) / len,
      }),
      a = pt(opening.at - opening.width / 2),
      b = pt(opening.at + opening.width / 2);
    svg += `<line x1="${a.x}" y1="${-a.y}" x2="${b.x}" y2="${-b.y}" stroke="${opening.kind === "window" ? "#5a95ab" : "white"}" stroke-width="${w.thickness + 20}"/>`;
  }
  for (const c of columns)
    svg += `<rect x="${c.at.x - c.width / 2}" y="${-c.at.y - c.depth / 2}" width="${c.width}" height="${c.depth}" fill="#444"/>`;
  for (const i of items)
    svg += `<rect x="${i.at.x - i.width / 2}" y="${-i.at.y - i.depth / 2}" width="${i.width}" height="${i.depth}" transform="rotate(${-i.rotation} ${i.at.x} ${-i.at.y})" fill="${i.color ?? "#ddd8c8"}" stroke="#777" stroke-width="20"/>`;
  return svg + "</svg>";
}
export async function rasterPlan(plan: Plan, levelId: string) {
  const bytes = await sharp(Buffer.from(planReferenceSvg(plan, levelId)))
    .png()
    .toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}
