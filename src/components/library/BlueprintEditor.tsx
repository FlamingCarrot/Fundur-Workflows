"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Undo2,
  X,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { useLibrary } from "./LibraryContext";
import { LibraryBrowser } from "./LibraryBrowser";
import { MaterialPicker } from "./MaterialPicker";
import { BlueprintThumb } from "./BlueprintThumb";
import { MeasureField, TextField } from "@/components/plan/PlanInspector";
import { LibraryConflict, bodyOf } from "@/lib/blueprints/client";
import {
  addShape,
  arrayPart,
  copyOf,
  duplicatePart,
  fitToParts,
  mirrorPart,
  nestBlueprint,
  problems,
  removePart,
  resizeBlueprint,
  setLayers,
  updateBlueprint,
  updatePart,
  type BlueprintEdit,
} from "@/lib/blueprints/edit";
import { resolver, usedBy, wouldLoop, type Resolver } from "@/lib/blueprints/resolve";
import { wallThickness } from "@/lib/blueprints/defaults";
import { BLUEPRINT_CATEGORIES, isStandard, type Blueprint, type BlueprintCategory, type Part, type PartShape, type WallLayer } from "@/lib/blueprints/types";
import { LIBRARY } from "@/lib/plan/library";
import { emptyPlan, FIRST_LEVEL_ID, type Plan } from "@/lib/plan/geometry";
import { useViewSetting, oneOf } from "@/lib/view-settings/client";
import { relativeTime } from "@/lib/studio/format";
import type { ViewPreset, Projection } from "@/components/plan/Plan3D";
import { ViewCube } from "@/components/plan/Plan3DControls";
import type { SceneOptions } from "@/lib/plan/scene";

const Plan3D = dynamic(() => import("@/components/plan/Plan3D"), {
  ssr: false,
  loading: () => <div className="plan-3d-fallback"><p className="small muted">Loading the 3D view…</p></div>,
});

/**
 * Designing one blueprint: its parts (simple shapes and other blueprints
 * nested in it), their sizes, places and materials, and for a wall type its
 * layers. Changes are a draft with undo until saved; saving changes it
 * everywhere it is used. A default cannot be changed in place, so it is saved
 * as a new blueprint in the practice's library.
 */

const SHAPES: { shape: PartShape; label: string; icon: React.ReactNode }[] = [
  { shape: "box", label: "Box", icon: <Box size={15} /> },
  { shape: "cylinder", label: "Cylinder", icon: <Circle size={15} /> },
  { shape: "sphere", label: "Sphere", icon: <Circle size={15} strokeWidth={3} /> },
  { shape: "wedge", label: "Wedge", icon: <Triangle size={15} /> },
];
const TYPES = LIBRARY.map((i) => ({ type: i.type, name: i.name }));
type Tab = "parts" | "blueprint" | "layers" | "versions";
const isTab = oneOf<Tab>(["parts", "blueprint", "layers", "versions"]);
const SCENE: SceneOptions = { levelId: FIRST_LEVEL_ID, allLevels: false, separated: false, cutWalls: false, layers: { walls: true, openings: true, columns: true, rooms: true, furniture: true } };
const isView = (v: unknown): v is ViewPreset => typeof v === "string" && /^(iso|top|bottom|front|back|left|right|iso-(ne|nw|se|sw))$/.test(v);
const isProjection = oneOf<Projection>(["perspective", "orthographic"]);
const isStyle = oneOf<"realistic" | "clay" | "lines">(["realistic", "clay", "lines"]);

/** One item, the blueprint, on an empty floor, to show it in 3D. */
function stagePlan(bp: Blueprint): Plan {
  return { ...emptyPlan(), items: [{ id: "blueprint", levelId: FIRST_LEVEL_ID, type: bp.type, blueprintId: bp.id, at: { x: 0, y: 0 }, width: bp.size.w, depth: bp.size.d, height: bp.size.h, rotation: 0 }] };
}

