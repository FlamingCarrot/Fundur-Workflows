"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  Armchair,
  Check,
  Columns2,
  Box,
  DoorOpen,
  Download,
  GitCompare,
  History,
  LayoutGrid,
  Keyboard,
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
  SlidersHorizontal,
  Sparkles,
  Table2,
  Printer,
  Type,
  Undo2,
  Upload,
  X,
  MessageSquare,
  EyeOff,
  RulerDimensionLine,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { ProjectNavigation } from "@/components/projects/ProjectNavigation";
import { DesignLink } from "@/components/design/DesignLink";
import { usePlan } from "@/components/billing/usePlan";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { IssueMarker } from "@/components/ui/IssueMarker";
import { MissingProject } from "@/components/views/MissingProject";
import { exportDxf, importDxf } from "@/lib/plan/dxf";
import { calibrateUnderlay, setUnderlay, sortedLevels, moveBy, rotateItem } from "@/lib/plan/elements";
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
  removeItem,
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
import { isBoolean, isStringOrNull, useViewSetting } from "@/lib/view-settings/client";
import { LIBRARY } from "@/lib/plan/library";
import { ALL_LAYERS, PlanCanvas, type Layers, type Tool } from "./PlanCanvas";
import { Inspector } from "./PlanInspector";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { TeamComments } from "@/components/team/TeamComments";
import { IssueList } from "@/components/layout/LayoutParts";
import { checkLayout } from "@/lib/layout/check";
import { intoLayout, withLayout } from "@/lib/layout/options";
import { usePlanEditor, type PlanSaveStatus } from "./usePlanEditor";
import { useAssistantLink } from "./useAssistantLink";
import { useMobileDialog } from "@/hooks/useMobileDialog";
import { VIEW_PRESETS, type Plan3DApi, type Projection, type ViewPreset } from "./Plan3D";
import { exportView, Plan3DBar, ViewCube, type Panel3D, type Settings3D } from "./Plan3DControls";
import { LibraryProvider, useLibraryContext, useResolver } from "@/components/library/LibraryContext";
import { blueprintFromItems, newSlice, swapForBlueprint, syncWallTypes, VIEW_STYLES } from "@/lib/blueprints/plan-edits";
import type { Blueprint } from "@/lib/blueprints/types";
import type { ViewCommand, ViewState } from "@/lib/assistant/view-command";
import { slicesSchema } from "@/lib/plan/schema";
import type { Slice } from "@/lib/plan/geometry";
import { editFurniture } from "@/lib/plan/groups";
import { PlanObjects } from "./PlanObjects";
import { PlanMultiBar } from "./PlanMultiBar";
import { SchedulesSheet } from "./SchedulesSheet";
import { colourFill, COLOUR_BY, type ColourBy } from "@/lib/plan/colour-fill";
import { SHEET_DEFAULT, sheetPdf, SheetsSheet } from "./SheetsSheet";
import { dataUrlBytes } from "@/lib/export/image-pdf";
import { pinViolation } from "@/lib/plan/pins";
import { isPhaseView, PHASE_VIEWS, phaseView, setPhase, usesPhases, type Phase, type PhaseView } from "@/lib/plan/phases";
import { openingMarks } from "@/lib/plan/marks";
import { isPlanLook, type PlanLook } from "@/lib/plan/ceilings";
import { hiddenCount, hideThese, isHideState, visiblePart, type HideState } from "@/lib/plan/hide";
import { copyOut, describeSelection, exists, isSelected, levelOfThing, pasteIn, toggle, unique, type Clip } from "@/lib/plan/selection";

const Plan3D = dynamic(() => import("./Plan3D"), {
  ssr: false,
  loading: () => <div className="plan-3d-fallback"><p className="small muted">Loading the 3D view…</p></div>,
});

function stillThere(plan: Plan, item: PlanItem): boolean {
  const lists: Record<PlanItem["kind"], { id: string }[]> = {
    wall: plan.walls,
    opening: plan.openings,
    column: plan.columns,
    room: plan.rooms,
    item: plan.items,
    note: plan.notes,
    dimension: plan.dimensions,
  };
  return lists[item.kind].some((x) => x.id === item.id);
}

/** The phase whose screen links to the plan, so closing the editor goes back there. */
function planPhase(project: Project) {
  return getWorkflow(project).phases.find((p) => p.modules.some((m) => m.startsWith("floor_plan_editor")));
}

export function PlanView({ projectId, layoutId }: { projectId: string; layoutId?: string }) {
  const { ready, getProject, viewer } = useStudio();
  const project = getProject(projectId);
  if (ready && !project) return <main className="page"><MissingProject /></main>;
  return <WhenReady ready={ready}>{project && <LibraryProvider><PlanEditor key={`${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}.${project.id}.${layoutId ?? "plan"}`} project={project} layoutId={layoutId} /></LibraryProvider>}</WhenReady>;
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
  { tool: "tape", label: "Tape", key: "Q", icon: <RulerDimensionLine size={16} /> },
];

// Remembered layers count only if they name every layer there is now.
const isLayers = (v: unknown): v is Layers =>
  !!v && typeof v === "object" && (Object.keys(ALL_LAYERS) as (keyof Layers)[]).every((k) => typeof (v as Layers)[k] === "boolean");
/** A blueprint id to place; old settings held a library type, which maps to its default blueprint. */
const isPlaceId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 80;
const placeIdOf = (v: string) => (v.includes(":") ? v : LIBRARY.some((i) => i.type === v) ? `std:${v}` : "std:desk");

