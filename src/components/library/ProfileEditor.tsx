"use client";

import React, { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { LATHE_PRESETS, OUTLINE_PRESETS, cleanProfile } from "@/lib/blueprints/forms";
import type { ProfilePoint } from "@/lib/blueprints/types";

/**
 * Draws a lathe's profile or an extrusion's outline and lets her shape it by
 * hand: drag a point, press on a line to add one there, pick a point and
 * remove it, or start from a preset. A lathe shows both sides of its
 * silhouette and is shaped on the right; an outline is seen from above.
 * Works with a finger as well as a mouse; the change is kept when she lets go.
 */

const PAD = 8;
const SNAP = 0.01;

export function ProfileEditor({
  kind,
  profile,
  aspect,
  onChange,
}: {
  kind: "lathe" | "extrude";
  profile: ProfilePoint[];
  /** The part's height over its width (lathe) or depth over width (outline), so the drawing keeps its proportions. */
  aspect: number;
  onChange: (profile: ProfilePoint[]) => void;
}) {
  const [draft, setDraft] = useState<ProfilePoint[] | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; moved: boolean } | null>(null);
  const points = draft ?? profile;
  const min = kind === "extrude" ? 3 : 2;
  // The drawing area: a lathe's silhouette is twice as wide as its profile.
  const W = 200;
  const ratio = Math.max(0.25, Math.min(4, aspect));
  const H = Math.round((kind === "lathe" ? W / 2 : W) * ratio);
  const box = { w: kind === "lathe" ? W / 2 : W, h: H };
  const toScreen = ([a, b]: ProfilePoint): [number, number] => (kind === "lathe" ? [PAD + W / 2 + a * box.w, PAD + (1 - b) * box.h] : [PAD + a * box.w, PAD + (1 - b) * box.h]);
  const fromEvent = (e: React.PointerEvent): ProfilePoint => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * (W + PAD * 2);
    const sy = ((e.clientY - r.top) / r.height) * (H + PAD * 2);
    const snap = (v: number) => Math.round(Math.max(0, Math.min(1, v)) / SNAP) * SNAP;
    return kind === "lathe" ? [snap((sx - PAD - W / 2) / box.w), snap(1 - (sy - PAD) / box.h)] : [snap((sx - PAD) / box.w), snap(1 - (sy - PAD) / box.h)];
  };
  const commit = (next: ProfilePoint[]) => {
    setDraft(null);
    const clean = cleanProfile(next);
    if (clean.length >= min) onChange(clean);
  };
  const startDrag = (e: React.PointerEvent, index: number, list: ProfilePoint[]) => {
    e.preventDefault();
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = { index, moved: false };
    setPicked(index);
    setDraft(list);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !draft) return;
    const p = fromEvent(e);
    drag.current.moved = true;
    setDraft(draft.map((q, i) => (i === drag.current!.index ? p : q)));
  };
  const onUp = () => {
    if (!drag.current) return;
    const moved = drag.current.moved;
    drag.current = null;
    if (draft && moved) commit(draft);
    else if (draft && draft.length !== profile.length) commit(draft);
    else setDraft(null);
  };
  const insertAt = (e: React.PointerEvent, after: number) => {
    const p = fromEvent(e);
    const list = [...points.slice(0, after + 1), p, ...points.slice(after + 1)];
    startDrag(e, after + 1, list);
  };
  const remove = () => {
    if (picked == null || points.length <= min) return;
    commit(points.filter((_, i) => i !== picked));
    setPicked(null);
  };

  const screen = points.map(toScreen);
  const closed = kind === "extrude";
  const path = screen.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + (closed ? " Z" : "");
  // A lathe's whole silhouette: the profile, the axis, and its mirror image.
  const mirror = kind === "lathe" ? screen.map(([x, y]) => [PAD + W / 2 - (x - PAD - W / 2), y] as [number, number]) : [];
  const silhouette = kind === "lathe" ? [...screen, ...[...mirror].reverse()].map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + " Z" : path;
  const segments = screen.map((a, i) => [a, screen[(i + 1) % screen.length], i] as const).filter((_, i) => closed || i < screen.length - 1);
  const presets = kind === "lathe" ? LATHE_PRESETS : OUTLINE_PRESETS;

  return (
    <div className="stack bp-profile" style={{ gap: "0.5rem" }}>
      <span className="field-label">{kind === "lathe" ? "Profile, turned about the middle" : "Outline from above"}</span>
      <div className="bp-profile-presets" role="group" aria-label="Start from">
        {presets.map((p) => (
          <button key={p.key} type="button" className="chip" onClick={() => commit(p.profile.map(([a, b]) => [a, b]))}>
            {p.label}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef}
        className="bp-profile-canvas"
        viewBox={`0 0 ${W + PAD * 2} ${H + PAD * 2}`}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label={kind === "lathe" ? "The profile: drag points to shape it" : "The outline: drag points to shape it"}
      >
        <rect x={PAD} y={PAD} width={W} height={H} className="bp-profile-frame" />
        {kind === "lathe" && <line x1={PAD + W / 2} y1={PAD - 4} x2={PAD + W / 2} y2={PAD + H + 4} className="bp-profile-axis" />}
        <path d={silhouette} className="bp-profile-fill" />
        {segments.map(([a, b, i]) => (
          <line key={`s${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="bp-profile-hit" onPointerDown={(e) => insertAt(e, i)} />
        ))}
        <path d={path} className="bp-profile-line" />
        {screen.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={picked === i ? 5.5 : 4.5} className="bp-profile-point" data-picked={picked === i || undefined} onPointerDown={(e) => startDrag(e, i, points)} />
        ))}
      </svg>
      <div className="row" style={{ gap: "0.4rem", alignItems: "center" }}>
        <span className="tiny muted grow">Drag a point; press a line to add one.</span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={picked == null || points.length <= min} onClick={remove}>
          <Trash2 size={13} /> Remove point
        </button>
      </div>
    </div>
  );
}