export function BlueprintEditor({ id }: { id: string }) {
  const library = useLibrary();
  const { toast, viewer } = useStudio();
  const router = useRouter();
  const canEdit = viewer.workspaceRole !== "collaborator";
  const saved = library.resolver.blueprint(id);
  const [history, setHistory] = useState<{ list: Blueprint[]; at: number } | null>(null);
  const draft = history ? history.list[history.at] : saved;
  const [base, setBase] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useViewSetting<Tab>("library.editor.tab", "parts", isTab);
  const [view, setView] = useViewSetting<ViewPreset>("library.editor.view", "iso", isView);
  const [projection, setProjection] = useViewSetting<Projection>("library.editor.projection", "perspective", isProjection);
  const [style, setStyle] = useViewSetting<"realistic" | "clay" | "lines">("library.editor.style", "realistic", isStyle);
  const [fitSignal, setFitSignal] = useState(0);
  const [nesting, setNesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<Blueprint | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const standard = isStandard(id);
  const dirty = !!history && history.at > 0;
  // The library as it would be with this draft saved, so nested parts and previews show the change.
  const lib: Resolver = useMemo(
    () => (draft ? resolver({ blueprints: [...library.library.blueprints.filter((b) => b.id !== draft.id), draft], materials: library.library.materials }) : library.resolver),
    [draft, library.library, library.resolver]
  );
  const plan = useMemo(() => (draft ? stagePlan(draft) : null), [draft]);

  const apply = useCallback(
    (result: BlueprintEdit) => {
      if (!result.ok) {
        toast(result.error);
        return result.error;
      }
      setHistory((h) => {
        const list = h ? h.list.slice(0, h.at + 1) : [saved!];
        return { list: [...list, result.blueprint].slice(-100), at: Math.min(list.length, 99) };
      });
      if (result.partId) setSelected([result.partId]);
      return null;
    },
    [saved, toast]
  );
  const undo = useCallback(() => setHistory((h) => (h && h.at > 0 ? { ...h, at: h.at - 1 } : h)), []);
  const redo = useCallback(() => setHistory((h) => (h && h.at < h.list.length - 1 ? { ...h, at: h.at + 1 } : h)), []);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const parts = draft?.parts ?? [];
  const part = selected.length === 1 ? parts.find((p) => p.id === selected[0]) : undefined;

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
      } else if ((e.metaKey || e.ctrlKey) && k === "d" && draft && selected.length) {
        e.preventDefault();
        let bp = draft;
        for (const pid of selected) {
          const r = duplicatePart(bp, pid);
          if (r.ok) bp = r.blueprint;
        }
        apply({ ok: true, blueprint: bp, summary: "Duplicated" });
      } else if ((k === "delete" || k === "backspace") && draft && selected.length) {
        e.preventDefault();
        let bp = draft;
        for (const pid of selected) {
          const r = removePart(bp, pid);
          if (r.ok) bp = r.blueprint;
        }
        apply({ ok: true, blueprint: bp, summary: "Removed" });
        setSelected([]);
      } else if (k === "escape") setSelected([]);
      else if (k === "f") setFitSignal((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, draft, selected, apply]);

  if (library.status === "loading" && !saved) return <div className="plan-empty"><p className="muted">Loading the library…</p></div>;
  if (!draft || !plan) {
    return (
      <div className="plan-empty">
        <div className="stack" style={{ gap: "0.75rem", maxWidth: 420 }}>
          <h1 className="display-s">That blueprint is not in the library</h1>
          <p className="small muted">It may have been removed. Plans that used it show a plain box until it is swapped.</p>
          <Link className="btn btn-primary btn-sm" href="/library" style={{ alignSelf: "flex-start" }}>Back to the library</Link>
        </div>
      </div>
    );
  }

  const issues = problems(lib, draft);
  const users = usedBy(lib, draft.id);

  const save = async (asNew: boolean) => {
    if (!canEdit) return;
    setBusy(true);
    try {
      if (asNew || standard) {
        const name = asNew && !standard ? `${draft.name} (copy)` : draft.name;
        const entry = (await library.create("blueprint", { ...copyOf(draft, name), basedOn: draft.basedOn && standard ? draft.basedOn : draft.id })) as Blueprint;
        setHistory(null);
        toast(`${entry.name} saved in your library`);
        router.replace(`/library/${encodeURIComponent(entry.id)}`);
      } else {
        const entry = (await library.update(draft.id, base ?? saved!.revision, bodyOf(draft))) as Blueprint;
        setHistory(null);
        setBase(entry.revision);
        toast(users.length ? `Saved. ${users.length} other blueprint${users.length === 1 ? "" : "s"} and every plan using it now show the change.` : "Saved. Every plan using it now shows the change.");
      }
    } catch (err) {
      if (err instanceof LibraryConflict) setConflict(err.current as Blueprint);
      else toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (standard || !canEdit) return;
    if (!window.confirm(`Remove ${draft.name} from the library? Plans using it show a plain box until it is swapped.`)) return;
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
    setSelected((s) => (additive ? (s.includes(partId) ? s.filter((x) => x !== partId) : [...s, partId]) : [partId]));
    setTab("parts");
    setPanelOpen(true);
  };

  return (
    <div className="plan-shell bp-shell">
      <header className="plan-bar">
        <Link href="/library" className="icon-btn" aria-label="Back to the library" title="Back to the library" onClick={(e) => dirty && !window.confirm("Leave without saving your changes?") && e.preventDefault()}>
          <ArrowLeft size={19} />
        </Link>
        <div className="stack" style={{ gap: 0, minWidth: 0 }}>
          <span className="small strong truncate">{draft.name}</span>
          <span className="tiny muted truncate">
            {standard ? "Default blueprint, saved as a new one" : dirty ? "Unsaved changes" : saved?.updatedAt ? `Saved ${relativeTime(saved.updatedAt)}` : "Your library"}
          </span>
        </div>
        <span className="grow" />
        <div className="row plan-bar-actions" style={{ gap: "0.15rem" }}>
          <button type="button" className="icon-btn" onClick={undo} disabled={!history || history.at === 0} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={17} /></button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!history || history.at >= history.list.length - 1} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={17} /></button>
          {canEdit && !standard && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(true)} title="Save a copy as a new blueprint">
              <Copy size={15} /> <span className="plan-label">Save as new</span>
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || (!dirty && !standard)} onClick={() => save(false)}>
              <Save size={15} /> {standard ? "Save as new" : "Save"}
            </button>
          )}
        </div>
      </header>
      {standard && (
        <div className="plan-banner" role="status">
          <Layers3 size={16} />
          <span className="small grow">This is a default blueprint. Change anything, then save it as your own; the default stays as it was.</span>
        </div>
      )}
      {conflict && (
        <div className="plan-banner" role="alert">
          <span className="small grow">Someone else saved {conflict.name} since you opened it.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setHistory(null); setBase(conflict.revision); setConflict(null); }}>Load theirs</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setBase(conflict.revision); setConflict(null); }}>Keep mine</button>
        </div>
      )}
      <div className="v3-wrap bp-toolbar">
        <div className="v3-bar" role="toolbar" aria-label="Add">
          {SHAPES.map((s) => (
            <button key={s.shape} type="button" className="v3-btn" disabled={!canEdit} onClick={() => apply(addShape(draft, s.shape, { at: { x: 0, y: 0, z: 0 } }))}>
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
          <button type="button" className="v3-btn" disabled={!canEdit} aria-expanded={nesting} onClick={() => setNesting((n) => !n)}>
            <Shapes size={15} />
            <span>Blueprint</span>
          </button>
          <span className="grow" />
          <div className="segmented" role="group" aria-label="Look">
            {(["realistic", "clay", "lines"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={style === k} onClick={() => setStyle(k)}>{k === "realistic" ? "Materials" : k === "clay" ? "Clay" : "Lines"}</button>
            ))}
          </div>
          <button type="button" className="icon-btn" onClick={() => setFitSignal((n) => n + 1)} aria-label="Fit to the screen" title="Fit (F)"><Maximize size={16} /></button>
          <button type="button" className="icon-btn plan-details-toggle" aria-label="Details" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}><Layers3 size={17} /></button>
        </div>
        {nesting && (
          <div className="v3-panel bp-nest" role="dialog" aria-label="Add a blueprint">
            <button type="button" className="icon-btn v3-close" aria-label="Close" onClick={() => setNesting(false)}><X size={16} /></button>
            <h2 className="display-s">Add a blueprint inside</h2>
            <p className="tiny muted" style={{ marginBottom: "0.6rem" }}>It stays linked: change that blueprint and this one changes too.</p>
            <LibraryBrowser
              lib={lib}
              kind="any"
              compact
              settingKey="library.nest"
              exclude={(b) => wouldLoop(lib, draft.id, b.id)}
              onPick={(b) => {
                if (!apply(nestBlueprint(lib, draft, b.id, { at: { x: 0, y: 0, z: 0 } }))) setNesting(false);
              }}
            />
          </div>
        )}
      </div>
      <div className="plan-work">
        <div className="plan-stage">
          <Plan3D
            plan={plan}
            options={SCENE}
            lib={lib}
            view={view}
            projection={projection}
            style={style}
            shadows
            selection={null}
            selectedParts={selected}
            onSelect={() => undefined}
            onPart={onPart}
            onBack={() => router.push("/library")}
            fitSignal={fitSignal}
            hint={false}
          />
          <ViewCube view={view} projection={projection} onView={(v) => { setView(v); setFitSignal((n) => n + 1); }} onProjection={setProjection} />
        </div>
        <aside className="plan-side" aria-label="Blueprint details" data-open={panelOpen}>
          <button type="button" className="icon-btn plan-details-close" aria-label="Close details" onClick={() => setPanelOpen(false)}><X size={18} /></button>
          <div className="segmented bp-tabs" role="group" aria-label="Details">
            {(
              [
                ["parts", "Parts"],
                ["blueprint", "Blueprint"],
                ...(draft.kind === "wall" ? [["layers", "Layers"]] : []),
                ...(!standard ? [["versions", "Versions"]] : []),
              ] as [Tab, string][]
            ).map(([k, text]) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{text}</button>
            ))}
          </div>
          {issues.length > 0 && (
            <ul className="bp-issues" role="alert">
              {issues.map((t) => <li key={t} className="tiny">{t}</li>)}
            </ul>
          )}
          {tab === "parts" && (
            <PartsTab lib={lib} bp={draft} selected={selected} setSelected={setSelected} part={part} apply={apply} canEdit={canEdit} />
          )}
          {tab === "blueprint" && <BlueprintTab lib={lib} bp={draft} apply={apply} users={users} canEdit={canEdit} onRemove={!standard && canEdit ? remove : undefined} />}
          {tab === "layers" && draft.kind === "wall" && <LayersTab lib={lib} bp={draft} apply={apply} canEdit={canEdit} />}
          {tab === "versions" && !standard && (
            <VersionsTab
              id={draft.id}
              revision={saved?.revision ?? 0}
              versions={library.versions}
              onRestore={(body) => {
                apply({ ok: true, blueprint: { ...draft, ...(body as Omit<Blueprint, "id" | "revision">), id: draft.id, revision: draft.revision }, summary: "Restored" });
                toast("Restored as a draft. Save to keep it.");
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function PartsTab({ lib, bp, selected, setSelected, part, apply, canEdit }: { lib: Resolver; bp: Blueprint; selected: string[]; setSelected: (ids: string[]) => void; part: Part | undefined; apply: (r: BlueprintEdit) => string | null; canEdit: boolean }) {
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
                <span className="tiny muted tabular">{Math.round(p.size.w)}×{Math.round(p.size.d)}×{Math.round(p.size.h)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected.length > 1 && (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <span className="small strong">{selected.length} parts</span>
          <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!canEdit} onClick={() => {
              let next = bp;
              for (const id of selected) { const r = mirrorPart(next, id, "x", true); if (r.ok) next = r.blueprint; }
              apply({ ok: true, blueprint: next, summary: "Mirrored" });
            }}><FlipHorizontal2 size={14} /> Mirror copies</button>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: "var(--bad)" }} disabled={!canEdit} onClick={() => {
              let next = bp;
              for (const id of selected) { const r = removePart(next, id); if (r.ok) next = r.blueprint; }
              apply({ ok: true, blueprint: next, summary: "Removed" });
              setSelected([]);
            }}><Trash2 size={14} /> Remove</button>
          </div>
        </div>
      )}
      {part && <PartInspector key={part.id} lib={lib} bp={bp} part={part} apply={apply} canEdit={canEdit} onRemoved={() => setSelected([])} />}
    </div>
  );
}

function PartInspector({ lib, bp, part, apply, canEdit, onRemoved }: { lib: Resolver; bp: Blueprint; part: Part; apply: (r: BlueprintEdit) => string | null; canEdit: boolean; onRemoved: () => void }) {
  const child = part.blueprintId ? lib.blueprint(part.blueprintId) : undefined;
  const set = (patch: Partial<Omit<Part, "id">>) => apply(updatePart(lib, bp, part.id, patch));
  const [count, setCount] = useState(3);
  const field = (label: string, value: number, commit: (v: number) => string | null, key: string, unit = "mm") => <MeasureField key={`${part.id}.${key}.${value}`} label={label} value={value} unit={unit} onCommit={commit} />;
  return (
    <fieldset className="stack bp-part" style={{ gap: "0.8rem" }} disabled={!canEdit}>
      <div className="row-between">
        <h2 className="display-s">{part.name ?? child?.name ?? "Part"}</h2>
        {child && (
          <Link className="btn btn-ghost btn-sm" href={`/library/${encodeURIComponent(child.id)}`}>Open {child.name}</Link>
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
      <div className="plan-pair">
        {field("Turn", part.rotation, (v) => set({ rotation: ((v % 360) + 360) % 360 }), "r", "°")}
        {part.shape === "box" && field("Round corners", part.radius ?? 0, (v) => set({ radius: v > 0 ? v : undefined }), "rad")}
      </div>
      <MaterialPicker lib={lib} label={child ? "Paint it all in" : "Material"} value={part.material} onChange={(m) => set({ material: m ?? undefined })} noneLabel={child ? "Its own materials" : "Plain"} />
      <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(duplicatePart(bp, part.id))}><CopyPlus size={14} /> Duplicate</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(mirrorPart(bp, part.id, "x"))} title="A mirrored copy on the other side"><FlipHorizontal2 size={14} /> Mirror across</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => apply(mirrorPart(bp, part.id, "y"))} title="A mirrored copy front to back"><FlipVertical2 size={14} /> Mirror back</button>
      </div>
      <div className="row bp-array" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
        <span className="small">Repeat</span>
        <input className="input tabular" type="number" min={2} max={50} value={count} aria-label="How many" onChange={(e) => setCount(Math.max(2, Math.min(50, Number(e.target.value) || 2)))} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(arrayPart(bp, part.id, count, { x: part.size.w + 10, y: 0, z: 0 }))}>across</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(arrayPart(bp, part.id, count, { x: 0, y: part.size.d + 10, z: 0 }))}>back</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => apply(arrayPart(bp, part.id, count, { x: 0, y: 0, z: part.size.h }))}>up</button>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--bad)" }} onClick={() => { if (!apply(removePart(bp, part.id))) onRemoved(); }}>
        <Trash2 size={14} /> Remove this part
      </button>
    </fieldset>
  );
}

