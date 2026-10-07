"use client";
import { useState } from "react";
import type { Plan, Point } from "@/lib/plan/geometry";
export function SharedPlan({ plan }: { plan: Plan }) {
  const [level, setLevel] = useState(plan.levels[0]?.id ?? "");
  const walls = plan.walls.filter((w) => w.levelId === level);
  const rooms = plan.rooms.filter((r) => r.levelId === level);
  const items = plan.items.filter((i) => i.levelId === level);
  const columns = plan.columns.filter((c) => c.levelId === level);
  const points: Point[] = [
    ...walls.flatMap((w) => [w.a, w.b]),
    ...rooms.flatMap((r) => r.points),
    ...items.flatMap((i) => [
      { x: i.at.x - i.width, y: i.at.y - i.depth },
      { x: i.at.x + i.width, y: i.at.y + i.depth },
    ]),
    ...columns.map((c) => c.at),
  ];
  const minX = Math.min(0, ...points.map((p) => p.x)) - 800,
    maxX = Math.max(1000, ...points.map((p) => p.x)) + 800,
    minY = Math.min(0, ...points.map((p) => p.y)) - 800,
    maxY = Math.max(1000, ...points.map((p) => p.y)) + 800;
  return (
    <section>
      <label className="field" style={{ maxWidth: 280 }}>
        <span className="field-label">Floor</span>
        <select
          className="input"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          {plan.levels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <svg
        className="shared-plan"
        viewBox={`${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`}
        role="img"
        aria-label={`Floor plan: ${plan.levels.find((l) => l.id === level)?.name ?? ""}`}
      >
        <g transform="scale(1,-1)">
          {rooms.map((r) => (
            <g key={r.id}>
              <polygon
                points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill={r.usable ? "#f6f6f2" : "#e8e8e5"}
                stroke="#aaa"
                strokeWidth={20}
              />
              {r.points.length > 0 && (
                <text
                  x={r.points.reduce((v, p) => v + p.x, 0) / r.points.length}
                  y={-r.points.reduce((v, p) => v + p.y, 0) / r.points.length}
                  transform="scale(1,-1)"
                  textAnchor="middle"
                  fontSize={180}
                  fill="#555"
                >
                  {r.name}
                </text>
              )}
            </g>
          ))}
          {walls.map((w) => (
            <line
              key={w.id}
              x1={w.a.x}
              y1={w.a.y}
              x2={w.b.x}
              y2={w.b.y}
              stroke="#292923"
              strokeWidth={w.thickness}
              strokeLinecap="square"
            />
          ))}
          {plan.openings.map((o) => {
            const w = walls.find((w) => w.id === o.wallId);
            if (!w) return null;
            const dx = w.b.x - w.a.x,
              dy = w.b.y - w.a.y,
              length = Math.hypot(dx, dy);
            if (!length) return null;
            const a = o.at - o.width / 2,
              b = o.at + o.width / 2;
            return (
              <line
                key={o.id}
                x1={w.a.x + (dx * a) / length}
                y1={w.a.y + (dy * a) / length}
                x2={w.a.x + (dx * b) / length}
                y2={w.a.y + (dy * b) / length}
                stroke={o.kind === "window" ? "#75a3ae" : "#fff"}
                strokeWidth={w.thickness + 10}
              />
            );
          })}
          {columns.map((c) =>
            c.round ? (
              <circle
                key={c.id}
                cx={c.at.x}
                cy={c.at.y}
                r={c.width / 2}
                fill="#444"
              />
            ) : (
              <rect
                key={c.id}
                x={c.at.x - c.width / 2}
                y={c.at.y - c.depth / 2}
                width={c.width}
                height={c.depth}
                fill="#444"
              />
            ),
          )}
          {items.map((i) => (
            <g
              key={i.id}
              transform={`translate(${i.at.x} ${i.at.y}) rotate(${i.rotation})`}
            >
              <rect
                x={-i.width / 2}
                y={-i.depth / 2}
                width={i.width}
                height={i.depth}
                fill="#e1e7d6"
                stroke="#626e51"
                strokeWidth={25}
              />
              {i.label && (
                <text
                  transform="scale(1,-1)"
                  textAnchor="middle"
                  fontSize={140}
                  fill="#333"
                >
                  {i.label}
                </text>
              )}
            </g>
          ))}
          {plan.dimensions
            .filter((d) => d.levelId === level)
            .map((d) => (
              <g key={d.id}>
                <line
                  x1={d.a.x}
                  y1={d.a.y}
                  x2={d.b.x}
                  y2={d.b.y}
                  stroke="#888"
                  strokeWidth={15}
                />
                <text
                  x={(d.a.x + d.b.x) / 2}
                  y={-(d.a.y + d.b.y) / 2 - 80}
                  transform="scale(1,-1)"
                  fontSize={140}
                  textAnchor="middle"
                >
                  {Math.round(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y))} mm
                </text>
              </g>
            ))}
        </g>
      </svg>
      <p className="small muted">
        Drawing dimensions are in millimetres. Print scaling follows your
        printer settings.
      </p>
    </section>
  );
}
