"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { assistantBridge } from "@/lib/assistant/bridge";
import type { BlueprintViewCommand } from "@/lib/assistant/view-command";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Box,
  Circle,
  Copy,
  CopyPlus,
  FlipHorizontal2,
  FlipVertical2,
  History,
  Layers3,
  Maximize,
  Plus,
  Redo2,
  Save,
  Shapes,
  Trash2,
  Triangle,
  Sparkles,
  Undo2,
  Amphora,
  Cone,
  Hexagon,
  Move,
  RotateCw,
  Scaling,
  Ruler,
  Spline,
  X,
  Scissors,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Download,
  Upload,
  Play,
  ArrowDownToLine,
  AlignLeft,
  AlignCenter,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { useLibrary } from "./LibraryContext";
import { ProfileEditor } from "./ProfileEditor";
import { LibraryBrowser } from "./LibraryBrowser";
import { MaterialPicker } from "./MaterialPicker";
import { BlueprintThumb } from "./BlueprintThumb";
import { MeasureField, TextField } from "@/components/plan/PlanInspector";
import { LibraryConflict, bodyOf } from "@/lib/blueprints/client";
import {
  addShape,
  alignParts,
  arrayPart,
  copyOf,
  distributeParts,
  dropToFloor,
  duplicatePart,
  fitToParts,
  joinParts,
  mirrorPart,
  mirrorPartZ,
  nestBlueprint,
  problems,
  radialArrayPart,
  removePart,
  resizeBlueprint,
  separatePart,
  setLayers,
  updateBlueprint,
  updatePart,
  type BlueprintEdit,
  type PointEdit,
  editPoints,
  transformParts,
} from "@/lib/blueprints/edit";
import { distance as pointDistance, facesWithin, meshEdges, meshPoints, toMesh } from "@/lib/blueprints/mesh";
import { resolver, usedBy, wouldLoop, STANDARD, type Resolver } from "@/lib/blueprints/resolve";
import { wallThickness } from "@/lib/blueprints/defaults";
import {
  BLUEPRINT_CATEGORIES,
  isStandard,
  type Blueprint,
  type BlueprintCategory,
  type Part,
  type PartShape,
  type WallLayer,
} from "@/lib/blueprints/types";
import { LIBRARY } from "@/lib/plan/library";
import { emptyPlan, FIRST_LEVEL_ID, type Plan, type Slice } from "@/lib/plan/geometry";
import { useViewSetting, oneOf } from "@/lib/view-settings/client";
import { relativeTime } from "@/lib/studio/format";
import type { Dimension3D, ViewPreset, Projection, TransformMode } from "@/components/plan/Plan3D";
import { ViewCube } from "@/components/plan/Plan3DControls";
import type { SceneOptions } from "@/lib/plan/scene";
import { DETAILED_PRIMITIVES, createPrimitivePart } from "@/lib/blueprints/generators";
import { exportToOBJ, exportToSTL, exportToJSON, importFromOBJ } from "@/lib/blueprints/export";
import { LATHE_PRESETS, OUTLINE_PRESETS } from "@/lib/blueprints/forms";

const Plan3D = dynamic(() => import("@/components/plan/Plan3D"), {
  ssr: false,
  loading: () => (
    <div className="plan-3d-fallback">
      <p className="small muted">Loading 3D Modeling Engine…</p>
    </div>
  ),
});

/**
 * 3D Modeling Engine & Blueprint Editor.
 *
 * Full-featured parametric and poly-mesh modeling engine:
 * - Primitives (Box, Cylinder, Sphere, Wedge, Cone, Torus, Pyramid, Capsule, Pipe, Hex Column, Dome, Stairs, Arch).
 * - Lathe (Turned) & Extrusion with architectural profile presets (Cornice, Baseboard, Ogee, Bullnose, Fluted).
 * - Mesh point/edge/face modeling with Inset, Subdivide, Extrude (Push/Pull), Align, Weld, Split, Merge.
 * - Multi-part compound modeling: Join/Boolean Union, Separate islands, Drop to floor, Align & Distribute.
 * - Viewport: Interactive Cross-Section Cutter, Turntable showcase, Dimensions, Wireframe/Ghost modes.
 * - Outliner: Scene hierarchy with part visibility, locking, reordering, and bulk transforms.
 * - CAD Interchange: Export/Import Wavefront OBJ, STL (3D Printing), and Blueprint JSON.
 *
 * Usable both as a route page and as an embedded, reusable module anywhere in the platform.
 */

export interface BlueprintEditorProps {
  id?: string;
  blueprint?: Blueprint;
  onChange?: (blueprint: Blueprint) => void;
  onSave?: (blueprint: Blueprint, asNew?: boolean) => Promise<void> | void;
  onClose?: () => void;
  readOnly?: boolean;
  embedded?: boolean;
  className?: string;
  resolver?: Resolver;
  initialTab?: Tab;
  title?: string;
  headerActions?: React.ReactNode;
}

const SHAPES: { key: string; shape: PartShape; label: string; icon: React.ReactNode; init?: { taper?: number } }[] = [
  { key: "box", shape: "box", label: "Box", icon: <Box size={15} /> },
  { key: "cylinder", shape: "cylinder", label: "Cylinder", icon: <Circle size={15} /> },
  { key: "sphere", shape: "sphere", label: "Sphere", icon: <Circle size={15} strokeWidth={3} /> },
  { key: "wedge", shape: "wedge", label: "Wedge", icon: <Triangle size={15} /> },
  { key: "cone", shape: "cylinder", label: "Cone", icon: <Cone size={15} />, init: { taper: 0 } },
  { key: "lathe", shape: "lathe", label: "Turned", icon: <Amphora size={15} /> },
  { key: "extrude", shape: "extrude", label: "Extrusion", icon: <Hexagon size={15} /> },
];

const SHAPE_CHOICES: { shape: PartShape; label: string }[] = [
  { shape: "box", label: "Box" },
  { shape: "cylinder", label: "Cylinder" },
  { shape: "sphere", label: "Sphere" },
  { shape: "wedge", label: "Wedge" },
  { shape: "mesh", label: "Mesh: points and faces" },
  { shape: "lathe", label: "Turned (lathe)" },
  { shape: "extrude", label: "Extrusion" },
];

type HandleMode = TransformMode | "points";
const HANDLE_MODES: { mode: HandleMode; label: string; key: string; icon: React.ReactNode }[] = [
  { mode: "translate", label: "Move", key: "G", icon: <Move size={14} /> },
  { mode: "rotate", label: "Turn", key: "R", icon: <RotateCw size={14} /> },
  { mode: "scale", label: "Size", key: "S", icon: <Scaling size={14} /> },
  { mode: "points", label: "Points", key: "P", icon: <Spline size={14} /> },
];

const isHandleMode = oneOf<HandleMode>(["translate", "rotate", "scale", "points"]);
const SNAPS = [0, 1, 5, 10, 50, 100];
const isSnap = (v: unknown): v is number => typeof v === "number" && SNAPS.includes(v);
const TYPES = LIBRARY.map((i) => ({ type: i.type, name: i.name }));

type Tab = "parts" | "outliner" | "blueprint" | "layers" | "versions";
const isTab = oneOf<Tab>(["parts", "outliner", "blueprint", "layers", "versions"]);

const SCENE: SceneOptions = {
  levelId: FIRST_LEVEL_ID,
  allLevels: false,
  separated: false,
  cutWalls: false,
  layers: { walls: true, openings: true, columns: true, rooms: true, furniture: true },
};

const isView = (v: unknown): v is ViewPreset =>
  typeof v === "string" && /^(iso|top|bottom|front|back|left|right|iso-(ne|nw|se|sw))$/.test(v);
const isProjection = oneOf<Projection>(["perspective", "orthographic"]);
const isStyle = oneOf<"realistic" | "clay" | "lines">(["realistic", "clay", "lines"]);

type Mm = { x: number; y: number; z: number };

