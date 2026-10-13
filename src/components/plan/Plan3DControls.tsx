"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Box,
  Camera,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FlipVertical2,
  Image as ImageIcon,
  Layers3,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Level, Plan, PlanCamera, Slice, ViewStyle } from "@/lib/plan/geometry";
import { planBounds, type EditResult } from "@/lib/plan/geometry";
import { addCamera, newSlice, removeCamera, updateCamera, VIEW_STYLES } from "@/lib/blueprints/plan-edits";
import { dataUrlBytes, imagesToPdf } from "@/lib/export/image-pdf";
import { VIEW_PRESETS, type Plan3DApi, type Projection, type ViewPreset } from "./Plan3D";

/**
 * The 3D view's controls: a view cube for quick, exact views; and a bar with
 * the look, sections, placed cameras, renders and AI renders. Every setting is
 * remembered for the person (by the editor); cameras are part of the plan, so
 * they are versioned and undoable like any edit.
 */

export type Panel3D = "look" | "sections" | "cameras" | "render" | "ai" | null;

export interface Settings3D {
  view: ViewPreset;
  projection: Projection;
  style: ViewStyle;
  shadows: boolean;
  slices: Slice[];
  allFloors: boolean;
  separated: boolean;
  cutWalls: boolean;
  /** Each room's ceiling at its height. */
  ceilings?: boolean;
}

const AXIS_NAMES: Record<Slice["axis"], string> = { z: "Plan cut", x: "Left to right", y: "Front to back" };
const AXIS_HINT: Record<Slice["axis"], string> = { z: "Height above the ground floor", x: "Across, from the left", y: "Through, from the front" };
const AXIS_DOT: Record<Slice["axis"], string> = { x: "#c4553b", y: "#3f7fb1", z: "#5d8f3a" };

export const SIZES = [
  { key: "hd", label: "HD", w: 1_920, h: 1_080 },
  { key: "4k", label: "4K", w: 3_840, h: 2_160 },
  { key: "square", label: "Square", w: 2_048, h: 2_048 },
  { key: "portrait", label: "Portrait", w: 1_440, h: 1_920 },
  { key: "a3", label: "A3 print", w: 4_096, h: 2_896 },
] as const;

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  download(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
const imageSize = (url: string) =>
  new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("The image could not be read."));
    img.src = url;
  });

/** Makes a render of the view as framed and downloads it: a PNG, a JPEG or a one-page PDF. */
export async function exportView(api: Plan3DApi, opts: { format: "png" | "jpeg" | "pdf"; size: (typeof SIZES)[number]["key"]; style?: ViewStyle }, base: string, title: string) {
  const size = SIZES.find((s) => s.key === opts.size) ?? SIZES[0];
  const url = api.capture({ width: size.w, height: size.h, style: opts.style, mime: opts.format === "png" ? "image/png" : "image/jpeg" });
  if (opts.format === "pdf") {
    const { w, h } = await imageSize(url);
    downloadBytes(imagesToPdf([{ jpeg: dataUrlBytes(url), width: w, height: h, caption: "3D view" }], { title, landscape: size.w >= size.h }), `${base}-render.pdf`, "application/pdf");
  } else download(url, `${base}-render.${opts.format === "png" ? "png" : "jpg"}`);
}

/** The extent of what can be cut, in plan mm, for the section sliders. */
export function sectionRange(plan: Plan, levels: Level[]) {
  const b = planBounds({ ...plan, reference: [], notes: [], dimensions: [], underlays: [] });
  const pad = 1_000;
  const top = Math.max(...levels.map((l) => l.elevation + l.height), 3_000);
  const bottom = Math.min(...levels.map((l) => l.elevation), 0);
  return {
    x: b ? [Math.floor(b.minX - pad), Math.ceil(b.maxX + pad)] : [-10_000, 10_000],
    y: b ? [Math.floor(b.minY - pad), Math.ceil(b.maxY + pad)] : [-10_000, 10_000],
    z: [bottom - 200, top + 500],
  } as Record<Slice["axis"], [number, number]>;
}

// ---------------------------------------------------------------------------
// View cube
// ---------------------------------------------------------------------------

const CUBE: (ViewPreset | null)[] = ["iso-nw", "back", "iso-ne", "left", "top", "right", "iso-sw", "front", "iso-se"];
const CUBE_LABEL: Partial<Record<ViewPreset, string>> = { back: "Back", left: "L", top: "Top", right: "R", front: "Front" };

