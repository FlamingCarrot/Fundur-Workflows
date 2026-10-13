"use client";

import { useState } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, Boxes, ClipboardPaste, Columns3, CornerDownRight, EyeOff, Focus, Pin, PinOff, Scissors, SeparatorHorizontal, Check, Copy, CopyPlus, FlipHorizontal2, FlipVertical2, RotateCw, Trash2, X } from "lucide-react";
import type { EditResult, Plan, PlanItem } from "@/lib/plan/geometry";
import { isPinned, PINNABLE, pinMany } from "@/lib/plan/pins";
import { PHASED, PHASES, phaseOf, type Phase } from "@/lib/plan/phases";
import { offsetWall } from "@/lib/plan/wall-tools";
import { alignMany, arrayMany, describeSelection, distributeMany, duplicateMany, mirrorMany, removeMany, rotateMany, type AlignEdge } from "@/lib/plan/selection";

/**
 * What can be done to many things at once, as in Revit's Modify tab: mirror,
 * turn, align, space evenly, copy, paste, duplicate and remove. It floats over
 * the plan while more than one thing is selected; the same edits are on keys.
 */

const ALIGN: { edge: AlignEdge; label: string; icon: React.ReactNode }[] = [
  { edge: "left", label: "Line up left edges", icon: <AlignStartVertical size={16} /> },
  { edge: "centre", label: "Line up centres, across", icon: <AlignCenterVertical size={16} /> },
  { edge: "right", label: "Line up right edges", icon: <AlignEndVertical size={16} /> },
  { edge: "top", label: "Line up top edges", icon: <AlignStartHorizontal size={16} /> },
  { edge: "middle", label: "Line up middles, up and down", icon: <AlignCenterHorizontal size={16} /> },
  { edge: "bottom", label: "Line up bottom edges", icon: <AlignEndHorizontal size={16} /> },
];

