"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  Columns2,
  DoorOpen,
  Download,
  GitCompare,
  History,
  Layers as LayersIcon,
  Maximize,
  MousePointer2,
  PenLine,
  Redo2,
  RefreshCw,
  RotateCcw,
  Shapes,
  Square,
  SquareDashed,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { IssueMarker } from "@/components/ui/IssueMarker";
import { MissingProject } from "@/components/views/MissingProject";
import { exportDxf, importDxf } from "@/lib/plan/dxf";
import {
  diffPlans,
  emptyPlan,
  isEmptyPlan,
  m2,
  mm,
  removeItem,
  roomArea,
  samplePlan,
  setWallLength,
  setWallThickness,
  updateColumn,
  updateOpening,
  updateRoom,
  usableArea,
  wallLength,
  type EditResult,
  type Plan,
  type PlanDiff,
  type PlanItem,
} from "@/lib/plan/geometry";
import type { PlanVersionSummary } from "@/lib/plan/types";
import { relativeTime } from "@/lib/studio/format";
import type { Project } from "@/lib/studio/types";
import { getWorkflow, label } from "@/lib/workflow";
import { ALL_LAYERS, PlanCanvas, type Layers, type Tool } from "./PlanCanvas";
import { usePlanEditor, type PlanSaveStatus } from "./usePlanEditor";

function stillThere(plan: Plan, item: PlanItem): boolean {
  const lists = { wall: plan.walls, opening: plan.openings, column: plan.columns, room: plan.rooms };
  return lists[item.kind].some((x) => x.id === item.id);
}

/** The phase whose screen links to the plan, so closing the editor goes back there. */
function planPhase(project: Project) {
  return getWorkflow(project).phases.find((p) => p.modules.some((m) => m.startsWith("floor_plan_editor")));
}

export function PlanView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  if (ready && !project) return <main className="page"><MissingProject /></main>;
  return <WhenReady ready={ready}>{project && <PlanEditor project={project} />}</WhenReady>;
}

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Select", key: "V", icon: <MousePointer2 size={16} /> },
  { tool: "wall", label: "Wall", key: "W", icon: <PenLine size={16} /> },
  { tool: "room", label: "Room", key: "R", icon: <Shapes size={16} /> },
  { tool: "door", label: "Door", key: "D", icon: <DoorOpen size={16} /> },
  { tool: "window", label: "Window", key: "N", icon: <Columns2 size={16} /> },
  { tool: "column", label: "Column", key: "C", icon: <Square size={16} /> },
];

const LAYER_NAMES: Record<keyof Layers, string> = {
  walls: "Walls",
  openings: "Doors and windows",
  columns: "Columns",
  rooms: "Rooms",
  dimensions: "Dimensions",
  reference: "Imported lines",
};