function boxDimensions(at: Mm, size: { w: number; d: number; h: number }, rotation: number): Dimension3D[] {
  const r = (rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const p = (x: number, y: number, z = at.z): Mm => ({ x: at.x + x * c - y * s, y: at.y + x * s + y * c, z });
  const dir = (x: number, y: number): Mm => ({ x: x * c - y * s, y: x * s + y * c, z: 0 });
  const k = Math.max(60, 0.12 * Math.max(size.w, size.d, size.h));
  const { w, d, h } = size;
  return [
    { a: p(-w / 2, -d / 2), b: p(w / 2, -d / 2), offset: dir(0, -k) },
    { a: p(w / 2, -d / 2), b: p(w / 2, d / 2), offset: dir(k, 0) },
    { a: p(w / 2, -d / 2), b: p(w / 2, -d / 2, at.z + h), offset: dir(k * 0.7, -k * 0.7) },
  ];
}

const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function stagePlan(bp: Blueprint): Plan {
  return {
    ...emptyPlan(),
    items: [
      {
        id: "blueprint",
        levelId: FIRST_LEVEL_ID,
        type: bp.type,
        blueprintId: bp.id,
        at: { x: 0, y: 0 },
        width: bp.size.w,
        depth: bp.size.d,
        height: bp.size.h,
        rotation: 0,
      },
    ],
  };
}

export function BlueprintEditor({
  id = "",
  blueprint: propBlueprint,
  onChange,
  onSave,
  onClose,
  readOnly = false,
  embedded = false,
  className = "",
  resolver: propResolver,
  initialTab = "parts",
  title,
  headerActions,
}: BlueprintEditorProps) {
  const { toast, viewer, setAssistantOpen } = useStudio();
  const library = useLibrary();
  const aiAllowed = viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";
  const canEdit = !readOnly && viewer.workspaceRole !== "collaborator";
  const router = useRouter();

  const fallbackSaved = useMemo(() => {
    if (propBlueprint) return propBlueprint;
    if (id && library) return library.resolver.blueprint(id);
    if (id) return (propResolver ?? STANDARD).blueprint(id);
    return undefined;
  }, [propBlueprint, id, library, propResolver]);

  const [history, setHistory] = useState<{ list: Blueprint[]; at: number } | null>(null);
  const draft = history && history.at > 0 ? history.list[history.at] : fallbackSaved;
  const [base, setBase] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [hiddenParts, setHiddenParts] = useState<Set<string>>(new Set());
  const [lockedParts, setLockedParts] = useState<Set<string>>(new Set());
  const [tab, setTab] = useViewSetting<Tab>("library.editor.tab", initialTab, isTab);
  const [view, setView] = useViewSetting<ViewPreset>("library.editor.view", "iso", isView);
  const [projection, setProjection] = useViewSetting<Projection>("library.editor.projection", "perspective", isProjection);
  const [style, setStyle] = useViewSetting<"realistic" | "clay" | "lines">("library.editor.style", "realistic", isStyle);
  const [fitSignal, setFitSignal] = useState(0);
  const [handles, setHandles] = useViewSetting<HandleMode>("library.editor.handles", "translate", isHandleMode);
  const [snap, setSnap] = useViewSetting<number>("library.editor.snap", 10, isSnap);
  const [showDims, setShowDims] = useViewSetting<boolean>("library.editor.dimensions", true, isBool);
  const [pointPick, setPointPick] = useState<{ part: string; ids: number[] }>({ part: "", ids: [] });
  const [nesting, setNesting] = useState(false);
  const [primitivesOpen, setPrimitivesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Blueprint | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Cross-section / Slicing Cutter state
  const [sectionActive, setSectionActive] = useState(false);
  const [sectionAxis, setSectionAxis] = useState<"x" | "y" | "z">("z");
  const [sectionPos, setSectionPos] = useState(0);
  const [sectionFlip, setSectionFlip] = useState(false);

  // Turntable animation showcase
  const [turntable, setTurntable] = useState(false);

  const standard = id ? isStandard(id) : false;
  const dirty = !!history && history.at > 0;

  // Turntable rotation cycle
  useEffect(() => {
    if (!turntable) return;
    const CYCLE: ViewPreset[] = ["iso", "iso-se", "front", "iso-sw", "left", "iso-nw", "back", "iso-ne", "right"];
    let idx = 0;
    const timer = setInterval(() => {
      idx = (idx + 1) % CYCLE.length;
      setView(CYCLE[idx]);
    }, 2000);
    return () => clearInterval(timer);
  }, [turntable, setView]);

  // Stage draft with hidden parts filtered out
  const stagedDraft = useMemo(() => {
    if (!draft) return null;
    if (!hiddenParts.size) return draft;
    return { ...draft, parts: draft.parts.filter((p) => !hiddenParts.has(p.id)) };
  }, [draft, hiddenParts]);

  // Library resolver with active draft
  const lib: Resolver = useMemo(() => {
    const baseResolver = propResolver ?? library?.resolver ?? STANDARD;
    if (!stagedDraft) return baseResolver;
    const existing = baseResolver.blueprints.filter((b) => b.id !== stagedDraft.id);
    return resolver({ blueprints: [...existing, stagedDraft], materials: library?.library.materials ?? [] });
  }, [stagedDraft, library, propResolver]);

  const plan = useMemo(() => (stagedDraft ? stagePlan(stagedDraft) : null), [stagedDraft]);

  // Section clipping slices
  const slices: Slice[] = useMemo(() => {
    if (!sectionActive || !draft) return [];
    return [
      {
        id: "blueprint-section",
        axis: sectionAxis,
        at: sectionPos,
        flip: sectionFlip,
        enabled: true,
      },
    ];
  }, [sectionActive, draft, sectionAxis, sectionPos, sectionFlip]);

  const apply = useCallback(
    (result: BlueprintEdit) => {
      if (!result.ok) {
        toast(result.error);
        return result.error;
      }
      setHistory((h) => {
        const list = h ? h.list.slice(0, h.at + 1) : [fallbackSaved!];
        return { list: [...list, result.blueprint].slice(-100), at: Math.min(list.length, 99) };
      });
      onChange?.(result.blueprint);
      if (result.partId) setSelected([result.partId]);
      return null;
    },
    [fallbackSaved, toast, onChange]
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h || h.at <= 0) return h;
      const nextAt = h.at - 1;
      onChange?.(h.list[nextAt]);
      return { ...h, at: nextAt };
    });
  }, [onChange]);

  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h || h.at >= h.list.length - 1) return h;
      const nextAt = h.at + 1;
      onChange?.(h.list[nextAt]);
      return { ...h, at: nextAt };
    });
  }, [onChange]);

  // Warn before unload if dirty
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const parts = draft?.parts ?? [];
  const part = selected.length === 1 ? parts.find((p) => p.id === selected[0]) : undefined;

  // Point editing mesh
  const editingPoints = canEdit && draft?.kind === "object" && handles === "points" && !!part && !part.blueprintId;
  const meshPart = useMemo(() => {
    if (!editingPoints || !part) return null;
    const m = toMesh(part);
    return typeof m === "string" ? null : m;
  }, [editingPoints, part]);

  const pointAt = useMemo(() => (meshPart ? meshPoints(meshPart) : []), [meshPart]);
  const pointEdges = useMemo(() => (meshPart?.mesh ? meshEdges(meshPart.mesh) : []), [meshPart]);
  const pointTargets = useMemo(() => {
    if (!meshPart) return [];
    const out: { x: number; y: number; z: number }[] = [];
    for (const p of draft?.parts ?? []) {
      if (p.id === meshPart.id || p.blueprintId || out.length > 3_000) continue;
      const m = toMesh(p);
      if (typeof m !== "string") out.push(...meshPoints(m));
    }
    return out;
  }, [meshPart, draft]);

  const pickedPoints = useMemo(
    () => (meshPart && pointPick.part === meshPart.id ? pointPick.ids.filter((i) => i < pointAt.length) : []),
    [meshPart, pointPick, pointAt.length]
  );

  // Dimensions
  const dimensions = useMemo((): Dimension3D[] | undefined => {
    if (!showDims || !draft || draft.kind !== "object") return undefined;
    if (meshPart && pickedPoints.length === 2) return [{ a: pointAt[pickedPoints[0]], b: pointAt[pickedPoints[1]] }];
    if (meshPart && pickedPoints.length) return undefined;
    const one = selected.length === 1 ? draft.parts.find((p) => p.id === selected[0]) : undefined;
    if (one) return boxDimensions(one.at, one.size, one.rotation);
    if (selected.length) return undefined;
    return boxDimensions({ x: 0, y: 0, z: 0 }, draft.size, 0);
  }, [showDims, draft, selected, meshPart, pickedPoints, pointAt]);

  const editPoint = useCallback(
    (e: PointEdit) => {
      if (!draft || !part) return "Pick a part.";
      const r = editPoints(draft, part.id, e);
      const error = apply(r);
      if (!error && r.ok) setPointPick({ part: part.id, ids: r.points ?? [] });
      return error;
    },
    [draft, part, apply]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && k === "y") {
        e.preventDefault();
        redo();
      } else if ((e.metaKey || e.ctrlKey) && k === "j" && draft && selected.length >= 2) {
        e.preventDefault();
        apply(joinParts(draft, selected));
      } else if ((e.metaKey || e.ctrlKey) && k === "d" && draft && selected.length) {
        e.preventDefault();
        let bp = draft;
        for (const pid of selected) {
          const r = duplicatePart(bp, pid);
          if (r.ok) bp = r.blueprint;
        }
        apply({ ok: true, blueprint: bp, summary: "Duplicated" });
      } else if ((k === "delete" || k === "backspace") && pickedPoints.length) {
        e.preventDefault();
        editPoint({ op: "delete", points: pickedPoints });
      } else if (k === "escape" && pickedPoints.length) {
        setPointPick({ part: "", ids: [] });
      } else if ((k === "delete" || k === "backspace") && draft && selected.length) {
        e.preventDefault();
        let bp = draft;
        for (const pid of selected) {
          const r = removePart(bp, pid);
          if (r.ok) bp = r.blueprint;
        }
        apply({ ok: true, blueprint: bp, summary: "Removed" });
        setSelected([]);
      } else if (k === "escape") {
        setSelected([]);
      } else if (!e.metaKey && !e.ctrlKey && !e.altKey && (k === "g" || k === "r" || k === "s" || k === "p")) {
        setHandles(k === "g" ? "translate" : k === "r" ? "rotate" : k === "s" ? "scale" : "points");
      } else if (k === "f" && !e.metaKey && !e.ctrlKey) {
        setFitSignal((n) => n + 1);
      } else if (k === "d" && !e.metaKey && !e.ctrlKey) {
        setShowDims((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, draft, selected, apply, setHandles, pickedPoints, editPoint, setShowDims]);

  // Assistant bridge
  const flushRef = useRef<() => Promise<boolean>>(async () => true);
  const assistantView = useCallback(
    (c: BlueprintViewCommand) => {
      const done: string[] = [];
      const all = draft?.parts ?? [];
      if (c.parts) {
        setSelected(c.parts === "all" ? all.map((p) => p.id) : c.parts === "none" ? [] : c.parts.filter((id) => all.some((p) => p.id === id)));
        done.push("selection");
      }
      if (c.points) {
        const one = c.parts && c.parts !== "all" && c.parts !== "none" && c.parts.length === 1 ? c.parts[0] : selected.length === 1 ? selected[0] : null;
        if (one) {
          setPointPick({ part: one, ids: c.points });
          setHandles("points");
          done.push("points");
        }
      }
      if (c.handles) setHandles(c.handles === "move" ? "translate" : c.handles === "turn" ? "rotate" : c.handles === "size" ? "scale" : "points");
      if (c.view) setView(c.view);
      if (c.projection) setProjection(c.projection);
      if (c.style) setStyle(c.style);
      if (c.snap != null) setSnap(c.snap);
      if (c.view || c.fit) setFitSignal((n) => n + 1);
      return done.join(", ") || "view";
    },
    [draft, selected, setHandles, setView, setProjection, setStyle, setSnap]
  );

  useEffect(() => {
    if (!id) return;
    assistantBridge.setBlueprint(
      { blueprintId: id, parts: selected, points: pickedPoints, handles: handles === "translate" ? "move" : handles === "rotate" ? "turn" : handles === "scale" ? "size" : "points" },
      { blueprintId: id, flush: () => flushRef.current(), view: assistantView }
    );
  }, [id, selected, pickedPoints, handles, assistantView]);

  useEffect(() => () => {
    if (id) assistantBridge.releaseBlueprint(id);
  }, [id]);

  const save = async (asNew: boolean) => {
    if (!canEdit || !draft) return;
    if (onSave) {
      setBusy(true);
      try {
        await onSave(draft, asNew);
        setHistory(null);
        toast("Saved");
      } catch (err) {
        toast((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!library) return;
    const users = usedBy(lib, draft.id);
    setBusy(true);
    try {
      if (asNew || standard) {
        const name = asNew && !standard ? `${draft.name} (copy)` : draft.name;
        const entry = (await library.create("blueprint", { ...copyOf(draft, name), basedOn: draft.basedOn && standard ? draft.basedOn : draft.id })) as Blueprint;
        setHistory(null);
        toast(`${entry.name} saved in your library`);
        router.replace(`/library/${encodeURIComponent(entry.id)}`);
      } else {
        const entry = (await library.update(draft.id, base ?? fallbackSaved!.revision, bodyOf(draft))) as Blueprint;
        setHistory(null);
        setBase(null);
        void entry;
        toast(users.length ? `Saved. ${users.length} other blueprint${users.length === 1 ? "" : "s"} and every plan using it now show the change.` : "Saved. Every plan using it now shows the change.");
      }
    } catch (err) {
      if (err instanceof LibraryConflict) setConflict(err.current as Blueprint);
      else toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useLayoutEffect(() => {
    flushRef.current = async () => {
      if (!dirty || standard || !canEdit) return true;
      await save(false);
      return true;
    };
  });

  if (library?.status === "loading" && !fallbackSaved) {
    return (
      <div className="plan-empty">
        <p className="muted">Loading 3D Modeling Engine…</p>
      </div>
    );
  }

  if (!draft || !plan) {
    return (
      <div className="plan-empty">
        <div className="stack" style={{ gap: "0.75rem", maxWidth: 420 }}>
          <h1 className="display-s">Blueprint not found</h1>
          <p className="small muted">It may have been removed from the library.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => (onClose ? onClose() : router.push("/library"))}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const issues = problems(lib, draft);
  const users = usedBy(lib, draft.id);

  const remove = async () => {
    if (standard || !canEdit || !library) return;
    if (!window.confirm(`Remove ${draft.name} from the library?`)) return;
    try {
      await library.remove(draft.id);
      setHistory(null);
      toast(`${draft.name} removed`);
      router.replace("/library");
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const onPart = (partId: string | null, additive: boolean) => {
    if (!partId) return setSelected([]);
    if (lockedParts.has(partId)) return;
    setSelected((s) => (additive ? (s.includes(partId) ? s.filter((x) => x !== partId) : [...s, partId]) : [partId]));
    setTab("parts");
    if (!window.matchMedia("(max-width: 640px)").matches) setPanelOpen(true);
  };

  return (
    <div className={`plan-shell bp-shell ${className}`}>
      {/* Top Header Bar */}
      <header className="plan-bar">
        {embedded ? (
          <button type="button" className="icon-btn" aria-label="Close 3D Modeler" onClick={onClose} title="Close">
            <X size={19} />
          </button>
        ) : (
          <Link
            href="/library"
            className="icon-btn"
            aria-label="Back to the library"
            title="Back to the library"
            onClick={(e) => dirty && !window.confirm("Leave without saving your changes?") && e.preventDefault()}
          >
            <ArrowLeft size={19} />
          </Link>
        )}
        <div className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="small strong truncate">{title ?? draft.name}</span>
          <span className="tiny muted truncate">
            {standard ? "Default blueprint" : dirty ? "Unsaved changes" : fallbackSaved?.updatedAt ? `Saved ${relativeTime(fallbackSaved.updatedAt)}` : "3D Modeling Studio"}
          </span>
        </div>
        <span className="grow" />
        <div className="row plan-bar-actions" style={{ gap: "0.2rem" }}>
          {headerActions}
          {aiAllowed && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAssistantOpen(true)} title="Ask AI to model or tweak this">
              <Sparkles size={15} /> <span className="plan-label">Ask AI</span>
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExportOpen(true)} title="Export or Import CAD files (OBJ, STL, JSON)">
            <Download size={15} /> <span className="plan-label">3D File</span>
          </button>
          <button type="button" className="icon-btn" onClick={undo} disabled={!history || history.at === 0} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 size={17} />
          </button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!history || history.at >= history.list.length - 1} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={17} />
          </button>
          {canEdit && !standard && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(true)} title="Save a copy">
              <Copy size={15} /> <span className="plan-label">Save as new</span>
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || (!dirty && !standard && !onSave)} onClick={() => save(false)}>
              <Save size={15} /> {standard ? "Save as new" : "Save"}
            </button>
          )}
        </div>
      </header>

      {/* Standard default blueprint banner */}
      {standard && (
        <div className="plan-banner" role="status">
          <Layers3 size={16} />
          <span className="small grow">This is a default blueprint. Make any changes and save as your own.</span>
        </div>
      )}

      {/* Conflict banner */}
      {conflict && (
        <div className="plan-banner" role="alert">
          <span className="small grow">Someone else updated {conflict.name} since you opened it.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setHistory(null); setBase(null); setConflict(null); }}>
            Load theirs
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setBase(conflict.revision); setConflict(null); }}>
            Keep mine
          </button>
        </div>
      )}

      {/* Main Modeling Toolbar */}
      <div className="v3-wrap bp-toolbar">
        <div className="v3-bar" role="toolbar" aria-label="3D Modeling Tools">
          {SHAPES.map((s) => (
            <button
              key={s.key}
              type="button"
              className="v3-btn"
              disabled={!canEdit}
              onClick={() => {
                if (!apply(addShape(draft, s.shape, { ...(s.init ?? {}), ...(s.key === "cone" ? { name: "Cone" } : {}) }))) setFitSignal((n) => n + 1);
              }}
              title={`Add ${s.label}`}
            >
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}

          {/* More Primitives Menu */}
          <button
            type="button"
            className="v3-btn"
            disabled={!canEdit}
            aria-expanded={primitivesOpen}
            onClick={() => setPrimitivesOpen((o) => !o)}
            title="More 3D Primitives (Torus, Pyramid, Capsule, Pipe, Dome, Stairs, Arch)"
          >
            <Plus size={15} />
            <span>More 3D</span>
          </button>

          <button type="button" className="v3-btn" disabled={!canEdit} aria-expanded={nesting} onClick={() => setNesting((n) => !n)} title="Nest a blueprint inside">
            <Shapes size={15} />
            <span>Blueprint</span>
          </button>

          <span className="grow" />

          {/* Cross Section Tool */}
          <button
            type="button"
            className="icon-btn"
            aria-pressed={sectionActive}
            onClick={() => setSectionActive((a) => !a)}
            title="Cross-Section Cutter (slice through the 3D model)"
          >
            <Scissors size={16} />
          </button>

          {/* Turntable Showcase */}
          <button
            type="button"
            className={`icon-btn ${turntable ? "bp-turntable-active" : ""}`}
            aria-pressed={turntable}
            onClick={() => setTurntable((t) => !t)}
            title="Turntable 360° showcase spin"
          >
            <Play size={16} />
          </button>

          {/* Shading Style */}
          <div className="segmented" role="group" aria-label="Shading style">
            {(["realistic", "clay", "lines"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={style === k} onClick={() => setStyle(k)}>
                {k === "realistic" ? "Materials" : k === "clay" ? "Clay" : "Lines"}
              </button>
            ))}
          </div>

          <button type="button" className="icon-btn" aria-pressed={showDims} onClick={() => setShowDims(!showDims)} aria-label="Dimensions" title="Dimensions in mm (D)">
            <Ruler size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={() => setFitSignal((n) => n + 1)} aria-label="Fit to the screen" title="Fit (F)">
            <Maximize size={16} />
          </button>
          <button type="button" className="icon-btn plan-details-toggle" aria-label="Details" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            <Layers3 size={17} />
          </button>
        </div>

        {/* Detailed Primitives Popup */}
        {primitivesOpen && (
          <div className="v3-panel bp-nest" role="dialog" aria-label="3D Modeling Primitives">
            <button type="button" className="icon-btn v3-close" aria-label="Close" onClick={() => setPrimitivesOpen(false)}>
              <X size={16} />
            </button>
            <h2 className="display-s">3D Modeling Primitives</h2>
            <p className="tiny muted" style={{ marginBottom: "0.6rem" }}>
              Procedural parametric shapes with clean poly-mesh topology.
            </p>
            <div className="bp-primitives-grid">
              {DETAILED_PRIMITIVES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="bp-primitive-btn"
                  onClick={() => {
                    const newPart = createPrimitivePart(item.key, { x: 0, y: 0, z: 0 });
                    if (newPart) {
                      apply({ ok: true, blueprint: { ...draft, parts: [...draft.parts, newPart] }, summary: `Added ${item.label}`, partId: newPart.id });
                      setPrimitivesOpen(false);
                      setFitSignal((n) => n + 1);
                    }
                  }}
                >
                  <Box size={22} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Nesting Blueprint Picker */}
        {nesting && (
          <div className="v3-panel bp-nest" role="dialog" aria-label="Add a blueprint">
            <button type="button" className="icon-btn v3-close" aria-label="Close" onClick={() => setNesting(false)}>
              <X size={16} />
            </button>
            <h2 className="display-s">Add a blueprint inside</h2>
            <p className="tiny muted" style={{ marginBottom: "0.6rem" }}>It stays linked: change that blueprint and this one changes too.</p>
            <LibraryBrowser
              lib={lib}
              kind="any"
              compact
              settingKey="library.nest"
              exclude={(b) => wouldLoop(lib, draft.id, b.id)}
              onPick={(b) => {
                if (!apply(nestBlueprint(lib, draft, b.id))) {
                  setNesting(false);
                  setFitSignal((n) => n + 1);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Work Area */}
      <div className="plan-work">
        <div className="plan-stage">
          {/* Interactive Cross-Section Clipper Floating Bar */}
          {sectionActive && (() => {
            const axisExtent = sectionAxis === "x" ? draft.size.w : sectionAxis === "y" ? draft.size.d : draft.size.h;
            const minVal = sectionAxis === "z" ? 0 : -axisExtent / 2;
            const maxVal = sectionAxis === "z" ? draft.size.h : axisExtent / 2;
            return (
              <div className="bp-cutter-bar" role="region" aria-label="Section Cutter">
                <Scissors size={15} style={{ color: "var(--accent)" }} />
                <div className="segmented" style={{ transform: "scale(0.85)" }}>
                  {(["x", "y", "z"] as const).map((ax) => (
                    <button key={ax} type="button" aria-pressed={sectionAxis === ax} onClick={() => setSectionAxis(ax)}>
                      {ax.toUpperCase()}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  className="bp-cutter-slider"
                  min={minVal}
                  max={maxVal}
                  value={sectionPos}
                  onChange={(e) => setSectionPos(Number(e.target.value))}
                  title="Cut position"
                />
                <span className="tiny tabular muted">{Math.round(sectionPos)} mm</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSectionFlip((f) => !f)} title="Flip cut side">
                  Flip
                </button>
                <button type="button" className="icon-btn" onClick={() => setSectionActive(false)} title="Close section">
                  <X size={14} />
                </button>
              </div>
            );
          })()}

          <Plan3D
            plan={plan}
            options={SCENE}
            lib={lib}
            view={view}
            projection={projection}
            style={style}
            shadows
            slices={slices}
            selection={null}
            selectedParts={selected}
            onSelect={() => undefined}
            onPart={onPart}
            onBack={() => (onClose ? onClose() : router.push("/library"))}
            fitSignal={fitSignal}
            hint={false}
            dimensions={dimensions}
            transform={
              canEdit && draft.kind === "object" && selected.length && handles !== "points"
                ? { mode: handles, snap, onCommit: (ids, change) => apply(transformParts(draft, ids, change)) }
                : undefined
            }
            points={
              meshPart
                ? {
                    at: pointAt,
                    edges: pointEdges,
                    selected: pickedPoints,
                    snap,
                    targets: pointTargets,
                    onPick: (i, additive) =>
                      setPointPick(
                        i == null
                          ? { part: meshPart.id, ids: [] }
                          : {
                              part: meshPart.id,
                              ids: additive ? (pickedPoints.includes(i) ? pickedPoints.filter((x) => x !== i) : [...pickedPoints, i]) : [i],
                            }
                      ),
                    onMove: (ids, by) => editPoint({ op: "move", points: ids, by }),
                  }
                : undefined
            }
          />

          {meshPart && (
            <PointsBar
              at={pointAt}
              picked={pickedPoints}
              faces={meshPart.mesh ? facesWithin(meshPart.mesh, pickedPoints) : []}
              snap={snap}
              setSnap={setSnap}
              edit={editPoint}
              onPickAll={() => setPointPick({ part: meshPart.id, ids: pointAt.map((_, i) => i) })}
            />
          )}

          {canEdit && draft.kind === "object" && selected.length > 0 && (
            <div className="segmented bp-handles" role="group" aria-label="Handles">
              <button type="button" className="bp-handles-details" onClick={() => setPanelOpen(true)} title="Details">
                <span>{selected.length === 1 ? (part?.name ?? "Part") : `${selected.length} parts`}</span>
              </button>
              {HANDLE_MODES.map((m) => (
                <button key={m.mode} type="button" aria-pressed={handles === m.mode} onClick={() => setHandles(m.mode)} title={`${m.label} (${m.key})`}>
                  {m.icon}
                  <span>{m.label}</span>
                </button>
              ))}
              {handles === "translate" && (
                <select className="bp-snap" value={snap} onChange={(e) => setSnap(Number(e.target.value))} aria-label="Snap moves to" title="Snap moves to a grid; parts also snap onto each other's faces">
                  {SNAPS.map((n) => (
                    <option key={n} value={n}>
                      {n ? `${n} mm` : "Free"}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <ViewCube
            view={view}
            projection={projection}
            onView={(v) => {
              setView(v);
              setFitSignal((n) => n + 1);
            }}
            onProjection={setProjection}
          />
        </div>

        {/* Sidebar Details & Outliner Panel */}
        <aside className="plan-side" aria-label="Blueprint details" data-open={panelOpen}>
          <button type="button" className="icon-btn plan-details-close" aria-label="Close details" onClick={() => setPanelOpen(false)}>
            <X size={18} />
          </button>
          <div className="segmented bp-tabs" role="group" aria-label="Details tabs">
            {(
              [
                ["parts", "Parts"],
                ["outliner", "Outliner"],
                ["blueprint", "Blueprint"],
                ...(draft.kind === "wall" ? [["layers", "Layers"]] : []),
                ...(!standard && library ? [["versions", "Versions"]] : []),
              ] as [Tab, string][]
            ).map(([k, text]) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
                {text}
              </button>
            ))}
          </div>

          {issues.length > 0 && (
            <ul className="bp-issues" role="alert">
              {issues.map((t) => (
                <li key={t} className="tiny">
                  {t}
                </li>
              ))}
            </ul>
          )}

          {tab === "parts" && (
            <PartsTab
              lib={lib}
              bp={draft}
              selected={selected}
              setSelected={setSelected}
              part={part}
              apply={apply}
              canEdit={canEdit}
            />
          )}

          {tab === "outliner" && (
            <OutlinerTab
              lib={lib}
              bp={draft}
              selected={selected}
              setSelected={setSelected}
              hiddenParts={hiddenParts}
              setHiddenParts={setHiddenParts}
              lockedParts={lockedParts}
              setLockedParts={setLockedParts}
              apply={apply}
              canEdit={canEdit}
            />
          )}

          {tab === "blueprint" && (
            <BlueprintTab
              lib={lib}
              bp={draft}
              apply={apply}
              users={users}
              canEdit={canEdit}
              onRemove={!standard && canEdit && library ? remove : undefined}
            />
          )}

          {tab === "layers" && draft.kind === "wall" && <LayersTab lib={lib} bp={draft} apply={apply} canEdit={canEdit} />}

          {tab === "versions" && !standard && library && (
            <VersionsTab
              id={draft.id}
              revision={fallbackSaved?.revision ?? 0}
              versions={library.versions}
              onRestore={(body) => {
                apply({
                  ok: true,
                  blueprint: { ...draft, ...(body as Omit<Blueprint, "id" | "revision">), id: draft.id, revision: draft.revision },
                  summary: "Restored",
                });
                toast("Restored as a draft. Save to keep it.");
              }}
            />
          )}
        </aside>
      </div>

      {/* Export & Import Modal */}
      {exportOpen && (
        <ExportImportModal
          bp={draft}
          lib={lib}
          onClose={() => setExportOpen(false)}
          onImport={(imported) => {
            apply({
              ok: true,
              blueprint: { ...draft, parts: [...draft.parts, ...imported.parts] },
              summary: "Imported 3D mesh",
            });
            setExportOpen(false);
            setFitSignal((n) => n + 1);
            toast("3D model imported into blueprint");
          }}
        />
      )}
    </div>
  );
}

/** Under the 3D view while editing points: where the picked points are and advanced mesh modeling tools. */
function PointsBar({
  at,
  picked,
  faces,
  snap,
  setSnap,
  edit,
  onPickAll,
}: {
  at: { x: number; y: number; z: number }[];
  picked: number[];
  faces: number[];
  snap: number;
  setSnap: (n: number) => void;
  edit: (e: PointEdit) => string | null;
  onPickAll: () => void;
}) {
  const [push, setPush] = useState(50);
  const [inset, setInset] = useState(25);
  const step = snap || 1;
  const one = picked.length === 1 ? at[picked[0]] : undefined;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const nudge = (axis: "x" | "y" | "z", sign: 1 | -1) => edit({ op: "move", points: picked, by: { x: 0, y: 0, z: 0, [axis]: sign * step } });

  return (
    <div className="bp-points" role="group" aria-label="Points">
      <div className="bp-points-row">
        <strong className="small">
          {picked.length === 0
            ? `${at.length} vertices: tap one`
            : picked.length === 1
            ? `Vertex ${picked[0]}`
            : `${picked.length} vertices${faces.length ? `, ${faces.length} face${faces.length === 1 ? "" : "s"}` : ""}`}
        </strong>
        {picked.length === 2 && <span className="small bp-points-dim">{r1(pointDistance(at[picked[0]], at[picked[1]]))} mm apart</span>}
        <label className="tiny bp-points-snap">
          Snap
          <select className="input" value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
            {SNAPS.map((n) => (
              <option key={n} value={n}>
                {n ? `${n} mm` : "Off"}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onPickAll}>
          All
        </button>
      </div>

      {one && (
        <div className="bp-points-row bp-points-xyz" key={picked[0]}>
          {(["x", "y", "z"] as const).map((k) => (
            <MeasureField key={`${k}${one[k]}`} label={k.toUpperCase()} value={r1(one[k])} onCommit={(v) => edit({ op: "set", point: picked[0], at: { [k]: v } })} />
          ))}
        </div>
      )}

      {picked.length > 0 && (
        <>
          <div className="bp-points-row" aria-label="Nudge">
            {(["x", "y", "z"] as const).map((k) => (
              <span key={k} className="bp-points-nudge">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudge(k, -1)} aria-label={`${k.toUpperCase()} minus ${step} mm`}>
                  {k.toUpperCase()}−
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => nudge(k, 1)} aria-label={`${k.toUpperCase()} plus ${step} mm`}>
                  {k.toUpperCase()}+
                </button>
              </span>
            ))}
            {picked.length >= 2 && (
              <span className="bp-points-nudge">
                {(["x", "y", "z"] as const).map((ax) => (
                  <button key={ax} type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "align_points", points: picked, axis: ax, mode: "center" })} title={`Align picked points on ${ax.toUpperCase()}`}>
                    Align {ax.toUpperCase()}
                  </button>
                ))}
              </span>
            )}
          </div>

          <div className="bp-points-row">
            {picked.length >= 2 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "split", points: picked })} title="A new point in the middle of each edge between them">
                Split
              </button>
            )}
            {picked.length >= 2 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "merge", points: picked })} title="Join them into one point in their middle">
                Merge
              </button>
            )}
            {picked.length >= 2 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "weld", threshold: snap || 2 })} title="Weld close vertices">
                Weld
              </button>
            )}
            {picked.length >= 3 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "face", points: picked })} title="A face through them, in the order picked">
                Face
              </button>
            )}

            {faces.length > 0 && (
              <>
                <span className="bp-points-push">
                  <input className="input" type="number" inputMode="decimal" step={step} value={push} onChange={(e) => setPush(Number(e.target.value) || 0)} aria-label="Push or pull distance, mm" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "extrude", faces, distance: push })} title="Extrude / Push-Pull faces along normal">
                    Push/Pull
                  </button>
                </span>
                <span className="bp-points-push">
                  <input className="input" type="number" inputMode="decimal" step={step} value={inset} onChange={(e) => setInset(Number(e.target.value) || 0)} aria-label="Inset distance, mm" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "inset", faces, distance: inset })} title="Inset faces to create frames or panels (I)">
                    Inset (I)
                  </button>
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "subdivide", faces })} title="Subdivide faces for smooth details">
                  Subdivide
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "flip", faces })}>
                  Flip
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => edit({ op: "delete_faces", faces })}>
                  Remove face{faces.length === 1 ? "" : "s"}
                </button>
              </>
            )}
            <button type="button" className="btn btn-ghost btn-sm bp-points-danger" onClick={() => edit({ op: "delete", points: picked })}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Outliner hierarchy tree showing all parts with visibility toggles, locks, and multi-part transforms. */