export function PlanMultiBar({
  plan,
  selection,
  onEdit,
  onSelected,
  onClear,
  onCopy,
  onPaste,
  canPaste,
  onMakeBlueprint,
  onTool,
  onHide,
  onPhase,
}: {
  plan: Plan;
  selection: PlanItem[];
  onEdit: (r: EditResult) => string | null;
  /** The things the edit made, to select them instead. */
  onSelected: (made: PlanItem[]) => void;
  onClear: () => void;
  onCopy: () => void;
  onPaste: () => void;
  canPaste: boolean;
  /** Saves the selected furniture as one blueprint in the design library and puts it in their place. */
  onMakeBlueprint?: (name: string) => Promise<string | null>;
  /** Starts a wall tool: split (click where), trim (click the wall to meet). */
  onTool?: (tool: "split" | "trim") => void;
  /** Hides the selection for now, or shows only it. */
  onHide?: (mode: "hide" | "isolate") => void;
  /** Sets the phase of what is selected. */
  onPhase?: (phase: Phase) => void;
}) {
  const [offset, setOffset] = useState<{ by: string; side: 1 | -1 } | null>(null);
  // The phase of each selected thing that has one.
  const phases = selection.filter((t) => PHASED.has(t.kind)).map((t) => {
    const list: { id: string; phase?: "existing" | "demolished" }[] = t.kind === "wall" ? plan.walls : t.kind === "opening" ? plan.openings : t.kind === "column" ? plan.columns : plan.items;
    const found = list.find((x) => x.id === t.id);
    return found ? phaseOf(found) : null;
  }).filter((p): p is Phase => !!p);
  const oneWall = selection.length === 1 && selection[0].kind === "wall" ? selection[0] : null;
  // Which way "this side" is on screen, for the offset's two buttons (the plan's y runs up).
  const sides = (() => {
    const w = oneWall && plan.walls.find((x) => x.id === oneWall.id);
    if (!w) return ["One side", "Other side"];
    const nx = -(w.b.y - w.a.y);
    const ny = w.b.x - w.a.x;
    return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? ["Right", "Left"] : ["Left", "Right"]) : ny > 0 ? ["Above", "Below"] : ["Below", "Above"];
  })();
  const [aligning, setAligning] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [row, setRow] = useState<{ count: string; axis: "across" | "up"; gap: string } | null>(null);
  const repeat = () => {
    if (!row) return;
    const error = run(arrayMany(plan, selection, Number(row.count), { axis: row.axis, gap: Number(row.gap) || 0 }), "with");
    if (!error) setRow(null);
  };
  const [busy, setBusy] = useState(false);
  const pieces = selection.filter((s) => s.kind === "item").length;
  const pinnable = selection.filter((t) => PINNABLE.has(t.kind));
  const allPinned = pinnable.length > 0 && pinnable.every((t) => isPinned(plan, t));
  const make = async () => {
    if (!onMakeBlueprint || !naming?.trim() || busy) return;
    setBusy(true);
    const error = await onMakeBlueprint(naming.trim());
    setBusy(false);
    if (!error) setNaming(null);
  };
  const run = (r: EditResult, reselect: boolean | "with" = false) => {
    const error = onEdit(r);
    if (!error && r.ok && reselect && r.created) onSelected(reselect === "with" ? [...selection, ...r.created] : r.created);
    return error;
  };
  const b = (label: string, icon: React.ReactNode, onClick: () => void, extra?: { danger?: boolean; pressed?: boolean; key?: string }) => (
    <button key={label} type="button" className="icon-btn" aria-label={label} title={extra?.key ? `${label} (${extra.key})` : label} aria-pressed={extra?.pressed} style={extra?.danger ? { color: "var(--bad)" } : undefined} onClick={onClick}>
      {icon}
    </button>
  );
  return (
    <div className="plan-multibar" role="toolbar" aria-label="Selected things">
      <span className="small strong plan-multibar-count" title={describeSelection(plan, selection)}>
        {selection.length} selected
      </span>
      {b("Mirror left to right", <FlipHorizontal2 size={16} />, () => run(mirrorMany(plan, selection, "left-right")))}
      {b("Mirror top to bottom", <FlipVertical2 size={16} />, () => run(mirrorMany(plan, selection, "up-down")))}
      {b("Turn 90°", <RotateCw size={16} />, () => run(rotateMany(plan, selection, -90)), { key: "Space" })}
      {selection.length > 1 && b("Line up", <AlignStartVertical size={16} />, () => setAligning((a) => !a), { pressed: aligning })}
      {aligning && selection.length > 1 && (
        <span className="plan-multibar-more">
          {ALIGN.map((a) => b(a.label, a.icon, () => run(alignMany(plan, selection, a.edge))))}
          {b("Space evenly across", <AlignHorizontalSpaceAround size={16} />, () => run(distributeMany(plan, selection, "across")))}
          {b("Space evenly up and down", <AlignVerticalSpaceAround size={16} />, () => run(distributeMany(plan, selection, "up")))}
        </span>
      )}
      {b("Repeat in a row", <Columns3 size={16} />, () => setRow((r) => (r ? null : { count: "4", axis: "across", gap: "0" })), { pressed: !!row })}
      {row && (
        <form className="plan-multibar-more plan-multibar-name" onSubmit={(e) => { e.preventDefault(); repeat(); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setRow(null); }}>
          <label className="tiny strong plan-multibar-field">
            <input className="input" type="number" inputMode="numeric" min={2} max={100} aria-label="How many in the row, this one included" value={row.count} onChange={(e) => setRow({ ...row, count: e.target.value })} autoFocus />
            in a row
          </label>
          <button type="button" className="chip" aria-pressed={row.axis === "across"} onClick={() => setRow({ ...row, axis: "across" })}>Across</button>
          <button type="button" className="chip" aria-pressed={row.axis === "up"} onClick={() => setRow({ ...row, axis: "up" })}>Up</button>
          <label className="tiny strong plan-multibar-field">
            gap
            <input className="input" type="number" inputMode="numeric" aria-label="Gap between them in mm" value={row.gap} onChange={(e) => setRow({ ...row, gap: e.target.value })} />
            mm
          </label>
          <button type="submit" className="icon-btn" aria-label="Make the row" title="Make the row"><Check size={16} /></button>
        </form>
      )}
      {onMakeBlueprint && pieces > 0 && b("Make a blueprint from the furniture", <Boxes size={16} />, () => setNaming((n) => (n === null ? "" : null)), { pressed: naming !== null })}
      {naming !== null && (
        <form className="plan-multibar-more plan-multibar-name" onSubmit={(e) => { e.preventDefault(); void make(); }}>
          <input
            autoFocus
            className="input"
            aria-label="Blueprint name"
            placeholder={`Name for ${pieces} piece${pieces === 1 ? "" : "s"}`}
            value={naming}
            maxLength={80}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setNaming(null); }}
          />
          <button type="submit" className="icon-btn" aria-label="Save as a blueprint" title="Save as a blueprint" disabled={busy || !naming.trim()}><Check size={16} /></button>
        </form>
      )}
      {oneWall && onTool && b("Split the wall where you click", <Scissors size={16} />, () => onTool("split"))}
      {oneWall && onTool && b("Trim or extend to a corner with another wall", <CornerDownRight size={16} />, () => onTool("trim"))}
      {oneWall && b("Offset a copy", <SeparatorHorizontal size={16} />, () => setOffset((o) => (o ? null : { by: "1000", side: 1 })), { pressed: !!offset })}
      {oneWall && offset && (
        <form
          className="plan-multibar-more plan-multibar-name"
          onSubmit={(e) => {
            e.preventDefault();
            if (!run(offsetWall(plan, oneWall.id, offset.side * Number(offset.by)), true)) setOffset(null);
          }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") setOffset(null); }}
        >
          <label className="tiny strong plan-multibar-field">
            <input className="input" type="number" inputMode="numeric" aria-label="Offset in mm" value={offset.by} onChange={(e) => setOffset({ ...offset, by: e.target.value })} autoFocus />
            mm
          </label>
          <button type="button" className="chip" aria-pressed={offset.side === 1} onClick={() => setOffset({ ...offset, side: 1 })}>{sides[0]}</button>
          <button type="button" className="chip" aria-pressed={offset.side === -1} onClick={() => setOffset({ ...offset, side: -1 })}>{sides[1]}</button>
          <button type="submit" className="icon-btn" aria-label="Make the copy" title="Make the copy"><Check size={16} /></button>
        </form>
      )}
      {pinnable.length > 0 && b(allPinned ? "Unpin" : "Pin so it cannot move", allPinned ? <PinOff size={16} /> : <Pin size={16} />, () => run(pinMany(plan, selection, !allPinned)), { pressed: allPinned })}
      {onPhase && phases.length > 0 && (
        <select className="plan-multibar-phase" aria-label="Phase" title="Phase: existing, to demolish or new" value={phases.every((p) => p === phases[0]) ? phases[0] : ""} onChange={(e) => e.target.value && onPhase(e.target.value as Phase)}>
          {!phases.every((p) => p === phases[0]) && <option value="">Mixed phases</option>}
          {PHASES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      )}
      {onHide && b("Hide for now", <EyeOff size={16} />, () => onHide("hide"), { key: "H H" })}
      {onHide && b("Show only this for now", <Focus size={16} />, () => onHide("isolate"), { key: "H I" })}
      <span className="plan-multibar-sep" />
      {b("Copy", <Copy size={16} />, onCopy, { key: "Ctrl+C" })}
      {canPaste && b("Paste", <ClipboardPaste size={16} />, onPaste, { key: "Ctrl+V" })}
      {b("Duplicate", <CopyPlus size={16} />, () => run(duplicateMany(plan, selection), true), { key: "Ctrl+D" })}
      {b("Remove", <Trash2 size={16} />, () => !run(removeMany(plan, selection)) && onClear(), { danger: true, key: "Delete" })}
      {b("Clear the selection", <X size={16} />, onClear, { key: "Esc" })}
    </div>
  );
}
