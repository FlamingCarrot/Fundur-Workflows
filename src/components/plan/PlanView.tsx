"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Armchair,
  Check,
  Columns2,
  DoorOpen,
  Download,
  GitCompare,
  History,
  Keyboard,
  LayoutGrid,
  Layers as LayersIcon,
  Maximize,
  MousePointer2,
  PenLine,
  PenTool,
  Redo2,
  RefreshCw,
  Ruler,
  Shapes,
  SplitSquareVertical,
  Square,
  SquareDashed,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { IssueMarker } from "@/components/ui/IssueMarker";
import { MissingProject } from "@/components/views/MissingProject";
import { exportDxf, importDxf } from "@/lib/plan/dxf";
import { calibrateUnderlay, setUnderlay, sortedLevels } from "@/lib/plan/elements";
import {
  diffPlans,
  emptyPlan,
  isEmptyPlan,
  m2,
  mm,
  onLevel,
  planBounds,
  samplePlan,
  distance,
  type EditResult,
  type Plan,
  type PlanItem,
  type Point,
} from "@/lib/plan/geometry";
import { exportIfc } from "@/lib/plan/ifc";
import type { PlanVersionSummary } from "@/lib/plan/types";
import { relativeTime } from "@/lib/studio/format";
import type { Project, ProjectDocument } from "@/lib/studio/types";
import { downloadHref, uploadToProject } from "@/lib/studio/uploads";
import { getWorkflow, label } from "@/lib/workflow";
import { isStringOrNull, useViewSetting } from "@/lib/view-settings/client";
import { LIBRARY } from "@/lib/plan/library";
import { ALL_LAYERS, PlanCanvas, type Layers, type Tool } from "./PlanCanvas";
import { Inspector } from "./PlanInspector";
import { IssueList } from "@/components/layout/LayoutParts";
import { checkLayout } from "@/lib/layout/check";
import { intoLayout, withLayout } from "@/lib/layout/options";
import { usePlanEditor, type PlanSaveStatus } from "./usePlanEditor";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { exists } from "@/lib/plan/selection";

const NUDGES = [1, 5, 10, 50, 100];
const isNudge = (v: unknown): v is number => typeof v === "number" && NUDGES.includes(v);


/** The phase whose screen links to the plan, so closing the editor goes back there. */
function planPhase(project: Project) {
  return getWorkflow(project).phases.find((p) => p.modules.some((m) => m.startsWith("floor_plan_editor")));
}

export function PlanView({ projectId, layoutId }: { projectId: string; layoutId?: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  if (ready && !project) return <main className="page"><MissingProject /></main>;
  return <WhenReady ready={ready}>{project && <PlanEditor project={project} layoutId={layoutId} />}</WhenReady>;
}

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Select", key: "V", icon: <MousePointer2 size={16} /> },
  { tool: "wall", label: "Wall", key: "W", icon: <PenLine size={16} /> },
  { tool: "partition", label: "Partition", key: "P", icon: <SplitSquareVertical size={16} /> },
  { tool: "door", label: "Door", key: "D", icon: <DoorOpen size={16} /> },
  { tool: "window", label: "Window", key: "N", icon: <Columns2 size={16} /> },
  { tool: "column", label: "Column", key: "C", icon: <Square size={16} /> },
  { tool: "room", label: "Room", key: "R", icon: <Shapes size={16} /> },
  { tool: "outline", label: "Outline", key: "O", icon: <PenTool size={16} /> },
  { tool: "item", label: "Furniture", key: "I", icon: <Armchair size={16} /> },
  { tool: "note", label: "Note", key: "T", icon: <Type size={16} /> },
  { tool: "dimension", label: "Measure", key: "M", icon: <Ruler size={16} /> },
];

// Remembered layers count only if they name every layer there is now.
const isLayers = (v: unknown): v is Layers =>
  !!v && typeof v === "object" && (Object.keys(ALL_LAYERS) as (keyof Layers)[]).every((k) => typeof (v as Layers)[k] === "boolean");
const isLibraryType = (v: unknown): v is string => typeof v === "string" && LIBRARY.some((i) => i.type === v);