function OutlinerTab({
  lib,
  bp,
  selected,
  setSelected,
  hiddenParts,
  setHiddenParts,
  lockedParts,
  setLockedParts,
  apply,
  canEdit,
}: {
  lib: Resolver;
  bp: Blueprint;
  selected: string[];
  setSelected: (ids: string[]) => void;
  hiddenParts: Set<string>;
  setHiddenParts: React.Dispatch<React.SetStateAction<Set<string>>>;
  lockedParts: Set<string>;
  setLockedParts: React.Dispatch<React.SetStateAction<Set<string>>>;
  apply: (r: BlueprintEdit) => string | null;
  canEdit: boolean;
}) {
  const toggleVisibility = (id: string) => {
    setHiddenParts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleLock = (id: string) => {
    setLockedParts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveOrder = (index: number, delta: number) => {
    const nextParts = [...bp.parts];
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= nextParts.length) return;
    const [p] = nextParts.splice(index, 1);
    nextParts.splice(targetIdx, 0, p);
    apply({ ok: true, blueprint: { ...bp, parts: nextParts }, summary: "Reordered parts" });
  };

  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      {/* Multi-selection batch modeling tools */}
      {selected.length > 0 && (
        <div className="bp-modeling-section">
          <span className="bp-modeling-section-title">{selected.length} Selected Parts</span>
          <div className="row" style={{ gap: "0.3rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => apply(dropToFloor(bp, selected))} title="Drop underside of parts to ground Z=0">
              <ArrowDownToLine size={13} /> Drop to Floor
            </button>
            {selected.length >= 2 && (
              <>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => apply(joinParts(bp, selected))} title="Join selected shapes into a single compound mesh (Ctrl+J)">
                  <Box size={13} /> Join into Mesh
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => apply(alignParts(bp, selected, "x", "center"))} title="Center align on X">
                  <AlignCenter size={13} /> Align X
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => apply(alignParts(bp, selected, "y", "center"))} title="Center align on Y">
                  <AlignLeft size={13} /> Align Y
                </button>
              </>
            )}
            {selected.length >= 3 && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => apply(distributeParts(bp, selected, "x"))} title="Distribute parts evenly along X">
                Distribute X
              </button>
            )}
          </div>
        </div>
      )}

      {/* Parts list in outliner */}
      <ul className="bp-outliner-list" aria-label="Scene Hierarchy">
        {bp.parts.length === 0 && <li className="tiny muted">No parts in blueprint.</li>}
        {bp.parts.map((p, idx) => {
          const child = p.blueprintId ? lib.blueprint(p.blueprintId) : undefined;
          const isSelected = selected.includes(p.id);
          const isHidden = hiddenParts.has(p.id);
          const isLocked = lockedParts.has(p.id);

          return (
            <li key={p.id} className="bp-outliner-item" data-selected={isSelected} data-hidden={isHidden}>
              <button
                type="button"
                className="bp-outliner-btn"
                onClick={() => toggleVisibility(p.id)}
                title={isHidden ? "Show part" : "Hide part"}
                aria-label={isHidden ? "Show" : "Hide"}
              >
                {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className="bp-outliner-btn"
                onClick={() => toggleLock(p.id)}
                title={isLocked ? "Unlock part" : "Lock part"}
                aria-label={isLocked ? "Unlock" : "Lock"}
              >
                {isLocked ? <Lock size={14} /> : <Unlock size={14} />}
              </button>
              <button
                type="button"
                className="grow row"
                style={{ background: "transparent", border: "none", textAlign: "left", cursor: "pointer", gap: "0.4rem" }}
                onClick={(e) => {
                  if (isLocked) return;
                  setSelected(e.shiftKey || e.metaKey || e.ctrlKey ? (selected.includes(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id]) : [p.id]);
                }}
              >
                {child ? <BlueprintThumb lib={lib} blueprint={child} size={20} /> : <span className="bp-shape" data-shape={p.shape} aria-hidden />}
                <span className="small truncate grow">{p.name ?? child?.name ?? p.shape}</span>
              </button>
              <span className="bp-outliner-badge">
                {Math.round(p.size.w)}×{Math.round(p.size.d)}
              </span>
              <div className="row" style={{ gap: "0.1rem" }}>
                <button type="button" className="bp-outliner-btn" disabled={idx === 0} onClick={() => moveOrder(idx, -1)} title="Move Up">
                  ↑
                </button>
                <button type="button" className="bp-outliner-btn" disabled={idx === bp.parts.length - 1} onClick={() => moveOrder(idx, 1)} title="Move Down">
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PartsTab({
  lib,
  bp,
  selected,
  setSelected,
  part,
  apply,
  canEdit,
}: {
  lib: Resolver;
  bp: Blueprint;
  selected: string[];
  setSelected: (ids: string[]) => void;
  part: Part | undefined;
  apply: (r: BlueprintEdit) => string | null;
  canEdit: boolean;
}) {
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <ul className="bp-parts" aria-label="Parts">
        {bp.parts.length === 0 && <li className="tiny muted">No parts yet. Add a shape or a blueprint above.</li>}
        {bp.parts.map((p) => {
          const child = p.blueprintId ? lib.blueprint(p.blueprintId) : undefined;
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-pressed={selected.includes(p.id)}
                onClick={(e) => setSelected(e.shiftKey || e.metaKey || e.ctrlKey ? (selected.includes(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id]) : [p.id])}
              >
                {child ? <BlueprintThumb lib={lib} blueprint={child} size={26} /> : <span className="bp-shape" data-shape={p.shape} aria-hidden />}
                <span className="small truncate grow">{p.name ?? child?.name ?? p.shape}</span>
                <span className="tiny muted tabular">
                  {Math.round(p.size.w)}×{Math.round(p.size.d)}×{Math.round(p.size.h)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected.length > 1 && (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <span className="small strong">{selected.length} parts selected</span>
          <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!canEdit}
              onClick={() => {
                let next = bp;
                for (const id of selected) {
                  const r = mirrorPart(next, id, "x", true);
                  if (r.ok) next = r.blueprint;
                }
                apply({ ok: true, blueprint: next, summary: "Mirrored" });
              }}
            >
              <FlipHorizontal2 size={14} /> Mirror copies
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => apply(dropToFloor(bp, selected))}>
              <ArrowDownToLine size={14} /> Drop to Floor
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => apply(joinParts(bp, selected))}>
              <Box size={14} /> Join into Mesh
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--bad)" }}
              disabled={!canEdit}
              onClick={() => {
                let next = bp;
                for (const id of selected) {
                  const r = removePart(next, id);
                  if (r.ok) next = r.blueprint;
                }
                apply({ ok: true, blueprint: next, summary: "Removed" });
                setSelected([]);
              }}
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        </div>
      )}

      {part && <PartInspector key={part.id} lib={lib} bp={bp} part={part} apply={apply} canEdit={canEdit} onRemoved={() => setSelected([])} />}
    </div>
  );
}

function PartInspector({
  lib,
  bp,
  part,
  apply,
  canEdit,
  onRemoved,
}: {
  lib: Resolver;
  bp: Blueprint;
  part: Part;
  apply: (r: BlueprintEdit) => string | null;
  canEdit: boolean;
  onRemoved: () => void;
}) {
  const child = part.blueprintId ? lib.blueprint(part.blueprintId) : undefined;
  const set = (patch: Partial<Omit<Part, "id">>) => apply(updatePart(lib, bp, part.id, patch));
  const [count, setCount] = useState(3);
  const [radialCount, setRadialCount] = useState(4);
  const field = (label: string, value: number, commit: (v: number) => string | null, key: string, unit = "mm") => (
    <MeasureField key={`${part.id}.${key}.${value}`} label={label} value={value} unit={unit} onCommit={commit} />
  );

  return (
    <fieldset className="stack bp-part" style={{ gap: "0.8rem" }} disabled={!canEdit}>
      <div className="row-between">
        <h2 className="display-s">{part.name ?? child?.name ?? "Part"}</h2>
        {child && (
          <Link className="btn btn-ghost btn-sm" href={`/library/${encodeURIComponent(child.id)}`}>
            Open {child.name}
          </Link>
        )}
      </div>

      <TextField key={`${part.id}.name.${part.name ?? ""}`} label="Name" value={part.name ?? ""} onCommit={(v) => set({ name: v.trim() || undefined })} />

      <div className="plan-pair bp-triple">
        {field("Across (x)", part.at.x, (v) => set({ at: { ...part.at, x: v } }), "x")}
        {field("Back (y)", part.at.y, (v) => set({ at: { ...part.at, y: v } }), "y")}
        {field("Up (z)", part.at.z, (v) => set({ at: { ...part.at, z: v } }), "z")}
      </div>

      <div className="plan-pair bp-triple">
        {field("Width", part.size.w, (v) => set({ size: { ...part.size, w: v } }), "w")}
        {field("Depth", part.size.d, (v) => set({ size: { ...part.size, d: v } }), "d")}
        {field("Height", part.size.h, (v) => set({ size: { ...part.size, h: v } }), "h")}
      </div>

      <div className="plan-pair bp-triple">
        {field("Turn", part.rotation, (v) => set({ rotation: ((v % 360) + 360) % 360 }), "r", "°")}
        {!child && part.shape !== "mesh" && field("Lean back", part.tilt?.x ?? 0, (v) => set({ tilt: { ...part.tilt, x: v } }), "tx", "°")}
        {!child && part.shape !== "mesh" && field("Lean right", part.tilt?.y ?? 0, (v) => set({ tilt: { ...part.tilt, y: v } }), "ty", "°")}
      </div>

      {!child && (
        <label className="field">
          <span className="field-label">Shape</span>
          <select className="input" value={part.shape ?? "box"} onChange={(e) => set({ shape: e.target.value as PartShape })}>
            {SHAPE_CHOICES.map((c) => (
              <option key={c.shape} value={c.shape}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {part.shape === "mesh" && (
        <div className="row-between" style={{ marginTop: "-0.4rem" }}>
          <span className="tiny muted">{`${part.mesh?.v.length ?? 0} points, ${part.mesh?.f.length ?? 0} faces.`}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(separatePart(bp, part.id))} title="Split disconnected pieces into separate parts">
            Separate Islands
          </button>
        </div>
      )}

      {part.shape !== "mesh" && !child && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => apply(editPoints(bp, part.id, { op: "convert" }))}>
          Convert to editable mesh (P)
        </button>
      )}

      {(part.shape === "box" || part.shape === "cylinder" || part.shape === "extrude") && (
        <label className="field">
          <span className="field-label">{`Top is ${Math.round((part.taper ?? 1) * 100)}% of the bottom`}</span>
          <input type="range" min={0} max={2} step={0.05} value={part.taper ?? 1} onChange={(e) => set({ taper: Number(e.target.value) })} aria-label="Taper" />
        </label>
      )}

      <div className="plan-pair">
        {part.shape === "box" && (part.taper ?? 1) === 1 && field("Round corners", part.radius ?? 0, (v) => set({ radius: v > 0 ? v : undefined }), "rad")}
        {(part.shape === "cylinder" || part.shape === "lathe") && field("Hollow wall", part.hollow ?? 0, (v) => set({ hollow: v > 0 ? v : 0 }), "hollow")}
      </div>

      {/* Architectural Profile Editor and Presets for Lathe & Extrude */}
      {(part.shape === "lathe" || part.shape === "extrude") && (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <span className="field-label">{part.shape === "lathe" ? "Turned Profile" : "Extrusion Outline"}</span>
          <div className="bp-profile-presets">
            {(part.shape === "lathe" ? LATHE_PRESETS : OUTLINE_PRESETS).map((p) => (
              <button
                key={p.key}
                type="button"
                className="chip"
                onClick={() => set({ profile: p.profile.map(([u, v]) => [u, v]) })}
              >
                {p.label}
              </button>
            ))}
          </div>
          {part.profile && (
            <ProfileEditor
              key={part.id}
              kind={part.shape}
              profile={part.profile}
              aspect={part.shape === "lathe" ? part.size.h / part.size.w : part.size.d / part.size.w}
              onChange={(profile) => set({ profile })}
            />
          )}
        </div>
      )}

      <MaterialPicker lib={lib} label={child ? "Paint it all in" : "Material"} value={part.material} onChange={(m) => set({ material: m ?? undefined })} noneLabel={child ? "Its own materials" : "Plain"} />

      {/* Alignment and Modeling Actions */}
      <div className="bp-modeling-section">
        <span className="bp-modeling-section-title">Quick Modeling</span>
        <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(dropToFloor(bp, [part.id]))}>
            <ArrowDownToLine size={13} /> Floor Z=0
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ at: { ...part.at, x: 0, y: 0 } })}>
            Center (0,0)
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(mirrorPartZ(bp, part.id, true))} title="Mirror copy vertically">
            Mirror Z
          </button>
        </div>
      </div>

      <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(duplicatePart(bp, part.id))}>
          <CopyPlus size={14} /> Duplicate
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(mirrorPart(bp, part.id, "x"))} title="A mirrored copy on the other side">
          <FlipHorizontal2 size={14} /> Mirror across
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(mirrorPart(bp, part.id, "y"))} title="A mirrored copy front to back">
          <FlipVertical2 size={14} /> Mirror back
        </button>
      </div>

      {/* Linear Array */}
      <div className="row bp-array" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
        <span className="small">Linear Repeat</span>
        <input className="input tabular" type="number" min={2} max={50} value={count} aria-label="How many" onChange={(e) => setCount(Math.max(2, Math.min(50, Number(e.target.value) || 2)))} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(arrayPart(bp, part.id, count, { x: part.size.w + 10, y: 0, z: 0 }))}>
          across
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(arrayPart(bp, part.id, count, { x: 0, y: part.size.d + 10, z: 0 }))}>
          back
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(arrayPart(bp, part.id, count, { x: 0, y: 0, z: part.size.h }))}>
          up
        </button>
      </div>

      {/* Radial Array */}
      <div className="row bp-array" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
        <span className="small">Radial Repeat</span>
        <input className="input tabular" type="number" min={2} max={24} value={radialCount} aria-label="Radial copies" onChange={(e) => setRadialCount(Math.max(2, Math.min(24, Number(e.target.value) || 2)))} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(radialArrayPart(bp, part.id, radialCount))}>
          in a circle
        </button>
      </div>

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        style={{ alignSelf: "flex-start", color: "var(--bad)" }}
        onClick={() => {
          if (!apply(removePart(bp, part.id))) onRemoved();
        }}
      >
        <Trash2 size={14} /> Remove this part
      </button>
    </fieldset>
  );
}

