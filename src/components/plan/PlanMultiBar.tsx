"use client";

import { useState } from "react";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround, ClipboardPaste, Copy, CopyPlus, FlipHorizontal2, FlipVertical2, RotateCw, Trash2, X } from "lucide-react";
import type { EditResult, Plan, PlanItem } from "@/lib/plan/geometry";
import { alignMany, describeSelection, distributeMany, duplicateMany, mirrorMany, removeMany, rotateMany, type AlignEdge } from "@/lib/plan/selection";

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
}) {
  const [aligning, setAligning] = useState(false);
  const run = (r: EditResult, reselect = false) => {
    const error = onEdit(r);
    if (!error && r.ok && reselect && r.created) onSelected(r.created);
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
      {b("Line up", <AlignStartVertical size={16} />, () => setAligning((a) => !a), { pressed: aligning })}
      {aligning && (
        <span className="plan-multibar-more">
          {ALIGN.map((a) => b(a.label, a.icon, () => run(alignMany(plan, selection, a.edge))))}
          {b("Space evenly across", <AlignHorizontalSpaceAround size={16} />, () => run(distributeMany(plan, selection, "across")))}
          {b("Space evenly up and down", <AlignVerticalSpaceAround size={16} />, () => run(distributeMany(plan, selection, "up")))}
        </span>
      )}
      <span className="plan-multibar-sep" />
      {b("Copy", <Copy size={16} />, onCopy, { key: "Ctrl+C" })}
      {canPaste && b("Paste", <ClipboardPaste size={16} />, onPaste, { key: "Ctrl+V" })}
      {b("Duplicate", <CopyPlus size={16} />, () => run(duplicateMany(plan, selection), true), { key: "Ctrl+D" })}
      {b("Remove", <Trash2 size={16} />, () => !run(removeMany(plan, selection)) && onClear(), { danger: true, key: "Delete" })}
      {b("Clear the selection", <X size={16} />, onClear, { key: "Esc" })}
    </div>
  );
}