/** The 3D view's look and framing, remembered for the person across plans. */
type Look3D = Omit<Settings3D, "slices">;
const LOOK_3D: Look3D = { view: "iso", projection: "perspective", style: "realistic", shadows: true, allFloors: true, separated: false, cutWalls: true };
const isLook3D = (v: unknown): v is Look3D => {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    VIEW_PRESETS.some((p) => p.key === o.view) &&
    (o.projection === "perspective" || o.projection === "orthographic") &&
    VIEW_STYLES.some((s) => s.key === o.style) &&
    ["shadows", "allFloors", "separated", "cutWalls"].every((k) => typeof o[k] === "boolean")
  );
};
const NO_SLICES: Slice[] = [];
const isSlices = (v: unknown): v is Slice[] => slicesSchema.safeParse(v).success;
const isViewMode = (v: unknown): v is "2d" | "3d" => v === "2d" || v === "3d";
const isPanel = (v: unknown): v is Panel3D => v === null || v === "look" || v === "sections" || v === "cameras" || v === "render" || v === "ai";

const isColourBy = (v: unknown): v is ColourBy => COLOUR_BY.some((c) => c.key === v);

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
  const { toast, fileStorage, addDocuments, viewer, setAssistantOpen } = useStudio();
  const editor = usePlanEditor(project.id);
  const billing = usePlan();
  /** False, with a note, when the workspace's plan leaves a plan editor tool out. */
  const allowed = (name: string, what: string) => {
    if (billing.allows("floor_plan_editor", name, project.workflowId)) return true;
    toast(`${what} is on the Paid plan. See your plan for more.`);
    return false;
  };
  const [tool, setTool] = useState<Tool>("select");
  const [viewMode, setViewMode] = useViewSetting<"2d" | "3d">(`plan.${project.id}.mode`, "2d", isViewMode);
  const [look3d, setLook3d] = useViewSetting<Look3D>("plan.3d", LOOK_3D, isLook3D);
  const [slices, setSlices] = useViewSetting<Slice[]>(`plan.${project.id}.slices`, NO_SLICES, isSlices);
  const [panel3d, setPanel3d] = useViewSetting<Panel3D>("plan.3d.panel", null, isPanel);
  const settings3d = useMemo<Settings3D>(() => ({ ...look3d, slices }), [look3d, slices]);
  const set3d = useCallback(
    (patch: Partial<Settings3D>) => {
      const { slices: nextSlices, ...rest } = patch;
      if (nextSlices) setSlices(nextSlices);
      if (Object.keys(rest).length) setLook3d((l) => ({ ...l, ...rest }));
    },
    [setSlices, setLook3d]
  );
  const { allFloors, separated, cutWalls } = look3d;
  const ceilings3d = !!look3d.ceilings;
  const api3d = useRef<Plan3DApi | null>(null);
  const lib = useResolver();
  const library = useLibraryContext();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mobileDetails = useMobileDialog(520);
  const [picked, setSelection] = useState<PlanItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Walls, rooms, columns and the rest selected together (furniture is in selectedIds).
  const [others, setOthers] = useState<PlanItem[]>([]);
  const [clip, setClip] = useState<{ clip: Clip; levelId: string } | null>(null);
  const [multiMode, setMultiMode] = useState(false);
  const [layers, setLayers] = useViewSetting<Layers>("plan.layers", ALL_LAYERS, isLayers);
  const [colourBy, setColourBy] = useViewSetting<ColourBy>("plan.colourBy", "none", isColourBy);
  // Temporarily hidden or isolated things (Revit's HH, HI, HR), remembered per project.
  const [hide, setHide] = useViewSetting<HideState | null>(`plan.${project.id}.hide`, null, isHideState);
  const hKey = useRef(0);
  const [showMarks, setShowMarks] = useViewSetting<boolean>("plan.marks", false, isBoolean);
  const [look, setLook] = useViewSetting<PlanLook>(`plan.${project.id}.look`, "floor", isPlanLook);
  const [phaseShown, setPhaseView] = useViewSetting<PhaseView>(`plan.${project.id}.phase`, "all", isPhaseView);
  const [layersOpen, setLayersOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [sheetsOpen, setSheetsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [compare, setCompare] = useState<{ label: string; plan: Plan } | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  const [pendingImport, setPendingImport] = useState<{ plan: Plan; name: string } | null>(null);
  const [levelPick, setLevel] = useViewSetting<string | null>(`plan.${project.id}.level`, null, isStringOrNull);
  const [placeSetting, setPlaceType] = useViewSetting("plan.placeType", "std:desk", isPlaceId);
  const placeType = lib.blueprint(placeIdOf(placeSetting)) ? placeIdOf(placeSetting) : "std:desk";
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
  const fill = useMemo(() => (plan ? colourFill(plan, levelId, colourBy, lib) : { fills: new Map<string, string>(), legend: [] }), [plan, levelId, colourBy, lib]);
  const level = levels.find((l) => l.id === levelId);
  // In 3D, "all phases" builds the finished result: what comes out is gone.
  const shownPlan = useMemo(() => (plan ? phaseView(visiblePart(plan, hide), phaseShown === "all" ? "new" : phaseShown) : plan), [plan, hide, phaseShown]);
  const phased = useMemo(() => !!plan && usesPhases(plan), [plan]);
  const marks = useMemo(() => (plan && showMarks ? openingMarks(plan) : undefined), [plan, showMarks]);
  const hiddenHere = useMemo(() => (plan ? hiddenCount(plan, hide) : 0), [plan, hide]);
  const sceneOptions = useMemo(() => ({ levelId, allLevels: allFloors && !layoutId, separated, cutWalls, ceilings: ceilings3d, layers }), [levelId, allFloors, layoutId, separated, cutWalls, ceilings3d, layers]);
  const furnitureSelection = useMemo(() => selectedIds.filter((id) => plan?.items.some((i) => i.id === id && i.levelId === levelId && !i.hidden)), [selectedIds, plan, levelId]);
  const othersHere = useMemo(() => (plan ? others.filter((t) => exists(plan, t) && levelOfThing(plan, t) === levelId) : []), [others, plan, levelId]);
  const selectFurniture = (ids: string[]) => {
    setSelectedIds(ids);
    setSelection(ids.length ? { kind: "item", id: ids[ids.length - 1] } : null);
  };
  const selectObject = (target: PlanItem | null, floorId?: string, additive = false) => {
    if (floorId && !layoutId) setLevel(floorId);
    // Shift+click (or multi-select) adds walls, rooms and the rest, as Ctrl+click does in Revit.
    if (target && target.kind !== "item" && (additive || multiMode)) {
      const start = othersHere.length ? othersHere : picked && picked.kind !== "item" && !isSelected([target], picked) ? [picked] : [];
      setOthers(toggle(start, target));
      setSelection(target);
      return;
    }
    if (target?.kind === "item" && (additive || multiMode) && picked && picked.kind !== "item" && !othersHere.length) setOthers([picked]);
    if (!additive && !multiMode) setOthers([]);
    if (target?.kind === "note" || target?.kind === "dimension") setViewMode("2d");
    setSelection(target);
    if (target?.kind === "item" && plan) {
      const item = plan.items.find((i) => i.id === target.id);
      const ids = item?.groupId ? plan.items.filter((i) => i.groupId === item.groupId && i.levelId === item.levelId && !i.hidden).map((i) => i.id) : [target.id];
      setSelectedIds((previous) => additive || multiMode ? ids.every((id) => previous.includes(id)) ? previous.filter((id) => !ids.includes(id)) : [...new Set([...previous, ...ids])] : ids);
    } else setSelectedIds([]);
    if (target && !multiMode && !additive) setDetailsOpen(true);
  };

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
  const floorCap = billing.cap("floor_plan_editor", "floors", project.workflowId);
  const onEdit = useCallback(
    (result: EditResult) => {
      if (result.ok && floorCap != null && base && result.plan.levels.length > Math.max(floorCap, base.levels.length)) {
        const message = `The ${billing.plan.label} plan has ${floorCap} floor${floorCap === 1 ? "" : "s"} per plan. Paid has as many as you need.`;
        toast(message);
        return message;
      }
      const pinned = result.ok && plan ? pinViolation(plan, result.plan) : null;
      if (pinned) return pinned;
      return editor.apply(layout && base ? intoLayout(base, layout.id, result) : result);
    },
    [editor, layout, base, floorCap, billing.plan.label, toast, plan]
  );

  // A wall type changed in the library changes every wall of that type: once per library change, as an undoable edit.
  const syncedWith = useRef<unknown>(null);
  useEffect(() => {
    if (!plan || library?.status !== "ready" || syncedWith.current === library.resolver) return;
    syncedWith.current = library.resolver;
    const result = syncWallTypes(plan, library.resolver);
    if (result?.ok && !onEdit(result)) toast(result.summary);
  }, [plan, library, onEdit, toast]);

  // The selection goes when what it points at does (an undo, a restore, a delete), or when the floor changes.
  const selection = useMemo<PlanItem | null>(() => picked?.kind === "item" ? furnitureSelection.length ? { kind: "item", id: furnitureSelection.includes(picked.id) ? picked.id : furnitureSelection[furnitureSelection.length - 1] } : null : picked && plan && stillThere(onLevel(plan, levelId), picked) ? picked : null, [picked, plan, levelId, furnitureSelection]);
  // The assistant sees the floor and the selection, and draws its edits here as they land.
  const together = useMemo<PlanItem[]>(() => unique([...furnitureSelection.map((id) => ({ kind: "item" as const, id })), ...othersHere]), [furnitureSelection, othersHere]);
  const selected = useMemo<PlanItem[]>(
    () => (together.length > 1 ? together : selection ? [selection] : []),
    [together, selection]
  );
  const clearAll = useCallback(() => {
    setSelectedIds([]);
    setOthers([]);
    setSelection(null);
  }, []);
  /** Hides what is selected, or shows only it; the selection goes, since it may no longer be seen. */
  const hideSelected = (mode: "hide" | "isolate", things: PlanItem[] = selected) => {
    if (!things.length) {
      toast("Select something first.");
      return;
    }
    setHide(hideThese(hide, mode, things));
    clearAll();
  };
  const showAll = () => setHide(null);
  const selectMade = (made: PlanItem[]) => {
    setSelectedIds(made.filter((t) => t.kind === "item").map((t) => t.id));
    setOthers(made.filter((t) => t.kind !== "item"));
    setSelection(made[made.length - 1] ?? null);
  };
  const makeBlueprint = async (name: string): Promise<string | null> => {
    if (!plan || !library) return "The design library is still loading.";
    const ids = together.filter((t) => t.kind === "item").map((t) => t.id);
    const made = blueprintFromItems(plan, lib, ids, name);
    if (!made.ok) {
      toast(made.error);
      return made.error;
    }
    try {
      const saved = (await library.create("blueprint", made.blueprint)) as Blueprint;
      const swap = swapForBlueprint(plan, ids, saved, made.at, made.levelId);
      const error = onEdit(swap);
      if (error) {
        toast(error);
        return error;
      }
      if (swap.ok && swap.created) selectMade(swap.created);
      toast(`${saved.name} saved to the design library`);
      return null;
    } catch (e) {
      toast((e as Error).message);
      return (e as Error).message;
    }
  };
  /** Selects what a schedule row counts, going to its floor first. */
  const pickFromSchedule = (targets: PlanItem[]) => {
    if (!plan || !targets.length) return;
    const floor = targets.map((t) => levelOfThing(plan, t)).find((l) => l === levelId) ?? levelOfThing(plan, targets[0]);
    if (floor && floor !== levelId && !layoutId) setLevel(floor);
    selectMade(targets.filter((t) => levelOfThing(plan, t) === floor));
    setViewMode("2d");
    setSchedulesOpen(false);
  };
  const copySelection = () => {
    if (!plan || !selected.length) return;
    setClip({ clip: copyOut(plan, selected), levelId });
    toast(`${describeSelection(plan, selected)} copied`);
  };
  const pasteClip = () => {
    if (!plan || !clip) return;
    // On another floor it goes in the same place (Revit's Paste Aligned); on this one, set off a little.
    const result = pasteIn(plan, clip.clip, levelId, clip.levelId === levelId ? { x: 500, y: -500 } : { x: 0, y: 0 });
    const error = onEdit(result);
    if (error) toast(error);
    else if (result.ok && result.created) selectMade(result.created);
  };
  const [aiRequest, setAiRequest] = useState<{ direction: string; nonce: number } | undefined>();
  const viewState = useMemo<ViewState>(
    () => ({ mode: viewMode, view: look3d.view, projection: look3d.projection, style: look3d.style, sections: slices.map(({ axis, at, flip, enabled }) => ({ axis, at, flip, enabled })) }),
    [viewMode, look3d, slices]
  );
  /** The assistant's view changes: the same settings a person changes, so they are remembered too. */
  /** Keeps a render, a sheet or a schedule with the project's documents. */
  const saveFile = async (file: File) => {
    const storageKey = await uploadToProject(project.id, file);
    addDocuments(project.id, [
      { id: crypto.randomUUID(), name: file.name, sizeBytes: file.size, phaseKey: phase?.key ?? project.currentPhase, uploadedAt: new Date().toISOString(), clientVisible: false, storageKey, stored: true, version: 1 },
    ]);
  };
  const onView = (c: ViewCommand): string => {
    if (!plan) return "There is no plan yet.";
    const done: string[] = [];
    const patch: Partial<Settings3D> = {};
    if (c.floor) {
      const want = c.floor.trim().toLowerCase();
      const l = levels.find((x) => x.id === c.floor || x.name.toLowerCase() === want);
      if (!l) return `There is no floor "${c.floor}".`;
      if (!layoutId) setLevel(l.id);
      done.push(`showing ${l.name}`);
    }
    const to3d = c.mode === "3d" || (!c.mode && (c.view || c.sections || c.sectionBox || c.isolate || c.lookFrom || c.render));
    if (c.mode === "2d") setViewMode("2d");
    else if (to3d) {
      setViewMode("3d");
      setTool("select");
      setCompare(null);
    }
    if (c.view) patch.view = c.view;
    if (c.projection) patch.projection = c.projection;
    if (c.style) patch.style = c.style;
    for (const k of ["shadows", "allFloors", "separated", "cutWalls", "ceilings"] as const) if (c[k] != null) patch[k] = c[k];
    let next = c.clearSections ? [] : slices;
    const lv = levels.find((l) => l.id === levelId);
    const box = (b: { minX: number; maxX: number; minY: number; maxY: number }, bottom = (lv?.elevation ?? 0) - 100, top = (lv?.elevation ?? 0) + (lv?.height ?? 2_700) + 50) => [
      newSlice("x", b.maxX + 150),
      { ...newSlice("x", b.minX - 150), flip: true },
      newSlice("y", b.maxY + 150),
      { ...newSlice("y", b.minY - 150), flip: true },
      newSlice("z", top),
      { ...newSlice("z", bottom), flip: true },
    ];
    if (c.sectionBox) next = box(c.sectionBox, c.sectionBox.bottom, c.sectionBox.top);
    if (c.isolate?.length) {
      const items = plan.items.filter((i) => c.isolate!.some((t) => t.kind === "item" && t.id === i.id));
      const part = {
        ...plan,
        walls: plan.walls.filter((w) => c.isolate!.some((t) => t.kind === "wall" && t.id === w.id)),
        rooms: plan.rooms.filter((r) => c.isolate!.some((t) => t.kind === "room" && t.id === r.id)),
        items,
        columns: [], reference: [], notes: [], dimensions: [], underlays: [],
      };
      const b = planBounds(part);
      if (!b) return "None of those are on the plan.";
      next = box(b);
      if (items.length) selectFurniture(items.map((i) => i.id));
      done.push(`isolated ${c.isolate.length} thing${c.isolate.length === 1 ? "" : "s"}`);
    }
    if (c.sections?.length) next = [...next, ...c.sections.map((x) => ({ ...newSlice(x.axis, x.at), flip: x.keep === "above" }))];
    if (next.length > 12) return "At most 12 sections at once.";
    if (next !== slices) {
      patch.slices = next;
      done.push(next.length ? `${next.length} section${next.length === 1 ? "" : "s"}` : "sections cleared");
    }
    set3d(patch);
    if (c.view || c.fit || c.sectionBox || c.isolate) setFitSignal((n) => n + 1);
    if (c.lookFrom) {
      const cam = (plan.cameras ?? []).find((x) => x.id === c.lookFrom || x.name.toLowerCase() === c.lookFrom!.trim().toLowerCase());
      if (!cam) return `There is no camera "${c.lookFrom}". Cameras: ${(plan.cameras ?? []).map((x) => x.name).join(", ") || "none"}.`;
      set3d({ ...(cam.slices ? { slices: cam.slices } : {}), ...(cam.style ? { style: cam.style } : {}), projection: cam.projection });
      whenReady((api) => api.lookFrom(cam, levels.find((l) => l.id === cam.levelId)?.elevation ?? 0));
      done.push(`looking from ${cam.name}`);
    }
    if (c.render?.kind === "image") {
      const r = c.render;
      whenReady((api) => void exportView(api, { format: r.format, size: r.size, style: r.style }, `${project.id}-floor-plan`, project.name).catch((e: Error) => toast(e.message)));
      done.push(`${r.format.toUpperCase()} render downloading`);
    }
    if (c.render?.kind === "ai") {
      setPanel3d("ai");
      const direction = c.render.direction;
      setAiRequest((r) => ({ direction, nonce: (r?.nonce ?? 0) + 1 }));
      done.push("AI render started in the AI render panel");
    }
    if (c.layers) {
      const change = Object.entries(c.layers).filter((e): e is [keyof Layers, boolean] => typeof e[1] === "boolean" && e[0] in LAYER_NAMES);
      if (change.length) {
        setLayers((l) => ({ ...l, ...Object.fromEntries(change) }));
        done.push(change.map(([k, v]) => `${LAYER_NAMES[k].toLowerCase()} ${v ? "shown" : "hidden"}`).join(", "));
      }
    }
    if (c.hide) {
      if (c.hide.mode === "reset") {
        showAll();
        done.push("everything shown again");
      } else {
        const things = plan ? c.hide.things.filter((t) => exists(plan, t)) : [];
        if (things.length) {
          setHide(hideThese(hide, c.hide.mode, things));
          done.push(c.hide.mode === "hide" ? `${things.length} hidden for now` : `showing only ${things.length}`);
        } else done.push("nothing to hide: those ids are not on the plan");
      }
    }
    if (c.select) {
      const found = c.select.filter((t) => exists(plan, t));
      const items = found.filter((t) => t.kind === "item").map((t) => t.id);
      const rest = found.filter((t) => t.kind !== "item") as PlanItem[];
      setSelectedIds(items);
      setOthers(rest.length > 1 || (rest.length && items.length) ? rest : []);
      setSelection(found.length ? (found[found.length - 1] as PlanItem) : null);
      const floor = found.length ? levelOfThing(plan, found[0] as PlanItem) : null;
      if (floor && floor !== levelId && !layoutId) setLevel(floor);
      done.push(found.length ? `${found.length} selected` : c.select.length ? "none of those are on the plan" : "selection cleared");
    }
    if (c.look) {
      setLook(c.look);
      if (!to3d) setViewMode("2d");
      done.push(c.look === "ceiling" ? "showing the ceiling plan" : "showing the floor plan");
    }
    if (c.marks !== undefined) {
      setShowMarks(c.marks);
      done.push(c.marks ? "door and window marks shown" : "marks hidden");
    }
    if (c.phase) {
      setPhaseView(c.phase);
      done.push(`showing ${PHASE_VIEWS.find((p) => p.key === c.phase)?.label.toLowerCase()}`);
    }
    if (c.colourBy) {
      setColourBy(c.colourBy);
      if (c.colourBy !== "none" && !to3d) setViewMode("2d");
      done.push(c.colourBy === "none" ? "colour fill off" : `rooms coloured by ${c.colourBy}`);
    }
    if (c.sheet) {
      const sh = c.sheet;
      const result = sheetPdf(plan, lib, { ...SHEET_DEFAULT, paper: sh.paper, scale: sh.scale, floors: sh.floors, title: sh.title ?? SHEET_DEFAULT.title, number: sh.number ?? SHEET_DEFAULT.number, revision: sh.revision ?? "", colour: sh.colour }, { levelId, projectName: project.name, colourBy: c.colourBy ?? colourBy, phase: c.phase ?? phaseShown, marks: c.marks ?? showMarks, look: c.look ?? look, practice: viewer.workspaces?.find((w) => w.id === viewer.workspaceId)?.name });
      if (!result.ok) return result.error;
      const file = new File([result.pdf as BlobPart], `${project.name} ${sh.title || SHEET_DEFAULT.title} ${sh.number || SHEET_DEFAULT.number}.pdf`.replace(/[\\/:*?"<>|]+/g, "-"), { type: "application/pdf" });
      if (sh.keep) void saveFile(file).then(() => toast(`${file.name} kept with the project's files`), (e: Error) => toast(e.message));
      else {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2_000);
      }
      done.push(`${result.sheets} sheet${result.sheets === 1 ? "" : "s"} at 1:${result.scale} on ${sh.paper}, ${sh.keep ? "kept with the project's files" : "downloading"}`);
    }
    const changed = Object.keys(patch).filter((k) => k !== "slices");
    if (changed.length) done.push(changed.map((k) => `${k} ${String(patch[k as keyof Settings3D])}`).join(", "));
    return done.length || c.mode ? `Done: ${[c.mode && `${c.mode.toUpperCase()} view`, ...done].filter(Boolean).join("; ")}.` : "Nothing to change.";
  };
  /** Runs once the 3D view is up (it may only just have been switched to). */
  const whenReady = (fn: (api: Plan3DApi) => void, tries = 90) => {
    const api = api3d.current;
    if (api) requestAnimationFrame(() => requestAnimationFrame(() => fn(api)));
    else if (tries > 0) requestAnimationFrame(() => whenReady(fn, tries - 1));
    else toast("The 3D view did not open, so the render was not made.");
  };
  useAssistantLink(project.id, editor, plan, levelId, level?.name ?? "", selected, viewState, onView);
  // What a section box goes around: the selected furniture, room or wall.
  const selectionBox = useMemo(() => {
    if (!plan) return null;
    const none = { ...plan, walls: [], rooms: [], columns: [], reference: [], items: [], notes: [], dimensions: [], underlays: [] };
    const part = {
      ...none,
      items: plan.items.filter((i) => furnitureSelection.includes(i.id)),
      rooms: selection?.kind === "room" ? plan.rooms.filter((r) => r.id === selection.id) : [],
      walls: selection?.kind === "wall" ? plan.walls.filter((w) => w.id === selection.id) : [],
    };
    return planBounds(part);
  }, [plan, furnitureSelection, selection]);

  // Keyboard shortcuts for tools and undo, unless typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog]")) return;
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selected.length && viewMode === "2d" && !window.getSelection()?.toString()) {
        copySelection();
        e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v" && clip) {
        pasteClip();
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (viewMode === "3d" && selection && plan && target.closest(".plan-3d")) {
        let result: EditResult | undefined;
        if (e.key === "Delete" || e.key === "Backspace") result = furnitureSelection.length > 1 ? editFurniture(plan, furnitureSelection, "delete") : removeItem(plan, selection);
        if (e.key === " ") result = furnitureSelection.length > 1 ? editFurniture(plan, furnitureSelection, "rotate") : rotateItem(plan, selection);
        const step = e.shiftKey ? 100 : 10;
        const deltas: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
        if (deltas[e.key]) result = furnitureSelection.length > 1 ? editFurniture(plan, furnitureSelection, "move", { delta: deltas[e.key] }) : moveBy(plan, selection, deltas[e.key]);
        if (result) { e.preventDefault(); const error = onEdit(result); if (error) toast(error); return; }
      }
      if (viewMode === "3d" && e.key === "Escape") setSelection(null);
      if (viewMode === "2d" && e.key === "Escape" && together.length > 1) clearAll();
      // Views as in Blender: 1 front, 3 right, 7 top (Shift for the opposite side), 5 perspective or parallel, 0 the 3D view.
      if (viewMode === "3d" && /^(Digit|Numpad)[013579]$/.test(e.code)) {
        const n = e.code.slice(-1);
        if (n === "5") set3d({ projection: look3d.projection === "perspective" ? "orthographic" : "perspective" });
        else {
          const views: Record<string, [ViewPreset, ViewPreset]> = { "0": ["iso", "iso"], "1": ["front", "back"], "3": ["right", "left"], "7": ["top", "bottom"], "9": ["iso-sw", "iso-ne"] };
          set3d({ view: views[n][e.shiftKey ? 1 : 0] });
          setFitSignal((k) => k + 1);
        }
        e.preventDefault();
        return;
      }
      // Two-key hiding as in Revit: H then H (hide), I (isolate) or R (show all).
      const k = e.key.toLowerCase();
      if (hKey.current && Date.now() - hKey.current < 1500 && (k === "h" || k === "i" || k === "r")) {
        hKey.current = 0;
        e.preventDefault();
        if (k === "r") showAll();
        else hideSelected(k === "h" ? "hide" : "isolate");
        return;
      }
      if (k === "h" && !e.shiftKey) {
        hKey.current = Date.now();
        return;
      }
      hKey.current = 0;
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (t && plan && viewMode === "2d") setTool(t.tool);
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
  }); // Re-bound each render so the shortcuts see the current plan, selection and clipboard.

  const startWith = (next: Plan, summary: string, drawTool: Tool = "select") => {
    editor.replace(next, summary);
    setSelection(null);
    setViewMode("2d");
    setTool(drawTool);
    setFitSignal((n) => n + 1);
  };

  const readFile = async (file: File) => {
    if (!allowed("importDxf", "Importing DXF files")) return;
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
    if (!allowed("exportDxf", "DXF export")) return setExportOpen(false);
    const suffix = levels.length > 1 ? `-${level.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
    save(exportDxf(onLevel(plan, levelId), lib), `${fileBase}${suffix}.dxf`, "application/dxf");
    setExportOpen(false);
  };
  const downloadIfc = () => {
    if (!plan) return;
    if (!allowed("exportIfc", "IFC export")) return setExportOpen(false);
    save(exportIfc(plan, { projectName: project.name, description: `${title}, exported from Fundur` }), `${fileBase}.ifc`, "application/x-step");
    setExportOpen(false);
  };

  /** Lays a photo or scan under this floor, sized to the drawing (or 20 m wide), to trace and then scale. */
  const addImage = async (file: File) => {
    if (!plan || !level) return;
    if (!allowed("traceImage", "Tracing over a photo or scan")) return;
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
      <PlanFrame beforeNavigate={editor.flush} exitHref={exitHref} title={title} project={project} status="saved">
        <div className="plan-empty"><p className="muted">Loading the plan…</p></div>
      </PlanFrame>
    );
  }
  if (editor.loaded === "failed") {
    return (
      <PlanFrame beforeNavigate={editor.flush} exitHref={exitHref} title={title} project={project} status="error">
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
      <PlanFrame beforeNavigate={editor.flush} exitHref={exitHref} title={title} project={project} status={editor.status}>
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
              <button type="button" className="card card-link tool" onClick={() => allowed("importDxf", "Importing DXF files") && fileRef.current?.click()}>
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
      beforeNavigate={editor.flush}
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
          <button type="button" className="icon-btn" onClick={() => allowed("importDxf", "Importing DXF files") && fileRef.current?.click()} aria-label="Import a DXF file" title="Import a DXF file">
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
          {viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" && <button type="button" className="icon-btn" aria-label="Ask AI about this plan" onClick={() => setAssistantOpen(true)}><Sparkles size={17} /></button>}
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
        <div className="segmented plan-view-toggle" role="group" aria-label="Plan view">
          <button type="button" aria-pressed={viewMode === "2d"} onClick={() => setViewMode("2d")}>2D</button>
          <button type="button" aria-pressed={viewMode === "3d"} onClick={() => { setViewMode("3d"); setTool("select"); setCompare(null); }}><Box size={15} /> 3D</button>
        </div>
        {levels.length > 1 && !layout && (
          <select className="input plan-floor" value={levelId} onChange={(e) => setLevel(e.target.value)} aria-label="Floor">
            {[...levels].reverse().map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}
        {viewMode === "2d" && <div className="segmented plan-tools" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.tool}
              type="button"
              aria-pressed={tool === t.tool}
              onClick={() => { setTool(t.tool); if (t.tool === "item") setDetailsOpen(true); }}
              title={`${t.label} (${t.key})`}
            >
              {t.icon}
              <span className="plan-label">{t.label}</span>
            </button>
          ))}
        </div>}
        <span className="grow" />
        <div style={{ position: "relative" }}>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Layers" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
            <LayersIcon size={15} /> <span className="plan-label">Layers</span>
          </button>
          {layersOpen && (
            <div className="plan-popover" role="group" aria-label="Layers">
              {(Object.keys(LAYER_NAMES) as (keyof Layers)[])
                .filter((k) => viewMode === "2d" || ["walls", "openings", "columns", "rooms", "furniture"].includes(k))
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
              {viewMode === "2d" && (
                <div className="segmented" role="group" aria-label="Plan or ceiling" style={{ marginBottom: "0.25rem" }}>
                  <button type="button" aria-pressed={look === "floor"} onClick={() => setLook("floor")}>Floor plan</button>
                  <button type="button" aria-pressed={look === "ceiling"} onClick={() => setLook("ceiling")}>Ceiling plan</button>
                </div>
              )}
              {viewMode === "2d" && (
                <label className="row-between small" style={{ gap: "1rem" }}>
                  Door and window marks
                  <button type="button" role="switch" aria-checked={showMarks} className="switch" aria-label="Show door and window marks" onClick={() => setShowMarks(!showMarks)} />
                </label>
              )}
              <label className="stack small" style={{ gap: "0.3rem", marginTop: "0.25rem" }}>
                Phases
                <select className="input" value={phaseShown} onChange={(e) => setPhaseView(e.target.value as PhaseView)}>
                  {PHASE_VIEWS.map((p) => <option key={p.key} value={p.key} title={p.hint}>{p.label}</option>)}
                </select>
              </label>
              {viewMode === "2d" && (
                <label className="stack small" style={{ gap: "0.3rem", marginTop: "0.25rem" }}>
                  Colour rooms by
                  <select className="input" value={colourBy} onChange={(e) => setColourBy(e.target.value as ColourBy)}>
                    {COLOUR_BY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
        {/* On phones these scroll in one row beside 2D/3D and Layers, so the plan keeps the screen. */}
        <div className="plan-toolbar-more">
        <button type="button" className="icon-btn" onClick={() => setFitSignal((n) => n + 1)} aria-label="Fit the plan to the screen" title="Fit (F)">
          <Maximize size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setSheetsOpen(true)} aria-label="Sheets" title="Sheets: print to scale with a title block">
          <Printer size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setSchedulesOpen(true)} aria-label="Schedules" title="Schedules: furniture, rooms, doors and windows, walls">
          <Table2 size={16} />
        </button>
        <button type="button" className="icon-btn plan-keys-btn" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard size={16} />
        </button>
        <button type="button" className="icon-btn" onClick={() => setCommentsOpen(true)} aria-label="Team comments on the plan" title="Team comments">
          <MessageSquare size={16} />
        </button>
        <button type="button" className="icon-btn plan-details-toggle" aria-label="Plan details" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((o) => !o)}><SlidersHorizontal size={17} /></button>
        {viewMode === "2d" && <button type="button" className="btn btn-secondary btn-sm plan-multi-toggle" aria-label="Multi-select" title="Multi-select" aria-pressed={multiMode} onClick={() => { setMultiMode((m) => !m); setTool("select"); }}><MousePointer2 size={15} /><span className="plan-label">Multi-select</span></button>}
        </div>
      </div>
      {viewMode === "3d" && (
        <Plan3DBar
          projectId={project.id}
          projectName={project.name}
          plan={plan}
          levelId={levelId}
          levels={levels}
          api={api3d}
          settings={settings3d}
          set={set3d}
          multiFloor={levels.length > 1 && !layout}
          selectionBox={selectionBox}
          onEdit={onEdit}
          toast={toast}
          saveFile={fileStorage ? saveFile : undefined}
          aiAllowed={viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator"}
          panel={panel3d}
          setPanel={setPanel3d}
          aiRequest={aiRequest}
        />
      )}

      <div className="plan-work">
        <div className="plan-stage">
          {viewMode === "3d" ? (
            <>
              <Plan3D
                plan={shownPlan ?? plan}
                options={sceneOptions}
                lib={lib}
                view={look3d.view}
                projection={look3d.projection}
                style={look3d.style}
                shadows={look3d.shadows}
                slices={slices}
                onSlices={setSlices}
                selection={selection}
                selectionIds={furnitureSelection}
                onSelect={selectObject}
                onBack={() => setViewMode("2d")}
                fitSignal={fitSignal}
                apiRef={api3d}
              />
              <ViewCube
                view={look3d.view}
                projection={look3d.projection}
                onView={(v) => {
                  set3d({ view: v });
                  setFitSignal((n) => n + 1);
                }}
                onProjection={(p: Projection) => set3d({ projection: p })}
              />
            </>
          ) : <PlanCanvas
            plan={plan}
            levelId={levelId}
            roomFills={fill.fills.size ? fill.fills : undefined}
            hidden={hide}
            phase={phaseShown}
            marks={marks}
            look={look}
            viewKey={`plan.${project.id}.view.${levelId}`}
            compare={compare?.plan}
            layers={layers}
            tool={tool}
            placeType={placeType}
            underlaySrc={underlaySrc}
            selection={selection}
            onSelect={(target, additive) => selectObject(target, undefined, additive)}
            selectionIds={furnitureSelection}
            onMultiSelect={selectFurniture}
            others={othersHere}
            onOthers={setOthers}
            multiMode={multiMode}
            onEdit={onEdit}
            onToolDone={() => setTool("select")}
            onCalibrate={(a, b) => {
              setTool("select");
              setCalibration({ a, b });
            }}
            fitSignal={fitSignal}
            flagged={flagged}
            onDistanceSelect={(guideId) => {
              setDetailsOpen(true);
              requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`plan-distance-${guideId}`)?.focus({ preventScroll: false })));
            }}
          />}
          {viewMode === "2d" && fill.legend.length > 0 && (
            <div className="plan-legend" aria-label="Colour legend">
              <span className="tiny strong">{COLOUR_BY.find((c) => c.key === colourBy)?.label}</span>
              {fill.legend.map((r) => (
                <div key={r.label} className="plan-legend-row">
                  <i style={{ background: r.colour }} />
                  <span className="truncate">{r.label}{r.rooms > 1 ? ` (${r.rooms})` : ""}</span>
                  <span>{m2(r.area)}</span>
                </div>
              ))}
            </div>
          )}
          {viewMode === "2d" && phased && phaseShown !== "existing" && (
            <div className="plan-legend plan-phase-key" aria-label="Phases">
              <span className="tiny strong">{PHASE_VIEWS.find((p) => p.key === phaseShown)?.label}</span>
              <div className="plan-legend-row"><i data-phase="existing" /><span>Existing</span><span /></div>
              {phaseShown !== "new" && <div className="plan-legend-row"><i data-phase="demolished" /><span>To demolish</span><span /></div>}
              {phaseShown !== "demolition" && <div className="plan-legend-row"><i data-phase="new" /><span>New</span><span /></div>}
            </div>
          )}
          {viewMode === "2d" && look === "ceiling" && (
            <div className="plan-look-bar" role="status">
              <span className="small">Ceiling plan: ceilings, their heights and the lights</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLook("floor")}>Floor plan</button>
            </div>
          )}
          {hide && (
            <div className="plan-hidden-bar" role="status">
              <EyeOff size={15} />
              <span className="small">{hide.mode === "isolate" ? `Showing only ${hide.keys.length === 1 ? "one thing" : `${hide.keys.length} things`}` : `${hiddenHere === 1 ? "One thing" : `${hiddenHere} things`} hidden`} for now</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={showAll}>Show all</button>
            </div>
          )}
          {viewMode === "2d" && tool === "select" && selected.length > 0 && (
            <PlanMultiBar plan={plan} selection={selected} onEdit={(r) => { const error = onEdit(r); if (error) toast(error); return error; }} onSelected={selectMade} onClear={clearAll} onCopy={copySelection} onPaste={pasteClip} canPaste={!!clip} onMakeBlueprint={library ? makeBlueprint : undefined} onTool={setTool} onHide={hideSelected} onPhase={(p: Phase) => { const error = onEdit(setPhase(plan, selected, p)); if (error) toast(error); }} />
          )}
          <IssueMarker moduleKey="floor_plan_editor" projectId={project.id} className="pinned" />
        </div>
        <aside className="plan-side" aria-label="Plan details" data-open={detailsOpen} style={mobileDetails}>
          <button type="button" className="icon-btn plan-details-close" aria-label="Close plan details" onClick={() => setDetailsOpen(false)}><X size={18} /></button>
          <PlanObjects projectId={project.id} plan={plan} levelId={levelId} selected={selection} selectionIds={furnitureSelection} onSelect={selectObject} onMultiSelect={selectFurniture} onEdit={onEdit} layers={layers} onLayer={(key) => setLayers((l) => ({ ...l, [key]: !l[key] }))} />
          {furnitureSelection.length > 1 ? <p className="tiny muted">Select one object to edit its dimensions. Group actions above apply once to the whole selection.</p> :
          <Inspector
            plan={plan}
            levelId={levelId}
            onLevel={setLevel}
            selection={selection}
            onSelect={selectObject}
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
            onAddUnderlay={() => allowed("traceImage", "Tracing over a photo or scan") && imageRef.current?.click()}
            onCalibrate={() => {
              setSelection(null);
              setViewMode("2d");
              setTool("calibrate");
            }}
            underlayBusy={underlayBusy}
            extra={
              layout && report ? (
                <div className="stack" style={{ gap: "0.5rem" }}>
                  <span className="eyebrow">{layout.name}, checked as you go</span>
                  <span className="tiny muted">Against {layout.ruleSetName}: {report.metrics.desks} desks, score {report.metrics.score}.</span>
                  <IssueList issues={report.issues} onPick={(i) => setSelection({ kind: "item", id: i.itemIds[0] })} />
                </div>
              ) : undefined
            }
          />}
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
            setViewMode("2d");
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

      {commentsOpen && (
        <>
          <div className="scrim" onClick={() => setCommentsOpen(false)} />
          <div className="sheet plan-shortcuts" role="dialog" aria-label="Team comments on the plan" onKeyDown={(e) => e.key === "Escape" && setCommentsOpen(false)}>
            <div className="row-between" style={{ marginBottom: "0.75rem" }}>
              <h2 className="display-s">Plan comments</h2>
              <button type="button" className="icon-btn" onClick={() => setCommentsOpen(false)} aria-label="Close" autoFocus>
                <X size={18} />
              </button>
            </div>
            <TeamComments projectId={project.id} anchors={[{ key: "plan", label: "The plan" }]} title="For the team" />
          </div>
        </>
      )}

      {sheetsOpen && plan && (
        <SheetsSheet
          plan={plan}
          lib={lib}
          levelId={levelId}
          levelName={levels.find((l) => l.id === levelId)?.name ?? "This floor"}
          projectName={project.name}
          practice={viewer.workspaces?.find((w) => w.id === viewer.workspaceId)?.name}
          can3d={viewMode === "3d"}
          colourBy={colourBy}
          phase={phaseShown}
          marks={showMarks}
          look={look}
          capture3d={() => {
            const url = api3d.current?.capture({ width: 2_400, height: 1_700, mime: "image/jpeg" });
            return url ? { jpeg: dataUrlBytes(url), width: 2_400, height: 1_700 } : null;
          }}
          onClose={() => setSheetsOpen(false)}
          onKeep={async (file) => {
            try {
              await saveFile(file);
              toast(`${file.name} kept with the project's files`);
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
      )}
      {schedulesOpen && plan && (
        <SchedulesSheet
          plan={plan}
          lib={lib}
          levelId={levelId}
          levelName={levels.find((l) => l.id === levelId)?.name ?? "This floor"}
          projectName={project.name}
          onClose={() => setSchedulesOpen(false)}
          onPick={pickFromSchedule}
          onKeep={async (file) => {
            try {
              await saveFile(file);
              toast(`${file.name} kept with the project's files`);
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} tools={TOOLS.map((t) => ({ key: t.key, label: t.label }))} />}

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
  beforeNavigate,
  exitHref,
  title,
  project,
  status,
  onRetry,
  actions,
  children,
}: {
  beforeNavigate: () => Promise<boolean>;
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
        <DesignLink flush={beforeNavigate} href={exitHref} className="icon-btn" aria-label="Close the plan" title="Close">
          <X size={19} />
        </DesignLink>
        <div className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="small strong truncate">{title}</span>
          <span className="tiny muted truncate">{project.name}</span>
        </div>
        <SaveBadge status={status} onRetry={onRetry} />
        <span className="grow" />
        <div className="row plan-bar-actions" style={{ gap: "0.15rem" }}>{actions}</div>
      </header>
      <div className="plan-section-navigation"><ProjectNavigation project={project} beforeNavigate={beforeNavigate} compact /></div>
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