const LAYER_NAMES: Record<keyof Layers, string> = {
  walls: "Walls",
  openings: "Doors and windows",
  columns: "Columns",
  rooms: "Rooms",
  furniture: "Furniture",
  notes: "Notes",
  dimensions: "Dimensions",
  underlay: "Tracing image",
  below: "Floor below",
  reference: "Imported lines",
};

/** Saves text as a file download. */
function save(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** An image's size in pixels, and in the demo a copy small enough to keep in this browser. */
async function readImage(file: File, keepCopy: boolean): Promise<{ width: number; height: number; src?: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!keepCopy) return { width: img.naturalWidth, height: img.naturalHeight };
    const k = Math.min(1, 2_000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { width: img.naturalWidth, height: img.naturalHeight, src: canvas.toDataURL("image/jpeg", 0.8) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function PlanEditor({ project, layoutId }: { project: Project; layoutId?: string }) {
  const { toast, fileStorage, addDocuments } = useStudio();
  const editor = usePlanEditor(project.id);
  const [tool, setTool] = useState<Tool>("select");
  const [picked, setSelection] = useState<PlanItem[]>([]);
  const [layers, setLayers] = useViewSetting<Layers>("plan.layers", ALL_LAYERS, isLayers);
  const [nudge, setNudge] = useViewSetting<number>("plan.nudge", 10, isNudge);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [compare, setCompare] = useState<{ label: string; plan: Plan } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [pendingImport, setPendingImport] = useState<{ plan: Plan; name: string } | null>(null);
  const [levelPick, setLevel] = useViewSetting<string | null>(`plan.${project.id}.level`, null, isStringOrNull);
  const [placeType, setPlaceType] = useViewSetting("plan.placeType", "desk", isLibraryType);
  const [calibration, setCalibration] = useState<{ a: Point; b: Point } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [underlayBusy, setUnderlayBusy] = useState(false);
  // Images uploaded in this session, shown from memory while storage catches up.
  const [localImages, setLocalImages] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const phase = planPhase(project);
  const base = editor.plan;
  // An option opened from the layout screen: its furniture is shown and edited in place of the plan's own.
  const layout = layoutId && base ? base.layouts.find((l) => l.id === layoutId) : undefined;
  const layoutGone = !!layoutId && !!base && !layout;
  const plan = useMemo(() => (base && layout ? withLayout(base, layout) : base), [base, layout]);
  const exitHref = layoutId ? `/projects/${project.id}/layout` : `/projects/${project.id}/phases/${phase?.key ?? project.currentPhase}`;
  const planTitle = label(project, "floor_plan", "Floor plan");
  const title = layout ? `${layout.name}, ${planTitle.toLowerCase()}` : planTitle;

  // The floor shown: the option's, the one picked, or the lowest when that floor has gone.
  const levels = useMemo(() => (plan ? sortedLevels(plan) : []), [plan]);
  const levelId = (layout && levels.find((l) => l.id === layout.levelId)?.id) || (levels.find((l) => l.id === levelPick)?.id ?? levels[0]?.id ?? "");
  const level = levels.find((l) => l.id === levelId);

  // While an option is open, every change is checked against the rules it was made with (P4-04).
  const report = useMemo(
    () =>
      layout && plan
        ? checkLayout(onLevel(plan, layout.levelId), { rules: layout.rules, headcount: layout.headcount, adjacencies: layout.adjacencies })
        : null,
    [layout, plan]
  );
  const flagged = useMemo(() => (report ? new Set(report.issues.flatMap((i) => i.itemIds)) : undefined), [report]);

  // Edits are made on the plan as shown; with an option open, its furniture goes back into the option.
  const onEdit = (result: EditResult) => editor.apply(layout && base ? intoLayout(base, layout.id, result) : result);

  // The selection loses what has gone (an undo, a restore, a delete), and everything when the floor changes.
  const selection = useMemo(() => {
    if (!plan) return [];
    const here = onLevel(plan, levelId);
    return picked.filter((t) => exists(here, t));
  }, [picked, plan, levelId]);

  // Keyboard shortcuts for tools and undo, unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        editor.redo();
        return;
      }
      if (e.key === "?") {
        setShortcutsOpen(true);
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t && plan) setTool(t.tool);
      if (e.key.toLowerCase() === "f" && plan) setFitSignal((n) => n + 1);
      // Page Up and Page Down go up and down the floors.
      if ((e.key === "PageUp" || e.key === "PageDown") && levels.length > 1) {
        const i = levels.findIndex((l) => l.id === levelId);
        const next = levels[Math.max(0, Math.min(levels.length - 1, i + (e.key === "PageUp" ? 1 : -1)))];
        setLevel(next.id);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, plan, levels, levelId, setLevel]);

  const startWith = (next: Plan, summary: string, drawTool: Tool = "select") => {
    editor.replace(next, summary);
    setSelection([]);
    setTool(drawTool);
    setFitSignal((n) => n + 1);
  };

  const readFile = async (file: File) => {
    if (!/\.dxf$/i.test(file.name)) {
      toast("Only DXF files can be read for now. Save the plan as DXF from your CAD software.");
      return;
    }
    try {
      const { plan: imported, warnings } = importDxf(await file.text(), file.name);
      if (plan && !isEmptyPlan(plan)) setPendingImport({ plan: imported, name: file.name });
      else {
        startWith(imported, `Imported ${file.name}`);
        toast(warnings.length ? `${file.name} loaded with ${warnings.length} note${warnings.length === 1 ? "" : "s"} to check` : `${file.name} loaded`);
      }
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const fileBase = `${project.id}-floor-plan`;
  const downloadDxf = () => {
    if (!plan || !level) return;
    const suffix = levels.length > 1 ? `-${level.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    save(exportDxf(onLevel(plan, levelId)), `${fileBase}${suffix}.dxf`, "application/dxf");
    setExportOpen(false);
  };
  const downloadIfc = () => {
    if (!plan) return;
    save(exportIfc(plan, { projectName: project.name, description: `${title}, exported from Fundur` }), `${fileBase}.ifc`, "application/x-step");
    setExportOpen(false);
  };

  /** Lays a photo or scan under this floor, sized to the drawing (or 20 m wide), to trace and then scale. */
  const addImage = async (file: File) => {
    if (!plan || !level) return;
    if (!file.type.startsWith("image/")) {
      toast("Choose a photo or an image file (PNG or JPEG). Save a PDF page as an image first.");
      return;
    }
    setUnderlayBusy(true);
    try {
      const image = await readImage(file, !fileStorage);
      let documentId: string | undefined;
      if (fileStorage) {
        const storageKey = await uploadToProject(project.id, file);
        const doc: ProjectDocument = {
          id: crypto.randomUUID(),
          name: file.name,
          sizeBytes: file.size,
          phaseKey: phase?.key ?? project.currentPhase,
          uploadedAt: new Date().toISOString(),
          clientVisible: false,
          storageKey,
          stored: true,
          version: 1,
        };
        addDocuments(project.id, [doc]);
        documentId = doc.id;
        const shown = URL.createObjectURL(file);
        setLocalImages((m) => ({ ...m, [doc.id]: shown }));
      }
      const b = planBounds(onLevel(plan, levelId));
      const width = b ? Math.max(b.maxX - b.minX, 2_000) : 20_000;
      const result = setUnderlay(plan, {
        levelId,
        name: file.name.slice(0, 255),
        ...(documentId ? { documentId } : { src: image.src }),
        at: b ? { x: b.minX, y: b.minY } : { x: 0, y: 0 },
        width,
        pixelWidth: image.width,
        pixelHeight: image.height,
        opacity: 0.5,
      });
      const error = onEdit(result);
      if (error) toast(error);
      else {
        setFitSignal((n) => n + 1);
        toast(`${file.name} added under ${level.name}${documentId ? " and kept with the project's documents" : ""}. Set its scale next.`);
      }
    } catch (err) {
      toast((err as Error).message || "The image could not be added");
    } finally {
      setUnderlayBusy(false);
    }
  };


  if (editor.loaded === "loading") {
    return (
      <PlanFrame exitHref={exitHref} title={title} project={project} status="saved">
        <div className="plan-empty"><p className="muted">Loading the plan…</p></div>
      </PlanFrame>
    );
  }
  if (editor.loaded === "failed") {
    return (
      <PlanFrame exitHref={exitHref} title={title} project={project} status="error">
        <div className="plan-empty">
          <p className="small" role="alert">The plan could not be loaded. Check your connection and reload the page.</p>
        </div>
      </PlanFrame>
    );
  }

  const fileInput = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".dxf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void readFile(file);
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void addImage(file);
        }}
      />
    </>
  );

  if (!plan) {
    return (
      <PlanFrame exitHref={exitHref} title={title} project={project} status={editor.status}>
        {fileInput}
        <div className="plan-empty">
          <div className="stack" style={{ gap: "1.25rem", maxWidth: 520 }}>
            <div className="stack" style={{ gap: "0.5rem" }}>
              <p className="eyebrow">{project.name}</p>
              <h1 className="display-m">Start the {title.toLowerCase()}</h1>
              <p className="muted">
                Load the plan you received, or draw it from scratch with typed measurements. Every change saves as you go.
              </p>
            </div>
            <div className="stack" style={{ gap: "0.6rem" }}>
              <button type="button" className="card card-link tool" onClick={() => fileRef.current?.click()}>
                <span className="fact-icon"><Upload size={16} /></span>
                <span className="stack" style={{ gap: "0.2rem", textAlign: "left" }}>
                  <span className="small strong">Import a DXF file</span>
                  <span className="tiny muted">Walls, rooms, doors and columns are read from their layers.</span>
                </span>
              </button>
              <button type="button" className="card card-link tool" onClick={() => startWith(emptyPlan(), "Started a new plan", "wall")}>
                <span className="fact-icon"><PenLine size={16} /></span>
                <span className="stack" style={{ gap: "0.2rem", textAlign: "left" }}>
                  <span className="small strong">Draw it from scratch</span>
                  <span className="tiny muted">Click the corners and type each wall&apos;s length.</span>
                </span>
              </button>
              <button type="button" className="card card-link tool" onClick={() => startWith(samplePlan(), "Started from the sample floor plate")}>
                <span className="fact-icon"><SquareDashed size={16} /></span>
                <span className="stack" style={{ gap: "0.2rem", textAlign: "left" }}>
                  <span className="small strong">Try it on a sample floor plate</span>
                  <span className="tiny muted">An 18 m by 12 m office to practise on. You can start over afterwards.</span>
                </span>
              </button>
            </div>
            <p className="tiny muted">
              Got a DWG, Revit or PDF file? Save it as DXF from your CAD software for now. Other formats come once your real
              files have been tested.
            </p>
          </div>
        </div>
      </PlanFrame>
    );
  }

  // Worked out on every render, so it follows edits made while comparing.
  const diffRows = compare ? diffPlans(compare.plan, plan) : undefined;
  const underlay = plan.underlays.find((u) => u.levelId === levelId);
  const underlaySrc = underlay?.documentId ? (localImages[underlay.documentId] ?? downloadHref(project.id, underlay.documentId)) : underlay?.src;

  return (
    <PlanFrame
      exitHref={exitHref}
      title={title}
      project={project}
      status={editor.status}
      onRetry={editor.retry}
      actions={
        <>
          <button type="button" className="icon-btn" onClick={editor.undo} disabled={!editor.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={editor.redo} disabled={!editor.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={17} />
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVersionsOpen(true)} aria-label="Versions">
            <History size={15} /> <span className="plan-label">Versions</span>
          </button>
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Import a DXF file" title="Import a DXF file">
            <Upload size={17} />
          </button>
          <div style={{ position: "relative" }}>
            <button type="button" className="icon-btn" onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen} aria-label="Export" title="Export">
              <Download size={17} />
            </button>
            {exportOpen && (
              <div className="plan-popover plan-popover-right" role="menu" aria-label="Export">
                <button type="button" role="menuitem" className="plan-menu-item" onClick={downloadDxf}>
                  <span className="small strong">DXF{levels.length > 1 ? `, ${level?.name}` : ""}</span>
                  <span className="tiny muted">For AutoCAD and other CAD software. One floor per file.</span>
                </button>
                <button type="button" role="menuitem" className="plan-menu-item" onClick={downloadIfc}>
                  <span className="small strong">IFC, the whole building</span>
                  <span className="tiny muted">For Revit, ArchiCAD and BIM viewers: every floor in 3D.</span>
                </button>
              </div>
            )}
          </div>
        </>
      }
    >
      {fileInput}
      {editor.conflict && (
        <div className="plan-banner" role="alert">
          <AlertCircle size={16} />
          <span className="small grow">
            This plan was changed {editor.conflict.updatedBy ? `by ${editor.conflict.updatedBy} ` : ""}somewhere else since you opened
            it. Your latest changes are not saved yet.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={editor.takeTheirs}>Load theirs</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={editor.keepMine}>Keep mine</button>
        </div>
      )}
      {layout && report && (
        <div className="plan-banner plan-banner-layout" role="status">
          <LayoutGrid size={16} />
          <span className="small grow">
            Editing <strong>{layout.name}</strong>
            {layout.chosen ? ", the chosen layout" : ""}. Furniture changes stay in this option
            {layout.chosen ? " and on the plan" : ""}; walls and rooms change the plan for every option. Score {report.metrics.score},{" "}
            {report.issues.length ? `${report.issues.length} rule break${report.issues.length === 1 ? "" : "s"}` : "every rule met"}.
          </span>
          <Link href={`/projects/${project.id}/layout`} className="btn btn-secondary btn-sm">Back to options</Link>
        </div>
      )}
      {layoutGone && (
        <div className="plan-banner" role="alert">
          <AlertCircle size={16} />
          <span className="small grow">That layout option is no longer on the plan, so the plan itself is shown.</span>
          <Link href={`/projects/${project.id}/layout`} className="btn btn-secondary btn-sm">Back to options</Link>
        </div>
      )}
      {compare && diffRows && (
        <div className="plan-banner plan-banner-compare" role="status">
          <GitCompare size={16} />
          <span className="small grow">
            Comparing with <strong>{compare.label}</strong>, drawn dashed. Usable area {m2(diffRows.usableBefore)} then,{" "}
            {m2(diffRows.usableAfter)} now.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCompare(null)}>Stop comparing</button>
        </div>
      )}

      <div className="plan-toolbar">
        {levels.length > 1 && !layout && (
          <select className="input plan-floor" value={levelId} onChange={(e) => setLevel(e.target.value)} aria-label="Floor">
            {[...levels].reverse().map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
        <div className="segmented plan-tools" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              aria-pressed={tool === t.tool}
              onClick={() => setTool(t.tool)}
              title={`${t.label} (${t.key})`}
            >
              {t.icon}
              <span className="plan-label">{t.label}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <div style={{ position: "relative" }}>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
            <LayersIcon size={15} /> <span className="plan-label">Layers</span>
          </button>
          {layersOpen && (
            <div className="plan-popover" role="group" aria-label="Layers">
              {(Object.keys(LAYER_NAMES) as (keyof Layers)[])
                .filter((k) => k !== "reference" || plan.reference.length)
                .filter((k) => k !== "below" || levels.length > 1)
                .filter((k) => k !== "underlay" || plan.underlays.length)
                .map((k) => (
                  <label key={k} className="row-between small" style={{ gap: "1rem" }}>
                    {LAYER_NAMES[k]}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={layers[k]}
                      className="switch"
                      aria-label={`Show ${LAYER_NAMES[k].toLowerCase()}`}
                      onClick={() => setLayers((l) => ({ ...l, [k]: !l[k] }))}
                    />
                  </label>
                ))}
            </div>
          )}
        </div>
        <button type="button" className="icon-btn" onClick={() => setFitSignal((n) => n + 1)} aria-label="Fit the plan to the screen" title="Fit (F)">
          <Maximize size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard size={16} />
        </button>
      </div>

      <div className="plan-work">
        <div className="plan-stage">
          <PlanCanvas
            plan={plan}
            levelId={levelId}
            viewKey={`plan.${project.id}.view.${levelId}`}
            compare={compare?.plan}
            layers={layers}
            tool={tool}
            placeType={placeType}
            underlaySrc={underlaySrc}
            selection={selection}
            onSelect={setSelection}
            onEdit={onEdit}
            nudge={nudge}
            onToolDone={() => setTool("select")}
            onCalibrate={(a, b) => {
              setTool("select");
              setCalibration({ a, b });
            }}
            fitSignal={fitSignal}
            flagged={flagged}
          />
          <IssueMarker moduleKey="floor_plan_editor" projectId={project.id} className="pinned" />
        </div>
        <aside className="plan-side" aria-label="Plan details">
          <Inspector
            plan={plan}
            levelId={levelId}
            onLevel={setLevel}
            selection={selection}
            onSelect={setSelection}
            onEdit={onEdit}
            placing={tool === "item"}
            placeType={placeType}
            onPlaceType={setPlaceType}
            corrections={editor.stored?.corrections ?? []}
            compareRows={diffRows?.rooms}
            onStartOver={() => {
              startWith(emptyPlan(), "Cleared the plan to start over");
              toast("Plan cleared. Undo brings it back.");
            }}
            onAddUnderlay={() => imageRef.current?.click()}
            onCalibrate={() => {
              setSelection([]);
              setTool("calibrate");
            }}
            underlayBusy={underlayBusy}
            extra={
              layout && report ? (
                <div className="stack" style={{ gap: "0.5rem" }}>
                  <span className="eyebrow">{layout.name}, checked as you go</span>
                  <span className="tiny muted">Against {layout.ruleSetName}: {report.metrics.desks} desks, score {report.metrics.score}.</span>
                  <IssueList issues={report.issues} onPick={(i) => setSelection(i.itemIds.map((id) => ({ kind: "item" as const, id })))} />
                </div>
              ) : undefined
            }
          />
        </aside>
      </div>

      {versionsOpen && (
        <VersionsSheet
          versions={editor.stored?.versions ?? []}
          onClose={() => setVersionsOpen(false)}
          onCreate={async (labelText) => {
            await editor.createVersion(labelText);
            toast(`Version "${labelText}" kept`);
          }}
          onCompare={async (v) => {
            const version = await editor.getVersion(v.id);
            setCompare({ label: v.label, plan: version.plan });
            setVersionsOpen(false);
          }}
          onRestore={async (v) => {
            await editor.restore(v.id);
            setCompare(null);
            setSelection([]);
            setFitSignal((n) => n + 1);
            setVersionsOpen(false);
            toast(`Restored "${v.label}". The plan before it was kept as a version.`);
          }}
        />
      )}

      {shortcutsOpen && (
        <ShortcutsSheet
          nudge={nudge}
          nudges={NUDGES}
          onNudge={setNudge}
          onClose={() => setShortcutsOpen(false)}
          tools={TOOLS.map((t) => ({ key: t.key, label: t.label }))}
        />
      )}

      {calibration && (
        <CalibrateSheet
          picked={distance(calibration.a, calibration.b)}
          onClose={() => setCalibration(null)}
          onApply={(trueLength) => {
            const error = onEdit(calibrateUnderlay(plan, levelId, calibration.a, calibration.b, trueLength));
            if (!error) {
              setCalibration(null);
              setFitSignal((n) => n + 1);
              toast(`Image scaled. That line is now ${mm(trueLength)}.`);
            }
            return error;
          }}
        />
      )}

      {pendingImport && (
        <>
          <div className="scrim" onClick={() => setPendingImport(null)} />
          <div className="sheet" role="dialog" aria-label="Replace the plan">
            <h2 className="display-s" style={{ marginBottom: "0.5rem" }}>Replace the plan with {pendingImport.name}?</h2>
            <p className="small muted" style={{ marginBottom: "1.25rem" }}>
              The plan as it is now is kept as a version first, so you can go back to it.
            </p>
            <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPendingImport(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const next = pendingImport;
                  setPendingImport(null);
                  try {
                    await editor.createVersion(`Before importing ${next.name}`);
                  } catch {
                    toast("The current plan could not be kept as a version, so nothing was replaced.");
                    return;
                  }
                  startWith(next.plan, `Imported ${next.name}`);
                  toast(`${next.name} loaded`);
                }}
              >
                Replace
              </button>
            </div>
          </div>
        </>
      )}
    </PlanFrame>
  );
}

function PlanFrame({
  exitHref,
  title,
  project,
  status,
  onRetry,
  actions,
  children,
}: {
  exitHref: string;
  title: string;
  project: Project;
  status: PlanSaveStatus;
  onRetry?: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="plan-shell" style={swatchVar(project.swatch)}>
      <header className="plan-bar">
        <Link href={exitHref} className="icon-btn" aria-label="Close the plan" title="Close">
          <X size={19} />
        </Link>
        <div className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="small strong truncate">{title}</span>
          <span className="tiny muted truncate">{project.name}</span>
        </div>
        <SaveBadge status={status} onRetry={onRetry} />
        <span className="grow" />
        <div className="row" style={{ gap: "0.15rem" }}>{actions}</div>
      </header>
      {children}
    </div>
  );
}

function SaveBadge({ status, onRetry }: { status: PlanSaveStatus; onRetry?: () => void }) {
  const map = {
    saved: { icon: <Check size={13} strokeWidth={2.75} />, text: "Saved", color: "var(--good)" },
    saving: { icon: <RefreshCw size={13} className="spin" />, text: "Saving", color: "var(--ink-3)" },
    dirty: { icon: <RefreshCw size={13} />, text: "Editing", color: "var(--ink-3)" },
    error: { icon: <AlertCircle size={13} />, text: "Not saved, retrying", color: "var(--bad)" },
    conflict: { icon: <AlertCircle size={13} />, text: "Not saved", color: "var(--bad)" },
  }[status];
  return (
    <span className="tiny strong row" style={{ gap: "0.35rem", color: map.color }} aria-live="polite">
      {map.icon}
      {status === "error" && onRetry ? (
        <button type="button" className="tiny strong" style={{ color: "inherit" }} onClick={onRetry}>{map.text}</button>
      ) : (
        map.text
      )}
    </span>
  );
}

/** Asks for the true length of the line picked on the tracing image. */
function CalibrateSheet({ picked, onClose, onApply }: { picked: number; onClose: () => void; onApply: (length: number) => string | null }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form
        className="sheet"
        role="dialog"
        aria-label="Set the image's scale"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number.parseFloat(draft.replace(/[\s,]/g, ""));
          if (Number.isNaN(n)) setError("Type the true length in millimetres.");
          else setError(onApply(n));
        }}
      >
        <h2 className="display-s" style={{ marginBottom: "0.5rem" }}>How long is that line really?</h2>
        <p className="small muted" style={{ marginBottom: "1rem" }}>
          It measures {mm(picked)} on the image as it is now. Type its true length and the image is scaled to match.
        </p>
        <label className="field" style={{ marginBottom: "1rem" }}>
          <span className="field-label">True length</span>
          <span className="plan-measure">
            <input className="input tabular" inputMode="decimal" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={!!error} />
            <span className="small muted">mm</span>
          </span>
          {error && <span className="tiny" role="alert" style={{ color: "var(--bad)" }}>{error}</span>}
        </label>
        <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!draft.trim()}>Scale the image</button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Versions (P3-09)
// ---------------------------------------------------------------------------

function VersionsSheet({
  versions,
  onClose,
  onCreate,
  onCompare,
  onRestore,
}: {
  versions: PlanVersionSummary[];
  onClose: () => void;
  onCreate: (label: string) => Promise<void>;
  onCompare: (v: PlanVersionSummary) => Promise<void>;
  onRestore: (v: PlanVersionSummary) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Plan versions" style={{ maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
        <div className="row-between" style={{ marginBottom: "0.75rem" }}>
          <h2 className="display-s">Versions</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="small muted" style={{ marginBottom: "1rem" }}>
          Keep the plan under a name before trying an option, then compare with it or go back to it.
        </p>
        <form
          className="row"
          style={{ gap: "0.5rem", marginBottom: "1.25rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            const labelText = name.trim();
            if (!labelText) return;
            void run(async () => {
              await onCreate(labelText);
              setName("");
            });
          }}
        >
          <input className="input" placeholder="e.g. As surveyed" value={name} onChange={(e) => setName(e.target.value)} aria-label="Version name" />
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>Keep</button>
        </form>
        {error && <p className="small" role="alert" style={{ color: "var(--bad)", marginBottom: "0.75rem" }}>{error}</p>}
        {versions.length === 0 ? (
          <p className="small muted">No versions yet.</p>
        ) : (
          <div className="stack" style={{ gap: "0.6rem" }}>
            {versions.map((v) => (
              <div key={v.id} className="card row-between" style={{ padding: "0.85rem 1rem", gap: "0.75rem" }}>
                <span className="stack" style={{ gap: "0.1rem", minWidth: 0 }}>
                  <span className="small strong truncate">{v.label}</span>
                  <span className="tiny muted">{v.createdBy ? `${v.createdBy} · ` : ""}{relativeTime(v.createdAt)}</span>
                </span>
                <span className="row" style={{ gap: "0.35rem", flexShrink: 0 }}>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void run(() => onCompare(v))}>
                    Compare
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void run(() => onRestore(v))}>
                    Restore
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