export function ViewCube({ view, projection, onView, onProjection }: { view: ViewPreset; projection: Projection; onView: (v: ViewPreset) => void; onProjection: (p: Projection) => void }) {
  return (
    <div className="view-cube" role="group" aria-label="Views">
      <div className="view-cube-grid">
        {CUBE.map((v) =>
          v ? (
            <button key={v} type="button" className={`view-cube-${v.startsWith("iso") ? "corner" : "face"}`} aria-pressed={view === v} aria-label={VIEW_PRESETS.find((p) => p.key === v)!.label} title={`${VIEW_PRESETS.find((p) => p.key === v)!.label}`} onClick={() => onView(v)}>
              {CUBE_LABEL[v] ?? ""}
            </button>
          ) : null,
        )}
      </div>
      <div className="view-cube-row">
        <button type="button" aria-pressed={view === "iso"} onClick={() => onView("iso")} title="3D view (0)">
          3D
        </button>
        <button type="button" aria-pressed={projection === "orthographic"} onClick={() => onProjection(projection === "perspective" ? "orthographic" : "perspective")} title="Perspective or parallel (5)">
          {projection === "perspective" ? "Persp" : "Ortho"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The bar and its panels
// ---------------------------------------------------------------------------

export function Plan3DBar({
  projectId,
  projectName,
  plan,
  levelId,
  levels,
  api,
  settings,
  set,
  multiFloor,
  selectionBox,
  onEdit,
  toast,
  saveFile,
  aiAllowed,
  panel,
  setPanel,
  aiRequest,
}: {
  projectId: string;
  projectName: string;
  plan: Plan;
  levelId: string;
  levels: Level[];
  api: RefObject<Plan3DApi | null>;
  settings: Settings3D;
  set: (patch: Partial<Settings3D>) => void;
  multiFloor: boolean;
  /** The extent of the selection, for a section box around it. */
  selectionBox: { minX: number; maxX: number; minY: number; maxY: number } | null;
  onEdit: (r: EditResult) => string | null;
  toast: (message: string) => void;
  /** Keeps a file with the project's documents; absent when files cannot be stored. */
  saveFile?: (file: File) => Promise<void>;
  aiAllowed: boolean;
  panel: Panel3D;
  setPanel: (p: Panel3D) => void;
  /** An AI render the assistant asked for: run it once per nonce. */
  aiRequest?: { direction: string; nonce: number };
}) {
  const cameras = plan.cameras ?? [];
  const enabled = settings.slices.filter((s) => s.enabled).length;
  const button = (key: Exclude<Panel3D, null>, icon: React.ReactNode, text: string, badge?: number) => (
    <button type="button" className="v3-btn" aria-expanded={panel === key} onClick={() => setPanel(panel === key ? null : key)}>
      {icon}
      <span>{text}</span>
      {badge ? <span className="v3-badge">{badge}</span> : null}
    </button>
  );
  return (
    <div className="v3-wrap">
      <div className="v3-bar" role="toolbar" aria-label="3D tools">
        {button("look", <Palette size={16} />, VIEW_STYLES.find((s) => s.key === settings.style)?.label ?? "Look")}
        {button("sections", <Scissors size={16} />, "Sections", enabled)}
        {button("cameras", <Camera size={16} />, "Cameras", cameras.length)}
        {button("render", <ImageIcon size={16} />, "Render")}
        {aiAllowed && button("ai", <Sparkles size={16} />, "AI render")}
      </div>
      {panel && (
        <div className="v3-panel" role="dialog" aria-label={panel === "ai" ? "AI render" : panel[0].toUpperCase() + panel.slice(1)} onKeyDown={(e) => e.key === "Escape" && setPanel(null)}>
          <button type="button" className="icon-btn v3-close" aria-label="Close" onClick={() => setPanel(null)}>
            <X size={16} />
          </button>
          {panel === "look" && <LookPanel settings={settings} set={set} multiFloor={multiFloor} />}
          {panel === "sections" && <SectionsPanel plan={plan} levelId={levelId} levels={levels} settings={settings} set={set} selectionBox={selectionBox} />}
          {panel === "cameras" && <CamerasPanel plan={plan} levelId={levelId} levels={levels} api={api} settings={settings} set={set} onEdit={onEdit} toast={toast} />}
          {panel === "render" && <RenderPanel projectName={projectName} plan={plan} levels={levels} api={api} settings={settings} set={set} toast={toast} saveFile={saveFile} />}
          {panel === "ai" && <AiRenderPanel projectId={projectId} api={api} toast={toast} request={aiRequest} />}
        </div>
      )}
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row-between small" style={{ gap: "1rem" }}>
      {label}
      <button type="button" role="switch" aria-checked={on} className="switch" aria-label={label} onClick={() => onChange(!on)} />
    </label>
  );
}

function LookPanel({ settings, set, multiFloor }: { settings: Settings3D; set: (p: Partial<Settings3D>) => void; multiFloor: boolean }) {
  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      <h2 className="display-s">Look</h2>
      <div className="segmented" role="group" aria-label="Look">
        {VIEW_STYLES.map((s) => (
          <button key={s.key} type="button" aria-pressed={settings.style === s.key} onClick={() => set({ style: s.key })}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="tiny muted">
        {settings.style === "realistic" ? "Materials, textures, daylight and shadows." : settings.style === "clay" ? "One soft gray for form and light; what the AI render starts from." : "White with black edges, like a drawing."}
      </p>
      {settings.style === "realistic" && <Switch label="Shadows" on={settings.shadows} onChange={(v) => set({ shadows: v })} />}
      <Switch label="Lower walls to see in (1,100 mm)" on={settings.cutWalls} onChange={(v) => set({ cutWalls: v })} />
      <Switch label="Ceilings" on={!!settings.ceilings} onChange={(v) => set({ ceilings: v })} />
      {multiFloor && <Switch label="All floors" on={settings.allFloors} onChange={(v) => set({ allFloors: v })} />}
      {multiFloor && settings.allFloors && <Switch label="Pull the floors apart" on={settings.separated} onChange={(v) => set({ separated: v })} />}
    </div>
  );
}

function SectionsPanel({ plan, levelId, levels, settings, set, selectionBox }: { plan: Plan; levelId: string; levels: Level[]; settings: Settings3D; set: (p: Partial<Settings3D>) => void; selectionBox: Settings3D extends never ? never : { minX: number; maxX: number; minY: number; maxY: number } | null }) {
  const range = useMemo(() => sectionRange(plan, levels), [plan, levels]);
  const level = levels.find((l) => l.id === levelId) ?? levels[0];
  const slices = settings.slices;
  const update = (id: string, patch: Partial<Slice>) => set({ slices: slices.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const add = (axis: Slice["axis"]) => {
    if (slices.length >= 12) return;
    const [lo, hi] = range[axis];
    const at = axis === "z" ? (level?.elevation ?? 0) + 1_200 : (lo + hi) / 2;
    set({ slices: [...slices, newSlice(axis, at)] });
  };
  /** Six planes around an extent, like Revit's section box. */
  const boxAround = (b: { minX: number; maxX: number; minY: number; maxY: number }, bottom: number, top: number) => {
    const pad = 150;
    set({
      slices: [
        { ...newSlice("x", b.maxX + pad) },
        { ...newSlice("x", b.minX - pad), flip: true },
        { ...newSlice("y", b.maxY + pad) },
        { ...newSlice("y", b.minY - pad), flip: true },
        { ...newSlice("z", top) },
        { ...newSlice("z", bottom), flip: true },
      ],
    });
  };
  const floorBox = () => {
    if (!level) return;
    boxAround({ minX: range.x[0] + 1_000, maxX: range.x[1] - 1_000, minY: range.y[0] + 1_000, maxY: range.y[1] - 1_000 }, level.elevation - 100, level.elevation + level.height + 50);
  };
  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      <h2 className="display-s">Sections</h2>
      <p className="tiny muted">Cut the model anywhere to look inside, isolate a room or a piece, or draw a plan or elevation. Drag a coloured handle in the view, or the slider here.</p>
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        {(["z", "x", "y"] as const).map((axis) => (
          <button key={axis} type="button" className="btn btn-secondary btn-sm" disabled={slices.length >= 12} onClick={() => add(axis)}>
            <Plus size={14} /> {AXIS_NAMES[axis]}
          </button>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => (selectionBox ? boxAround(selectionBox, (level?.elevation ?? 0) - 100, (level?.elevation ?? 0) + (level?.height ?? 2_700) + 50) : floorBox())}>
          <Box size={14} /> {selectionBox ? "Box around the selection" : "Box around this floor"}
        </button>
      </div>
      {slices.length === 0 && <p className="tiny muted">No sections yet.</p>}
      <ul className="v3-list">
        {slices.map((s) => {
          const [lo, hi] = range[s.axis];
          return (
            <li key={s.id} className="stack" style={{ gap: "0.35rem" }} data-enabled={s.enabled}>
              <div className="row" style={{ gap: "0.4rem" }}>
                <span className="v3-dot" style={{ background: AXIS_DOT[s.axis] }} aria-hidden />
                <span className="small strong grow">{AXIS_NAMES[s.axis]}</span>
                <button type="button" className="icon-btn" aria-label={s.enabled ? "Turn this section off" : "Turn this section on"} aria-pressed={s.enabled} onClick={() => update(s.id, { enabled: !s.enabled })} title={s.enabled ? "Showing" : "Off"}>
                  {s.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                <button type="button" className="icon-btn" aria-label="Keep the other side" onClick={() => update(s.id, { flip: !s.flip })} title="Keep the other side">
                  <FlipVertical2 size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label="Remove this section" onClick={() => set({ slices: slices.filter((x) => x.id !== s.id) })}>
                  <Trash2 size={15} />
                </button>
              </div>
              <input type="range" min={Math.min(lo, s.at)} max={Math.max(hi, s.at)} step={10} value={s.at} aria-label={`${AXIS_NAMES[s.axis]} position`} onChange={(e) => update(s.id, { at: Number(e.target.value) })} />
              <label className="row tiny muted" style={{ gap: "0.4rem" }}>
                {AXIS_HINT[s.axis]}
                <input
                  className="input tabular v3-mm"
                  inputMode="numeric"
                  defaultValue={s.at}
                  key={s.at}
                  aria-label={`${AXIS_NAMES[s.axis]} in millimetres`}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  onBlur={(e) => {
                    const v = Number.parseFloat(e.target.value.replace(/[\s,]/g, ""));
                    if (Number.isFinite(v)) update(s.id, { at: Math.round(v) });
                  }}
                />
                mm
              </label>
            </li>
          );
        })}
      </ul>
      {slices.length > 0 && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => set({ slices: [] })}>
          Clear all sections
        </button>
      )}
    </div>
  );
}

function CamerasPanel({ plan, levelId, levels, api, settings, set, onEdit, toast }: { plan: Plan; levelId: string; levels: Level[]; api: RefObject<Plan3DApi | null>; settings: Settings3D; set: (p: Partial<Settings3D>) => void; onEdit: (r: EditResult) => string | null; toast: (m: string) => void }) {
  const cameras = plan.cameras ?? [];
  const [renaming, setRenaming] = useState<string | null>(null);
  const elevationOf = (id: string) => levels.find((l) => l.id === id)?.elevation ?? 0;
  const capture = (): Omit<PlanCamera, "id" | "name"> | null => {
    const pose = api.current?.pose();
    if (!pose) return null;
    const e = elevationOf(levelId);
    return { levelId, eye: { ...pose.eye, z: pose.eye.z - e }, target: { ...pose.target, z: pose.target.z - e }, fov: pose.fov, projection: pose.projection, slices: settings.slices, style: settings.style };
  };
  const look = (c: PlanCamera) => {
    set({ ...(c.slices ? { slices: c.slices } : {}), ...(c.style ? { style: c.style } : {}), projection: c.projection });
    // Wait for the projection and sections to apply, then frame the camera's view.
    requestAnimationFrame(() => requestAnimationFrame(() => api.current?.lookFrom(c, elevationOf(c.levelId))));
  };
  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      <h2 className="display-s">Cameras</h2>
      <p className="tiny muted">Place a camera by framing the view you want, then save it. It keeps its sections and look, appears on the 2D plan, and renders the same every time.</p>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        style={{ alignSelf: "flex-start" }}
        onClick={() => {
          const c = capture();
          if (!c) return toast("The 3D view is not ready yet.");
          const error = onEdit(addCamera(plan, c));
          if (error) toast(error);
        }}
      >
        <Save size={14} /> Save this view as a camera
      </button>
      {cameras.length === 0 ? (
        <p className="tiny muted">No cameras yet.</p>
      ) : (
        <ul className="v3-list">
          {cameras.map((c) => (
            <li key={c.id} className="row" style={{ gap: "0.35rem" }}>
              <Camera size={15} aria-hidden />
              {renaming === c.id ? (
                <input
                  className="input grow"
                  defaultValue={c.name}
                  autoFocus
                  aria-label="Camera name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  onBlur={(e) => {
                    setRenaming(null);
                    if (e.target.value.trim() && e.target.value !== c.name) onEdit(updateCamera(plan, c.id, { name: e.target.value }));
                  }}
                />
              ) : (
                <button type="button" className="small strong grow truncate v3-cam-name" onClick={() => look(c)} onDoubleClick={() => setRenaming(c.id)} title="Look from this camera; double-click to rename">
                  {c.name}
                  <span className="tiny muted"> · {levels.find((l) => l.id === c.levelId)?.name ?? "Floor removed"}</span>
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => look(c)}>
                Look
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Move ${c.name} to this view`}
                title="Move it to this view"
                onClick={() => {
                  const now = capture();
                  if (now) onEdit(updateCamera(plan, c.id, { ...now, levelId: c.levelId, eye: { ...now.eye, z: now.eye.z + elevationOf(levelId) - elevationOf(c.levelId) }, target: { ...now.target, z: now.target.z + elevationOf(levelId) - elevationOf(c.levelId) } }));
                }}
              >
                <RefreshCw size={15} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Rename ${c.name}`} title="Rename" onClick={() => setRenaming(c.id)}>
                <Layers3 size={15} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Remove ${c.name}`} onClick={() => onEdit(removeCamera(plan, c.id))}>
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RenderPanel({ projectName, plan, levels, api, settings, set, toast, saveFile }: { projectName: string; plan: Plan; levels: Level[]; api: RefObject<Plan3DApi | null>; settings: Settings3D; set: (p: Partial<Settings3D>) => void; toast: (m: string) => void; saveFile?: (file: File) => Promise<void> }) {
  const [sizeKey, setSizeKey] = useState<(typeof SIZES)[number]["key"]>("hd");
  const [look, setLook] = useState<ViewStyle | "shown">("shown");
  const [busy, setBusy] = useState(false);
  const size = SIZES.find((s) => s.key === sizeKey)!;
  const base = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "render";
  const shoot = (mime: "image/png" | "image/jpeg" = "image/png") => api.current?.capture({ width: size.w, height: size.h, style: look === "shown" ? undefined : look, mime });
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast((err as Error).message || "The render could not be made.");
    } finally {
      setBusy(false);
    }
  };
  const pdfOf = async (shots: { url: string; caption: string }[]) => {
    const pages = [];
    for (const s of shots) {
      const { w, h } = await imageSize(s.url);
      pages.push({ jpeg: dataUrlBytes(s.url), width: w, height: h, caption: s.caption });
    }
    return imagesToPdf(pages, { title: projectName, landscape: size.w >= size.h });
  };
  const cameras = plan.cameras ?? [];
  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      <h2 className="display-s">Render</h2>
      <div className="stack" style={{ gap: "0.35rem" }}>
        <span className="field-label">Size</span>
        <div className="chip-row" role="group" aria-label="Size">
          {SIZES.map((s) => (
            <button key={s.key} type="button" className="chip" aria-pressed={sizeKey === s.key} onClick={() => setSizeKey(s.key)} title={`${s.w} × ${s.h} px`}>
              {s.label}
            </button>
          ))}
        </div>
        <span className="tiny muted tabular">{size.w} × {size.h} px</span>
      </div>
      <div className="stack" style={{ gap: "0.35rem" }}>
        <span className="field-label">Look</span>
        <div className="chip-row" role="group" aria-label="Look">
          {([["shown", "As shown"], ...VIEW_STYLES.map((s) => [s.key, s.label])] as [ViewStyle | "shown", string][]).map(([k, text]) => (
            <button key={k} type="button" className="chip" aria-pressed={look === k} onClick={() => setLook(k)}>
              {text}
            </button>
          ))}
        </div>
      </div>
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => { const url = shoot(); if (url) download(url, `${base}-render.png`); })}>
          <Download size={14} /> PNG
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(async () => { const url = shoot("image/jpeg"); if (url) downloadBytes(await pdfOf([{ url, caption: "3D view" }]), `${base}-render.pdf`, "application/pdf"); })}>
          <FileDown size={14} /> PDF
        </button>
        {saveFile && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const url = shoot();
                if (!url) return;
                await saveFile(new File([dataUrlBytes(url) as BlobPart], `Render ${new Date().toISOString().slice(0, 16).replace("T", " ")}.png`, { type: "image/png" }));
                toast("Render kept with the project's documents");
              })
            }
          >
            <Save size={14} /> Keep in project files
          </button>
        )}
      </div>
      {cameras.length > 0 && (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          style={{ alignSelf: "flex-start" }}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const api3d = api.current;
              if (!api3d) return;
              const before = { slices: settings.slices, style: settings.style, projection: settings.projection };
              const shots: { url: string; caption: string }[] = [];
              for (const c of cameras) {
                set({ ...(c.slices ? { slices: c.slices } : {}), ...(c.style ? { style: c.style } : {}), projection: c.projection });
                await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
                api3d.lookFrom(c, levels.find((l) => l.id === c.levelId)?.elevation ?? 0);
                const url = api3d.capture({ width: size.w, height: size.h, style: look === "shown" ? undefined : look, mime: "image/jpeg" });
                shots.push({ url, caption: c.name });
              }
              set(before);
              downloadBytes(await pdfOf(shots), `${base}-views.pdf`, "application/pdf");
              toast(`${shots.length} view${shots.length === 1 ? "" : "s"} saved as one PDF`);
            })
          }
        >
          <FileDown size={14} /> Every camera, one PDF
        </button>
      )}
      <p className="tiny muted">Renders are made in this browser from the view as framed. Large sizes depend on the device; the biggest it can make is used.</p>
    </div>
  );
}

interface RenderConfig {
  configured: boolean;
  storage: boolean;
  estimatedZarPerImage: number | null;
  presets: { key: string; label: string; text: string }[];
}

function AiRenderPanel({ projectId, api, toast, request }: { projectId: string; api: RefObject<Plan3DApi | null>; toast: (m: string) => void; request?: { direction: string; nonce: number } }) {
  const [config, setConfig] = useState<RenderConfig | null>(null);
  const [failed, setFailed] = useState("");
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ image: string; documentId?: string; direction: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/renders`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error ?? "AI renders are not available here.");
        if (!cancelled) setConfig(body);
      })
      .catch((e: Error) => !cancelled && setFailed(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const render = async (text = direction) => {
    const shot = api.current?.capture({ width: 1_536, height: 1_024, style: "clay", mime: "image/png" });
    if (!shot) return toast("The 3D view is not ready yet.");
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/renders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction: text, image: shot, viewName: "3D view" }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The render could not be made.");
      setResults((r) => [{ image: body.image, documentId: body.documentId, direction: text }, ...r].slice(0, 12));
      toast(body.documentId ? "AI render ready and kept with the project's documents" : "AI render ready");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // The assistant's request runs once the set-up is known to work.
  const ran = useRef(0);
  useEffect(() => {
    if (!request || !config?.configured || ran.current === request.nonce) return;
    ran.current = request.nonce;
    setDirection(request.direction);
    void render(request.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, config]);
  return (
    <div className="stack" style={{ gap: "0.85rem" }}>
      <h2 className="display-s">AI render</h2>
      <p className="tiny muted">A gray model of this exact view goes to the image model with your direction. It keeps the space and furniture and adds materials, light and styling. Treat it as a concept, not a measured view.</p>
      {failed ? (
        <p className="small" role="alert">{failed}</p>
      ) : !config ? (
        <p className="tiny muted">Checking the set-up…</p>
      ) : !config.configured ? (
        <p className="small">AI renders need an image model. Ask the administrator to choose one, with its price per image, under AI settings.</p>
      ) : (
        <>
          <div className="chip-row" role="group" aria-label="Starting points">
            {config.presets.map((p) => (
              <button key={p.key} type="button" className="chip" aria-pressed={direction === p.text} onClick={() => setDirection(p.text)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="stack" style={{ gap: "0.35rem" }}>
            <span className="field-label">Direction</span>
            <textarea className="input" rows={4} maxLength={2_000} value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="Materials, colours, mood, time of day, styling…" />
          </label>
          <button type="button" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} disabled={busy || !direction.trim()} onClick={() => render()}>
            <Sparkles size={14} /> {busy ? "Rendering…" : "Render this view"}
          </button>
          {config.estimatedZarPerImage != null && <span className="tiny muted">About R{config.estimatedZarPerImage.toFixed(2)} per render.</span>}
          {results.length > 0 && (
            <div className="v3-results">
              {results.map((r, i) => (
                <figure key={i} className="stack" style={{ gap: "0.3rem" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.image} alt={`AI render: ${r.direction.slice(0, 80)}`} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => download(r.image, `ai-render-${i + 1}.png`)}>
                    <Download size={14} /> Download
                  </button>
                </figure>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