function BlueprintTab({
  lib,
  bp,
  apply,
  users,
  canEdit,
  onRemove,
}: {
  lib: Resolver;
  bp: Blueprint;
  apply: (r: BlueprintEdit) => string | null;
  users: Blueprint[];
  canEdit: boolean;
  onRemove?: () => void;
}) {
  const set = (patch: Parameters<typeof updateBlueprint>[1]) => apply(updateBlueprint(bp, patch));

  return (
    <fieldset className="stack" style={{ gap: "0.9rem" }} disabled={!canEdit}>
      <TextField key={`name.${bp.name}`} label="Name" value={bp.name} onCommit={(v) => set({ name: v })} />
      <label className="field">
        <span className="field-label">Category</span>
        <select className="input" value={bp.category} onChange={(e) => set({ category: e.target.value as BlueprintCategory })}>
          {BLUEPRINT_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      {bp.kind === "object" && (
        <label className="field">
          <span className="field-label">Counts as</span>
          <select className="input" value={bp.type} onChange={(e) => set({ type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="tiny muted">Layout rules and the AI treat it as this, so a custom desk still counts as a desk.</span>
        </label>
      )}
      {bp.kind === "object" && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <span className="field-label">On the 2D plan</span>
          <div className="segmented" role="group" aria-label="On the 2D plan">
            <button type="button" aria-pressed={bp.symbol === "parts"} onClick={() => set({ symbol: "parts" })}>
              Its outline from above
            </button>
            <button type="button" aria-pressed={bp.symbol === "type"} onClick={() => set({ symbol: "type" })}>
              The standard symbol
            </button>
          </div>
        </div>
      )}
      <div className="stack" style={{ gap: "0.35rem" }}>
        <span className="field-label">Size</span>
        <div className="plan-pair bp-triple">
          {(["w", "d", "h"] as const).map((k) => (
            <MeasureField
              key={`${k}.${bp.size[k]}`}
              label={k === "w" ? "Width" : k === "d" ? "Depth" : "Height"}
              value={bp.size[k]}
              onCommit={(v) => (bp.kind === "wall" && k === "d" ? "A wall type's depth comes from its layers." : apply(resizeBlueprint(bp, { ...bp.size, [k]: v })))}
            />
          ))}
        </div>
        <span className="tiny muted">Changing the size stretches every part with it. On a plan, each copy can still be its own size.</span>
        {bp.kind === "object" && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => apply(fitToParts(lib, bp))}>
            Fit the size to the parts
          </button>
        )}
      </div>
      <label className="field">
        <span className="field-label">Notes</span>
        <textarea
          className="input"
          rows={3}
          maxLength={2_000}
          defaultValue={bp.description ?? ""}
          key={`desc.${bp.description ?? ""}`}
          onBlur={(e) => e.target.value !== (bp.description ?? "") && set({ description: e.target.value || undefined })}
          placeholder="Supplier, finish, where it is used…"
        />
      </label>
      <TextField
        key={`tags.${(bp.tags ?? []).join(",")}`}
        label="Tags, separated by commas"
        value={(bp.tags ?? []).join(", ")}
        onCommit={(v) => set({ tags: v.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) })}
      />
      <div className="stack" style={{ gap: "0.35rem" }}>
        <span className="field-label">Used inside</span>
        {users.length === 0 ? (
          <span className="tiny muted">No other blueprint uses it.</span>
        ) : (
          <ul className="bp-used">
            {users.map((u) => (
              <li key={u.id}>
                <Link href={`/library/${encodeURIComponent(u.id)}`} className="row" style={{ gap: "0.5rem" }}>
                  <BlueprintThumb lib={lib} blueprint={u} size={28} />
                  <span className="small">{u.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onRemove && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--bad)" }} onClick={onRemove}>
          <Trash2 size={14} /> Remove from the library
        </button>
      )}
    </fieldset>
  );
}

function LayersTab({ lib, bp, apply, canEdit }: { lib: Resolver; bp: Blueprint; apply: (r: BlueprintEdit) => string | null; canEdit: boolean }) {
  const layers = bp.layers ?? [];
  const set = (next: WallLayer[]) => apply(setLayers(bp, next));
  const move = (i: number, by: number) => {
    const next = [...layers];
    const [l] = next.splice(i, 1);
    next.splice(Math.max(0, Math.min(next.length, i + by)), 0, l);
    set(next);
  };

  return (
    <fieldset className="stack" style={{ gap: "0.8rem" }} disabled={!canEdit}>
      <p className="tiny muted">From the wall&apos;s left face to its right. Walls of this type on every plan take its total thickness.</p>
      <div className="bp-section" aria-hidden>
        {layers.map((l, i) => (
          <span key={i} style={{ flex: l.thickness, background: lib.material(l.material)?.color ?? "#ccc" }} title={`${l.name}, ${l.thickness} mm`} />
        ))}
      </div>
      <ol className="v3-list">
        {layers.map((l, i) => (
          <li key={`${i}.${l.name}.${l.thickness}.${l.material}`} className="stack" style={{ gap: "0.45rem" }}>
            <div className="row" style={{ gap: "0.35rem" }}>
              <input
                className="input grow"
                defaultValue={l.name}
                aria-label="Layer name"
                onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && set(layers.map((x, j) => (j === i ? { ...x, name: e.target.value.trim() } : x)))}
              />
              <button type="button" className="icon-btn" aria-label="Move it left" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="icon-btn" aria-label="Move it right" disabled={i === layers.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button type="button" className="icon-btn" aria-label="Remove this layer" disabled={layers.length === 1} onClick={() => set(layers.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            </div>
            <MeasureField label="Thickness" value={l.thickness} onCommit={(v) => set(layers.map((x, j) => (j === i ? { ...x, thickness: v } : x)))} />
            <MaterialPicker lib={lib} label="Material" value={l.material} onChange={(m) => m && set(layers.map((x, j) => (j === i ? { ...x, material: m } : x)))} />
          </li>
        ))}
      </ol>
      <div className="row-between">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => set([...layers, { name: "Layer", thickness: 12, material: "std:plaster" }])}>
          <Plus size={14} /> Add a layer
        </button>
        <span className="small strong tabular">{wallThickness(layers)} mm</span>
      </div>
    </fieldset>
  );
}

function VersionsTab({
  id,
  revision,
  versions,
  onRestore,
}: {
  id: string;
  revision: number;
  versions: (id: string) => Promise<{ revision: number; createdAt: string; createdBy?: string; body: unknown }[]>;
  onRestore: (body: unknown) => void;
}) {
  const [list, setList] = useState<{ revision: number; createdAt: string; createdBy?: string; body: unknown }[] | null>(null);
  const [error, setError] = useState("");
  const asked = useRef("");

  useEffect(() => {
    const key = `${id}@${revision}`;
    if (asked.current === key) return;
    asked.current = key;
    versions(id).then(setList, (e: Error) => setError(e.message));
  }, [id, revision, versions]);

  if (error) return <p className="small" role="alert">{error}</p>;
  if (!list) return <p className="tiny muted">Loading versions…</p>;

  return (
    <div className="stack" style={{ gap: "0.6rem" }}>
      <p className="tiny muted">Every save is kept. Restoring makes a draft; save it to keep it.</p>
      <ul className="v3-list">
        {list.map((v) => (
          <li key={v.revision} className="row" style={{ gap: "0.5rem" }}>
            <History size={15} aria-hidden />
            <span className="small grow">
              Version {v.revision}
              <span className="tiny muted"> · {relativeTime(v.createdAt)}{v.createdBy ? ` · ${v.createdBy}` : ""}</span>
            </span>
            {v.revision === revision ? <span className="tiny muted">Current</span> : <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRestore(v.body)}>Restore</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Modal dialog for Exporting to OBJ / STL / JSON and Importing OBJ models */
function ExportImportModal({
  bp,
  lib,
  onClose,
  onImport,
}: {
  bp: Blueprint;
  lib: Resolver;
  onClose: () => void;
  onImport: (imported: Omit<Blueprint, "id">) => void;
}) {
  const [mode, setMode] = useState<"export" | "import">("export");
  const [objText, setObjText] = useState("");
  const [copied, setCopied] = useState(false);

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportOBJ = () => {
    const content = exportToOBJ(lib, bp);
    downloadFile(content, `${bp.name.replace(/\s+/g, "_")}.obj`, "text/plain");
  };

  const handleCopyOBJ = async () => {
    const content = exportToOBJ(lib, bp);
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportSTL = () => {
    const content = exportToSTL(lib, bp);
    downloadFile(content, `${bp.name.replace(/\s+/g, "_")}.stl`, "model/stl");
  };

  const handleExportJSON = () => {
    const content = exportToJSON(bp);
    downloadFile(content, `${bp.name.replace(/\s+/g, "_")}.json`, "application/json");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = String(event.target?.result ?? "");
      setObjText(text);
    };
    reader.readAsText(file);
  };

  const handleDoImport = () => {
    if (!objText.trim()) return;
    const imported = importFromOBJ(objText, `${bp.name} (Imported)`);
    onImport(imported);
  };

  return (
    <div className="bp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bp-modal-box" role="dialog" aria-label="3D Model CAD Interchange">
        <div className="bp-modal-header">
          <h2 className="display-s">3D Model CAD & Interchange</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="bp-modal-body">
          <div className="segmented">
            <button type="button" aria-pressed={mode === "export"} onClick={() => setMode("export")}>
              <Download size={14} /> Export 3D
            </button>
            <button type="button" aria-pressed={mode === "import"} onClick={() => setMode("import")}>
              <Upload size={14} /> Import OBJ
            </button>
          </div>

          {mode === "export" ? (
            <div className="stack" style={{ gap: "0.85rem" }}>
              <p className="small muted">
                Export full precision geometry for Blender, Rhino, AutoCAD, Maya, Unreal Engine or 3D Printing.
              </p>
              <div className="stack" style={{ gap: "0.6rem" }}>
                <div className="row-between">
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="small strong">Wavefront OBJ (.obj)</span>
                    <span className="tiny muted">Standard mesh format with normals and face groups</span>
                  </div>
                  <div className="row" style={{ gap: "0.4rem" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopyOBJ}>
                      {copied ? "Copied!" : "Copy"}
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={handleExportOBJ}>
                      Download OBJ
                    </button>
                  </div>
                </div>

                <div className="row-between">
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="small strong">Stereolithography (.stl)</span>
                    <span className="tiny muted">Triangulated mesh for 3D printing and CNC slicers</span>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={handleExportSTL}>
                    Download STL
                  </button>
                </div>

                <div className="row-between">
                  <div className="stack" style={{ gap: 0 }}>
                    <span className="small strong">Blueprint JSON (.json)</span>
                    <span className="tiny muted">Native parametric definition with parts and materials</span>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportJSON}>
                    Download JSON
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="stack" style={{ gap: "0.85rem" }}>
              <p className="small muted">Upload an existing Wavefront .obj file or paste its contents below to load it as editable mesh parts.</p>
              <input type="file" accept=".obj" onChange={handleFileUpload} className="input" />
              <textarea
                className="input"
                rows={6}
                placeholder="v 0.0 0.0 0.0&#10;f 1 2 3..."
                value={objText}
                onChange={(e) => setObjText(e.target.value)}
              />
              <button type="button" className="btn btn-primary btn-sm" disabled={!objText.trim()} onClick={handleDoImport} style={{ alignSelf: "flex-end" }}>
                Import into Blueprint
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