function BlueprintTab({ lib, bp, apply, users, canEdit, onRemove }: { lib: Resolver; bp: Blueprint; apply: (r: BlueprintEdit) => string | null; users: Blueprint[]; canEdit: boolean; onRemove?: () => void }) {
  const set = (patch: Parameters<typeof updateBlueprint>[1]) => apply(updateBlueprint(bp, patch));
  return (
    <fieldset className="stack" style={{ gap: "0.9rem" }} disabled={!canEdit}>
      <TextField key={`name.${bp.name}`} label="Name" value={bp.name} onCommit={(v) => set({ name: v })} />
      <label className="field">
        <span className="field-label">Category</span>
        <select className="input" value={bp.category} onChange={(e) => set({ category: e.target.value as BlueprintCategory })}>
          {BLUEPRINT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      {bp.kind === "object" && (
        <label className="field">
          <span className="field-label">Counts as</span>
          <select className="input" value={bp.type} onChange={(e) => set({ type: e.target.value })}>
            {TYPES.map((t) => <option key={t.type} value={t.type}>{t.name}</option>)}
          </select>
          <span className="tiny muted">Layout rules and the AI treat it as this, so a custom desk still counts as a desk.</span>
        </label>
      )}
      {bp.kind === "object" && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <span className="field-label">On the 2D plan</span>
          <div className="segmented" role="group" aria-label="On the 2D plan">
            <button type="button" aria-pressed={bp.symbol === "parts"} onClick={() => set({ symbol: "parts" })}>Its outline from above</button>
            <button type="button" aria-pressed={bp.symbol === "type"} onClick={() => set({ symbol: "type" })}>The standard symbol</button>
          </div>
        </div>
      )}
      <div className="stack" style={{ gap: "0.35rem" }}>
        <span className="field-label">Size</span>
        <div className="plan-pair bp-triple">
          {(["w", "d", "h"] as const).map((k) => (
            <MeasureField key={`${k}.${bp.size[k]}`} label={k === "w" ? "Width" : k === "d" ? "Depth" : "Height"} value={bp.size[k]} onCommit={(v) => (bp.kind === "wall" && k === "d" ? "A wall type's depth comes from its layers." : apply(resizeBlueprint(bp, { ...bp.size, [k]: v })))} />
          ))}
        </div>
        <span className="tiny muted">Changing the size stretches every part with it. On a plan, each copy can still be its own size.</span>
        {bp.kind === "object" && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => apply(fitToParts(lib, bp))}>Fit the size to the parts</button>
        )}
      </div>
      <label className="field">
        <span className="field-label">Notes</span>
        <textarea className="input" rows={3} maxLength={2_000} defaultValue={bp.description ?? ""} key={`desc.${bp.description ?? ""}`} onBlur={(e) => e.target.value !== (bp.description ?? "") && set({ description: e.target.value || undefined })} placeholder="Supplier, finish, where it is used…" />
      </label>
      <TextField key={`tags.${(bp.tags ?? []).join(",")}`} label="Tags, separated by commas" value={(bp.tags ?? []).join(", ")} onCommit={(v) => set({ tags: v.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) })} />
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
      <p className="tiny muted">From the wall&apos;s left face to its right, walking from its start to its end. Walls of this type on every plan take its total thickness.</p>
      <div className="bp-section" aria-hidden>
        {layers.map((l, i) => (
          <span key={i} style={{ flex: l.thickness, background: lib.material(l.material)?.color ?? "#ccc" }} title={`${l.name}, ${l.thickness} mm`} />
        ))}
      </div>
      <ol className="v3-list">
        {layers.map((l, i) => (
          <li key={`${i}.${l.name}.${l.thickness}.${l.material}`} className="stack" style={{ gap: "0.45rem" }}>
            <div className="row" style={{ gap: "0.35rem" }}>
              <input className="input grow" defaultValue={l.name} aria-label="Layer name" onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && set(layers.map((x, j) => (j === i ? { ...x, name: e.target.value.trim() } : x)))} />
              <button type="button" className="icon-btn" aria-label="Move it left" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
              <button type="button" className="icon-btn" aria-label="Move it right" disabled={i === layers.length - 1} onClick={() => move(i, 1)}>↓</button>
              <button type="button" className="icon-btn" aria-label="Remove this layer" disabled={layers.length === 1} onClick={() => set(layers.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
            <MeasureField label="Thickness" value={l.thickness} onCommit={(v) => set(layers.map((x, j) => (j === i ? { ...x, thickness: v } : x)))} />
            <MaterialPicker lib={lib} label="Material" value={l.material} onChange={(m) => m && set(layers.map((x, j) => (j === i ? { ...x, material: m } : x)))} />
          </li>
        ))}
      </ol>
      <div className="row-between">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => set([...layers, { name: "Layer", thickness: 12, material: "std:plaster" }])}><Plus size={14} /> Add a layer</button>
        <span className="small strong tabular">{wallThickness(layers)} mm</span>
      </div>
    </fieldset>
  );
}

function VersionsTab({ id, revision, versions, onRestore }: { id: string; revision: number; versions: (id: string) => Promise<{ revision: number; createdAt: string; createdBy?: string; body: unknown }[]>; onRestore: (body: unknown) => void }) {
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
      <p className="tiny muted">Every save is kept. Restoring makes a draft; save it to use it everywhere again.</p>
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