function PlanEditor({ project }: { project: Project }) {
  const { toast } = useStudio();
  const editor = usePlanEditor(project.id);
  const [tool, setTool] = useState<Tool>("select");
  const [picked, setSelection] = useState<PlanItem | null>(null);
  const [layers, setLayers] = useState<Layers>(ALL_LAYERS);
  const [layersOpen, setLayersOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [compare, setCompare] = useState<{ label: string; plan: Plan } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [pendingImport, setPendingImport] = useState<{ plan: Plan; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const phase = planPhase(project);
  const exitHref = `/projects/${project.id}/phases/${phase?.key ?? project.currentPhase}`;
  const title = label(project, "floor_plan", "Floor plan");
  const plan = editor.plan;

  // The selection goes when what it points at does (an undo, a restore, a delete).
  const selection = picked && plan && stillThere(plan, picked) ? picked : null;

  // Keyboard shortcuts for tools and undo, unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t && plan) setTool(t.tool);
      if (e.key.toLowerCase() === "f" && plan) setFitSignal((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, plan]);

  const startWith = (next: Plan, summary: string, drawTool: Tool = "select") => {
    editor.replace(next, summary);
    setSelection(null);
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

  const download = () => {
    if (!plan) return;
    const blob = new Blob([exportDxf(plan)], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.id}-floor-plan.dxf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const onEdit = (result: EditResult) => editor.apply(result);

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
          <button type="button" className="icon-btn" onClick={download} aria-label="Export as DXF" title="Export as DXF">
            <Download size={17} />
          </button>
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
      </div>

      <div className="plan-work">
        <div className="plan-stage">
          <PlanCanvas
            plan={plan}
            compare={compare?.plan}
            layers={layers}
            tool={tool}
            selection={selection}
            onSelect={setSelection}
            onEdit={onEdit}
            onToolDone={() => setTool("select")}
            fitSignal={fitSignal}
          />
          <IssueMarker moduleKey="floor_plan_editor" projectId={project.id} className="pinned" />
        </div>
        <aside className="plan-side" aria-label="Plan details">
          <Inspector
            plan={plan}
            selection={selection}
            onSelect={setSelection}
            onEdit={onEdit}
            corrections={editor.stored?.corrections ?? []}
            compareRows={diffRows?.rooms}
            onStartOver={() => {
              startWith(emptyPlan(), "Cleared the plan to start over");
              toast("Plan cleared. Undo brings it back.");
            }}
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
            setSelection(null);
            setFitSignal((n) => n + 1);
            setVersionsOpen(false);
            toast(`Restored "${v.label}". The plan before it was kept as a version.`);
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

// ---------------------------------------------------------------------------
// The side panel: what is selected, or the rooms and the corrections log
// ---------------------------------------------------------------------------

function Inspector({
  plan,
  selection,
  onSelect,
  onEdit,
  corrections,
  compareRows,
  onStartOver,
}: {
  plan: Plan;
  selection: PlanItem | null;
  onSelect: (item: PlanItem | null) => void;
  onEdit: (result: EditResult) => string | null;
  corrections: { id: string; summary: string; at: string; by: string }[];
  compareRows?: PlanDiff["rooms"];
  onStartOver: () => void;
}) {
  const [showAllLog, setShowAllLog] = useState(false);
  const wall = selection?.kind === "wall" ? plan.walls.find((w) => w.id === selection.id) : undefined;
  const opening = selection?.kind === "opening" ? plan.openings.find((o) => o.id === selection.id) : undefined;
  const column = selection?.kind === "column" ? plan.columns.find((c) => c.id === selection.id) : undefined;
  const room = selection?.kind === "room" ? plan.rooms.find((r) => r.id === selection.id) : undefined;
  const remove = (item: PlanItem) => {
    if (!onEdit(removeItem(plan, item))) onSelect(null);
  };

  if (wall) return <WallPanel key={wall.id} plan={plan} wallId={wall.id} onEdit={onEdit} onRemove={() => remove({ kind: "wall", id: wall.id })} onClose={() => onSelect(null)} />;
  if (opening) {
    const host = plan.walls.find((w) => w.id === opening.wallId);
    return (
      <Panel title={opening.kind === "door" ? "Door" : "Window"} onClose={() => onSelect(null)} onRemove={() => remove({ kind: "opening", id: opening.id })}>
        <div className="segmented" role="group" aria-label="Kind">
          {(["door", "window"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={opening.kind === k} onClick={() => onEdit(updateOpening(plan, opening.id, { kind: k }))}>
              {k === "door" ? "Door" : "Window"}
            </button>
          ))}
        </div>
        <MeasureField key={`w-${opening.id}-${opening.width}`} label="Width" value={opening.width} onCommit={(v) => onEdit(updateOpening(plan, opening.id, { width: v }))} />
        <MeasureField
          key={`a-${opening.id}-${opening.at}`}
          label="From the wall's start to its middle"
          value={opening.at}
          onCommit={(v) => onEdit(updateOpening(plan, opening.id, { at: v }))}
        />
        {host && <p className="tiny muted">On a wall {mm(wallLength(host))} long.</p>}
      </Panel>
    );
  }
  if (column) {
    return (
      <Panel title="Column" onClose={() => onSelect(null)} onRemove={() => remove({ kind: "column", id: column.id })}>
        <MeasureField key={`w-${column.id}-${column.width}`} label="Width" value={column.width} onCommit={(v) => onEdit(updateColumn(plan, column.id, { width: v }))} />
        <MeasureField key={`d-${column.id}-${column.depth}`} label="Depth" value={column.depth} onCommit={(v) => onEdit(updateColumn(plan, column.id, { depth: v }))} />
      </Panel>
    );
  }
  if (room) {
    return (
      <Panel title="Room" onClose={() => onSelect(null)} onRemove={() => remove({ kind: "room", id: room.id })}>
        <TextField key={`n-${room.id}-${room.name}`} label="Name" value={room.name} autoFocus={/^Room \d+$/.test(room.name)} onCommit={(v) => onEdit(updateRoom(plan, room.id, { name: v }))} />
        <div className="stack" style={{ gap: "0.15rem" }}>
          <span className="eyebrow">Area</span>
          <span className="display-s tabular">{m2(roomArea(room))}</span>
        </div>
        <label className="row-between small" style={{ gap: "1rem" }}>
          Counts towards the usable area
          <button
            type="button"
            role="switch"
            aria-checked={room.usable}
            className="switch"
            aria-label="Counts towards the usable area"
            onClick={() => onEdit(updateRoom(plan, room.id, { usable: !room.usable }))}
          />
        </label>
        <p className="tiny muted">To change its size, select a wall of the room and type its true length.</p>
      </Panel>
    );
  }

  const log = showAllLog ? corrections : corrections.slice(0, 6);
  const warnings = plan.source?.warnings ?? [];
  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="stack" style={{ gap: "0.2rem" }}>
        <span className="eyebrow">Usable area</span>
        <span className="display-m tabular">{m2(usableArea(plan))}</span>
        <span className="tiny muted">
          {plan.rooms.length
            ? `${plan.rooms.filter((r) => r.usable).length} of ${plan.rooms.length} rooms count towards it`
            : "Draw rooms with the Room tool to see their areas."}
        </span>
      </div>

      {plan.rooms.length > 0 && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <span className="eyebrow">Rooms</span>
          <ul className="plan-list">
            {[...plan.rooms]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r) => {
                const then = compareRows?.find((c) => c.name === r.name)?.before;
                return (
                  <li key={r.id}>
                    <button type="button" className="row-between small" onClick={() => onSelect({ kind: "room", id: r.id })}>
                      <span className="truncate" style={{ color: r.usable ? undefined : "var(--ink-3)" }}>{r.name}</span>
                      <span className="tabular muted">
                        {then != null && Math.abs(then - roomArea(r)) >= 0.005 ? <s style={{ marginRight: "0.4rem" }}>{m2(then)}</s> : null}
                        {m2(roomArea(r))}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <details className="plan-notes">
          <summary className="small strong">
            {warnings.length} note{warnings.length === 1 ? "" : "s"} from importing {plan.source?.name}
          </summary>
          <ul className="stack tiny" style={{ gap: "0.4rem", marginTop: "0.6rem", paddingLeft: "1rem", listStyle: "disc" }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}

      <div className="stack" style={{ gap: "0.35rem" }}>
        <span className="eyebrow">Corrections</span>
        {corrections.length === 0 ? (
          <p className="tiny muted">Every change you make is listed here, with who made it and when.</p>
        ) : (
          <ul className="plan-log">
            {log.map((c) => (
              <li key={c.id}>
                <span className="small">{c.summary}</span>
                <span className="tiny muted">{c.by} · {relativeTime(c.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {corrections.length > 6 && (
          <button type="button" className="tiny strong" style={{ alignSelf: "flex-start", color: "var(--accent)" }} onClick={() => setShowAllLog((s) => !s)}>
            {showAllLog ? "Show fewer" : `Show all ${corrections.length}`}
          </button>
        )}
      </div>

      {!isEmptyPlan(plan) && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--ink-3)" }} onClick={onStartOver}>
          <RotateCcw size={14} /> Start over
        </button>
      )}
    </div>
  );
}

function Panel({
  title,
  onClose,
  onRemove,
  children,
}: {
  title: string;
  onClose: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="row-between">
        <h2 className="display-s">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Done">
          <Check size={17} />
        </button>
      </div>
      {children}
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--bad)" }} onClick={onRemove}>
        Remove {title.toLowerCase()}
      </button>
    </div>
  );
}

function WallPanel({
  plan,
  wallId,
  onEdit,
  onRemove,
  onClose,
}: {
  plan: Plan;
  wallId: string;
  onEdit: (result: EditResult) => string | null;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [keep, setKeep] = useState<"a" | "b">("a");
  const wall = plan.walls.find((w) => w.id === wallId)!;
  const length = wallLength(wall);
  const joinedAtEnd = plan.walls.filter((w) => w.id !== wallId && [w.a, w.b].some((p) => Math.abs(p.x - (keep === "a" ? wall.b : wall.a).x) <= 1 && Math.abs(p.y - (keep === "a" ? wall.b : wall.a).y) <= 1)).length;
  return (
    <Panel title="Wall" onClose={onClose} onRemove={onRemove}>
      <MeasureField
        key={`l-${wall.id}-${Math.round(length)}-${keep}`}
        label="True length"
        value={Math.round(length)}
        autoFocus
        onCommit={(v) => onEdit(setWallLength(plan, wall.id, v, keep))}
      />
      <div className="stack" style={{ gap: "0.4rem" }}>
        <span className="field-label">Which end stays put</span>
        <div className="segmented" role="group" aria-label="Which end stays put">
          <button type="button" aria-pressed={keep === "a"} onClick={() => setKeep("a")}>The start</button>
          <button type="button" aria-pressed={keep === "b"} onClick={() => setKeep("b")}>The far end</button>
        </div>
        <span className="tiny muted">
          The other end moves along the wall, and everything beyond it moves too
          {joinedAtEnd ? `, including the ${joinedAtEnd} wall${joinedAtEnd === 1 ? "" : "s"} joined there` : ""}, so walls stay square
          and room areas update.
        </span>
      </div>
      <MeasureField key={`t-${wall.id}-${wall.thickness}`} label="Thickness" value={wall.thickness} onCommit={(v) => onEdit(setWallThickness(plan, wall.id, v))} />
    </Panel>
  );
}

/** A millimetre field that applies on Enter or when it loses focus, and says why a value was refused. */
function MeasureField({
  label: text,
  value,
  onCommit,
  autoFocus,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => string | null;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    const n = Number.parseFloat(draft.replace(/[\s,]/g, ""));
    if (Number.isNaN(n)) {
      setError("Type a number of millimetres.");
      return;
    }
    if (Math.round(n) === Math.round(value)) {
      setError(null);
      return;
    }
    setError(onCommit(n));
  };
  return (
    <label className="field">
      <span className="field-label">{text}</span>
      <span className="plan-measure">
        <input
          className="input tabular"
          inputMode="decimal"
          value={draft}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(String(Math.round(value)));
              setError(null);
            }
          }}
        />
        <span className="small muted">mm</span>
      </span>
      {error && <span className="tiny" role="alert" style={{ color: "var(--bad)" }}>{error}</span>}
    </label>
  );
}

function TextField({
  label: text,
  value,
  onCommit,
  autoFocus,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => string | null;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft.trim() === value) return;
    setError(onCommit(draft));
  };
  return (
    <label className="field">
      <span className="field-label">{text}</span>
      <input
        className="input"
        value={draft}
        autoFocus={autoFocus}
        onFocus={(e) => autoFocus && e.target.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      {error && <span className="tiny" role="alert" style={{ color: "var(--bad)" }}>{error}</span>}
    </label>
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
