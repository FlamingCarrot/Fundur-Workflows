"use client";

import { useState } from "react";
import { Download, FileUp, X } from "lucide-react";
import type { Plan } from "@/lib/plan/geometry";
import { PAPERS, planSheets, STANDARD_SCALES, type Paper, type SheetOptions } from "@/lib/plan/sheet";
import type { Resolver } from "@/lib/blueprints/resolve";
import { useViewSetting } from "@/lib/view-settings/client";
import { COLOUR_BY, type ColourBy } from "@/lib/plan/colour-fill";
import type { PhaseView } from "@/lib/plan/phases";

/**
 * Prints the plan as drawing sheets: each floor to scale on a paper size with
 * a title block, as a vector PDF to download or keep with the project's files.
 * The choices are remembered.
 */

export interface SheetChoice {
  paper: Paper;
  scale: number | "fit";
  floors: "this" | "all";
  title: string;
  number: string;
  revision: string;
  with3d: boolean;
  /** Tint rooms as the colour fill on screen. */
  colour?: boolean;
}

export const SHEET_DEFAULT: SheetChoice = { paper: "A3", scale: "fit", floors: "this", title: "General arrangement", number: "A-101", revision: "", with3d: false };
const isChoice = (v: unknown): v is SheetChoice => {
  const c = v as SheetChoice | null;
  return !!c && typeof c === "object" && c.paper in PAPERS && (c.scale === "fit" || STANDARD_SCALES.includes(c.scale as never)) && (c.floors === "this" || c.floors === "all") && typeof c.title === "string" && typeof c.number === "string";
};

/** Makes the PDF for a choice; the 3D view, when wanted, is taken by the caller. */
export function sheetPdf(plan: Plan, lib: Resolver, choice: SheetChoice, ctx: { levelId: string; projectName: string; practice?: string; views?: SheetOptions["views"]; colourBy?: ColourBy; phase?: PhaseView; marks?: boolean }) {
  return planSheets(
    plan,
    {
      paper: choice.paper,
      scale: choice.scale,
      projectName: ctx.projectName,
      title: choice.title.trim() || undefined,
      practice: ctx.practice,
      number: choice.number.trim() || "A-101",
      revision: choice.revision.trim() || undefined,
      levelIds: choice.floors === "this" ? [ctx.levelId] : undefined,
      views: ctx.views,
      colourBy: choice.colour ? ctx.colourBy : undefined,
      phase: ctx.phase,
      marks: ctx.marks,
    },
    lib,
  );
}

export function SheetsSheet({
  plan,
  lib,
  levelId,
  levelName,
  projectName,
  practice,
  can3d,
  capture3d,
  colourBy,
  phase,
  marks,
  onClose,
  onKeep,
}: {
  plan: Plan;
  lib: Resolver;
  levelId: string;
  levelName: string;
  projectName: string;
  practice?: string;
  /** Whether the 3D view is open, so it can be added. */
  can3d: boolean;
  capture3d: () => { jpeg: Uint8Array; width: number; height: number } | null;
  /** The colour fill on screen, offered for the sheets. */
  colourBy: ColourBy;
  /** The phases shown on screen, drawn the same way. */
  phase?: PhaseView;
  /** Whether door and window marks show on screen, and so on the sheets. */
  marks?: boolean;
  onClose: () => void;
  onKeep: (file: File) => Promise<void>;
}) {
  const [choice, setChoice] = useViewSetting<SheetChoice>("plan.sheet", SHEET_DEFAULT, isChoice);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<SheetChoice>) => {
    setError(null);
    setChoice({ ...choice, ...patch });
  };
  const make = () => {
    const shot = choice.with3d && can3d ? capture3d() : null;
    const r = sheetPdf(plan, lib, choice, { levelId, projectName, practice, colourBy, phase, marks, views: shot ? [{ ...shot, title: "3D view" }] : undefined });
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    const name = `${projectName} ${choice.title || "Drawings"} ${choice.number}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
    return new File([r.pdf as BlobPart], name, { type: "application/pdf" });
  };
  const download = () => {
    const file = make();
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };
  const keep = async () => {
    const file = make();
    if (!file) return;
    setBusy(true);
    try {
      await onKeep(file);
      onClose();
    } finally {
      setBusy(false);
    }
  };
  const levels = plan.levels.length;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet plan-sheets" role="dialog" aria-label="Print sheets" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="row-between" style={{ marginBottom: "0.25rem" }}>
          <h2 className="display-s">Sheets</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <X size={18} />
          </button>
        </div>
        <p className="small muted">Each floor drawn to scale with a title block, as a PDF that prints sharp.</p>
        <div className="stack" style={{ gap: "0.35rem" }}>
          <span className="tiny strong">Paper</span>
          <div className="chip-row" role="group" aria-label="Paper">
            {(Object.keys(PAPERS) as Paper[]).map((p) => (
              <button key={p} type="button" className="chip" aria-pressed={choice.paper === p} onClick={() => set({ paper: p })}>{p}</button>
            ))}
          </div>
        </div>
        <div className="stack" style={{ gap: "0.35rem" }}>
          <span className="tiny strong">Scale</span>
          <div className="chip-row" role="group" aria-label="Scale">
            <button type="button" className="chip" aria-pressed={choice.scale === "fit"} onClick={() => set({ scale: "fit" })}>Fit</button>
            {[20, 50, 100, 200].map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={choice.scale === s} onClick={() => set({ scale: s })}>1:{s}</button>
            ))}
          </div>
        </div>
        {levels > 1 && (
          <div className="chip-row" role="group" aria-label="Floors">
            <button type="button" className="chip" aria-pressed={choice.floors === "this"} onClick={() => set({ floors: "this" })}>{levelName}</button>
            <button type="button" className="chip" aria-pressed={choice.floors === "all"} onClick={() => set({ floors: "all" })}>Every floor, a sheet each</button>
          </div>
        )}
        <div className="plan-sheets-fields">
          <label className="stack tiny strong" style={{ gap: "0.3rem" }}>
            Drawing title
            <input className="input" value={choice.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label className="stack tiny strong" style={{ gap: "0.3rem" }}>
            Sheet number
            <input className="input" value={choice.number} maxLength={20} onChange={(e) => set({ number: e.target.value })} />
          </label>
          <label className="stack tiny strong" style={{ gap: "0.3rem" }}>
            Revision
            <input className="input" value={choice.revision} maxLength={10} placeholder="-" onChange={(e) => set({ revision: e.target.value })} />
          </label>
        </div>
        {colourBy !== "none" && (
          <label className="row small" style={{ gap: "0.5rem" }}>
            <input type="checkbox" checked={!!choice.colour} onChange={(e) => set({ colour: e.target.checked })} />
            Colour the rooms by {COLOUR_BY.find((c) => c.key === colourBy)?.label.toLowerCase()}, with a legend
          </label>
        )}
        <label className="row small" style={{ gap: "0.5rem", opacity: can3d ? 1 : 0.6 }}>
          <input type="checkbox" checked={choice.with3d && can3d} disabled={!can3d} onChange={(e) => set({ with3d: e.target.checked })} />
          Add the 3D view as it is now on a sheet of its own{can3d ? "" : " (open 3D first)"}
        </label>
        {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
        <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void keep()}><FileUp size={15} /> Keep in files</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={download}><Download size={15} /> Download PDF</button>
        </div>
      </div>
    </>
  );
}
