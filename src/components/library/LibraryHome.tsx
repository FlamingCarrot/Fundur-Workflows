"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, Plus, Search, Sparkles, Upload, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { useLibrary } from "./LibraryContext";
import { LibraryBrowser } from "./LibraryBrowser";
import { MaterialSwatch } from "./MaterialSwatch";
import { blankBlueprint } from "@/lib/blueprints/edit";
import { bodyOf } from "@/lib/blueprints/client";
import { MATERIAL_CATEGORIES, isStandard, type Material, type MaterialCategory, type MaterialPattern } from "@/lib/blueprints/types";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";

/**
 * The practice's design library: furniture and objects, wall types and
 * materials, by picture. Defaults come with the app; the practice's own sit
 * beside them and are used on every plan.
 */

type Tab = "objects" | "walls" | "materials";
const isTab = oneOf<Tab>(["objects", "walls", "materials"]);
const PATTERNS: MaterialPattern[] = ["plain", "wood", "planks", "herringbone", "tiles", "brick", "concrete", "marble", "terrazzo", "fabric", "carpet", "metal"];
type MaterialDraft = Omit<Material, "id" | "revision">;

export function LibraryHome() {
  const library = useLibrary();
  const { toast, viewer } = useStudio();
  const router = useRouter();
  const canEdit = viewer.workspaceRole !== "collaborator";
  const [tab, setTab] = useViewSetting<Tab>("library.tab", "objects", isTab);
  const [busy, setBusy] = useState(false);
  const [material, setMaterial] = useState<{ id?: string; draft: MaterialDraft; readOnly: boolean } | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);
  const lib = library.resolver;

  const create = async (kind: "object" | "wall") => {
    setBusy(true);
    try {
      const mine = lib.blueprints.filter((b) => !isStandard(b.id) && b.kind === kind).length;
      const entry = await library.create("blueprint", blankBlueprint(kind === "wall" ? `Wall type ${mine + 1}` : `New blueprint ${mine + 1}`, kind));
      router.push(`/library/${encodeURIComponent(entry.id)}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mineCount = { objects: 0, walls: 0, materials: library.library.materials.length };
  for (const b of library.library.blueprints) mineCount[b.kind === "wall" ? "walls" : "objects"] += 1;

  return (
    <main className="page lib-page">
      <header className="stack" style={{ gap: "0.4rem" }}>
        <p className="eyebrow">Design library</p>
        <h1 className="display-m">Blueprints and materials</h1>
        <p className="muted small" style={{ maxWidth: 640 }}>
          Design furniture, objects and wall types once, from simple shapes and other blueprints, and use them on every plan in 2D and 3D. Change one and it changes everywhere it is used. Defaults cannot be changed; open one and save it as your own.
        </p>
      </header>
      <div className="row lib-tabs" style={{ gap: "0.6rem", flexWrap: "wrap" }}>
        <div className="segmented" role="group" aria-label="Library">
          {(
            [
              ["objects", "Furniture and objects"],
              ["walls", "Wall types"],
              ["materials", "Materials"],
            ] as [Tab, string][]
          ).map(([k, text]) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {text}
              {mineCount[k] > 0 && <span className="tiny muted"> {mineCount[k]}</span>}
            </button>
          ))}
        </div>
        <span className="grow" />
        {canEdit && tab !== "materials" && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => create(tab === "walls" ? "wall" : "object")}>
            <Plus size={15} /> {tab === "walls" ? "New wall type" : "New blueprint"}
          </button>
        )}
        {canEdit && tab === "materials" && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFreeOpen(true)}>
              <Globe2 size={15} /> Free textures
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setMaterial({ draft: { name: "New material", category: "Other", color: "#c9c3b8", roughness: 0.8, metalness: 0, pattern: "plain" }, readOnly: false })}>
              <Plus size={15} /> New material
            </button>
          </>
        )}
      </div>
      {library.status === "failed" && <p className="small" role="alert">{library.error ?? "The library could not be loaded."} The defaults are shown.</p>}
      {tab === "objects" && <LibraryBrowser lib={lib} kind="object" settingKey="library.objects" onPick={(b) => router.push(`/library/${encodeURIComponent(b.id)}`)} />}
      {tab === "walls" && <LibraryBrowser lib={lib} kind="wall" settingKey="library.walls" onPick={(b) => router.push(`/library/${encodeURIComponent(b.id)}`)} />}
      {tab === "materials" && <MaterialGrid materials={lib.materials} onPick={(m) => setMaterial({ id: m.id, draft: bodyOf(m), readOnly: isStandard(m.id) || !canEdit })} />}
      {material && (
        <MaterialSheet
          key={material.id ?? "new"}
          initial={material.draft}
          id={material.id}
          readOnly={material.readOnly}
          canEdit={canEdit}
          aiAllowed={viewer.features?.ai !== false && canEdit}
          onClose={() => setMaterial(null)}
          onSave={async (draft, asNew) => {
            const current = material.id ? lib.material(material.id) : undefined;
            if (current && !asNew && !isStandard(current.id)) await library.update(current.id, current.revision, draft);
            else await library.create("material", draft);
            toast(current && !asNew && !isStandard(current.id) ? `${draft.name} saved. Everything using it shows the change.` : `${draft.name} added to your materials`);
            setMaterial(null);
          }}
          onRemove={
            material.id && !isStandard(material.id) && canEdit
              ? async () => {
                  if (!window.confirm("Remove this material? Anything using it goes back to its plain colour.")) return;
                  await library.remove(material.id!);
                  setMaterial(null);
                }
              : undefined
          }
        />
      )}
      {freeOpen && (
        <FreeTextures
          onClose={() => setFreeOpen(false)}
          onAdd={async (body) => {
            await library.create("material", body);
            toast(`${body.name} added to your materials`);
          }}
        />
      )}
    </main>
  );
}

function MaterialGrid({ materials, onPick }: { materials: Material[]; onPick: (m: Material) => void }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = materials.filter((m) => !q || `${m.name} ${m.category} ${m.source?.name ?? ""}`.toLowerCase().includes(q));
    return MATERIAL_CATEGORIES.map((c) => ({ c, items: list.filter((m) => m.category === c).sort((a, b) => Number(isStandard(a.id)) - Number(isStandard(b.id)) || a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
  }, [materials, query]);
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <label className="lib-search" style={{ maxWidth: 420 }}>
        <Search size={15} aria-hidden />
        <input className="input" type="search" placeholder="Search materials" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search materials" />
      </label>
      {groups.map((g) => (
        <section key={g.c} className="stack" style={{ gap: "0.5rem" }}>
          <h2 className="eyebrow">{g.c}</h2>
          <div className="lib-grid">
            {g.items.map((m) => (
              <button key={m.id} type="button" className="lib-card" onClick={() => onPick(m)} title={m.source?.licence ? `${m.name} · ${m.source.name}, ${m.source.licence}` : m.name}>
                <MaterialSwatch material={m} size={64} />
                <span className="tiny lib-name">{m.name}</span>
                {!isStandard(m.id) && <span className="lib-badge">{m.source?.name === "AI" ? "AI" : "Ours"}</span>}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Reads a picked image as a small square JPEG for a texture. */
function readTexture(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 512;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      let q = 0.85;
      let out = canvas.toDataURL("image/jpeg", q);
      while (out.length > 380_000 && q > 0.4) out = canvas.toDataURL("image/jpeg", (q -= 0.1));
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read. Choose a JPEG or PNG."));
    };
    img.src = url;
  });
}

function MaterialSheet({
  initial,
  id,
  readOnly,
  canEdit,
  aiAllowed,
  onClose,
  onSave,
  onRemove,
}: {
  initial: MaterialDraft;
  id?: string;
  readOnly: boolean;
  canEdit: boolean;
  aiAllowed: boolean;
  onClose: () => void;
  onSave: (draft: MaterialDraft, asNew: boolean) => Promise<void>;
  onRemove?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<MaterialDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [describe, setDescribe] = useState("");
  const [ai, setAi] = useState<{ configured: boolean; estimatedZarPerImage: number | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<MaterialDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const standard = !!id && isStandard(id);
  useEffect(() => {
    if (!aiAllowed) return;
    let cancelled = false;
    fetch("/api/textures/generate")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => !cancelled && setAi(body))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [aiAllowed]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const preview: Material = { ...draft, id: id ?? "draft", revision: 0 };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet mat-sheet" role="dialog" aria-label={draft.name} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="row-between" style={{ marginBottom: "0.75rem" }}>
          <h2 className="display-s">{standard ? draft.name : id ? "Edit material" : "New material"}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" autoFocus><X size={18} /></button>
        </div>
        <div className="mat-sheet-body">
          <div className="stack" style={{ gap: "0.5rem", alignItems: "center" }}>
            <MaterialSwatch key={`${draft.color}${draft.pattern}${draft.image?.length ?? 0}`} material={preview} size={150} />
            {draft.source && <span className="tiny muted">{draft.source.url ? <a href={draft.source.url} target="_blank" rel="noreferrer">{draft.source.name}</a> : draft.source.name}{draft.source.licence ? `, ${draft.source.licence}` : ""}</span>}
          </div>
          <fieldset className="stack" style={{ gap: "0.75rem" }} disabled={busy || (readOnly && !standard) || !canEdit}>
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <div className="plan-pair">
              <label className="field">
                <span className="field-label">Kind</span>
                <select className="input" value={draft.category} onChange={(e) => set({ category: e.target.value as MaterialCategory })}>
                  {MATERIAL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">Colour</span>
                <input className="input mat-color" type="color" value={draft.color} onChange={(e) => set({ color: e.target.value })} />
              </label>
            </div>
            {!draft.image && (
              <label className="field">
                <span className="field-label">Pattern</span>
                <select className="input" value={draft.pattern ?? "plain"} onChange={(e) => set({ pattern: e.target.value as MaterialPattern })}>
                  {PATTERNS.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span className="field-label">One repeat covers <span className="tabular">{draft.tile ?? 1_000} mm</span></span>
              <input type="range" min={50} max={4_000} step={50} value={draft.tile ?? 1_000} onChange={(e) => set({ tile: Number(e.target.value) })} />
            </label>
            <div className="plan-pair">
              <label className="field">
                <span className="field-label">Shine <span className="tabular">{Math.round((1 - draft.roughness) * 100)}%</span></span>
                <input type="range" min={0} max={1} step={0.05} value={1 - draft.roughness} onChange={(e) => set({ roughness: 1 - Number(e.target.value) })} />
              </label>
              <label className="field">
                <span className="field-label">Metal <span className="tabular">{Math.round(draft.metalness * 100)}%</span></span>
                <input type="range" min={0} max={1} step={0.05} value={draft.metalness} onChange={(e) => set({ metalness: Number(e.target.value) })} />
              </label>
            </div>
            <label className="field">
              <span className="field-label">See-through <span className="tabular">{Math.round((1 - (draft.opacity ?? 1)) * 100)}%</span></span>
              <input type="range" min={0} max={0.9} step={0.05} value={1 - (draft.opacity ?? 1)} onChange={(e) => set({ opacity: Number(e.target.value) > 0 ? 1 - Number(e.target.value) : undefined })} />
            </label>
            <div className="stack" style={{ gap: "0.4rem" }}>
              <span className="field-label">Texture image</span>
              <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload a photo</button>
                {draft.image && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ image: undefined, source: undefined })}>Remove the image</button>}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void run(async () => set({ image: await readTexture(file), source: { name: "Upload" } }));
                }}
              />
              <span className="tiny muted">A square, flat, evenly lit photo of the material tiles best.</span>
            </div>
            {aiAllowed && ai?.configured && (
              <div className="stack mat-ai" style={{ gap: "0.4rem" }}>
                <span className="field-label">Make the texture with AI</span>
                <textarea className="input" rows={2} maxLength={600} value={describe} onChange={(e) => setDescribe(e.target.value)} placeholder="e.g. honed travertine, warm beige with soft veining" />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ alignSelf: "flex-start" }}
                  disabled={describe.trim().length < 3}
                  onClick={() =>
                    run(async () => {
                      const res = await fetch("/api/textures/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ description: describe, name: draft.name, category: draft.category, color: draft.color, tile: draft.tile ?? 1_000 }) });
                      const body = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(body.error ?? "The texture could not be made.");
                      set({ image: body.material.image, color: body.material.color, source: body.material.source });
                    })
                  }
                >
                  <Sparkles size={14} /> {busy ? "Making it…" : "Make it"}
                </button>
                {ai.estimatedZarPerImage != null && <span className="tiny muted">About R{ai.estimatedZarPerImage.toFixed(2)} each.</span>}
              </div>
            )}
          </fieldset>
        </div>
        {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
        {canEdit && (
          <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem", flexWrap: "wrap" }}>
            {onRemove && <button type="button" className="btn btn-ghost" style={{ color: "var(--bad)", marginRight: "auto" }} disabled={busy} onClick={() => run(onRemove)}>Remove</button>}
            {id && !standard && <button type="button" className="btn btn-ghost" disabled={busy || !draft.name.trim()} onClick={() => run(() => onSave({ ...draft, name: `${draft.name} (copy)` }, true))}>Save as new</button>}
            <button type="button" className="btn btn-primary" disabled={busy || !draft.name.trim()} onClick={() => run(() => onSave(standard ? { ...draft, name: draft.name === initial.name ? `${draft.name} (ours)` : draft.name } : draft, standard))}>
              {standard ? "Save as new" : "Save"}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function FreeTextures({ onClose, onAdd }: { onClose: () => void; onAdd: (body: MaterialDraft) => Promise<void> }) {
  const [query, setQuery] = useState("wood floor");
  const [results, setResults] = useState<{ id: string; name: string; thumb: string; categories: string[] }[] | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const search = async (q: string) => {
    setError("");
    setResults(null);
    try {
      const res = await fetch(`/api/textures/search?q=${encodeURIComponent(q)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The free library could not be searched.");
      setResults(body.textures);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    }
  };
  const first = useRef(false);
  useEffect(() => {
    if (first.current) return;
    first.current = true;
    void search("wood floor");
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet mat-sheet" role="dialog" aria-label="Free textures" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="row-between" style={{ marginBottom: "0.5rem" }}>
          <h2 className="display-s">Free textures</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="tiny muted" style={{ marginBottom: "0.75rem" }}>From Poly Haven, free for any use (CC0). Each one you add is kept in your library, so plans never depend on the site.</p>
        <form className="row" style={{ gap: "0.4rem", marginBottom: "0.75rem" }} onSubmit={(e) => { e.preventDefault(); void search(query); }}>
          <label className="lib-search grow">
            <Search size={15} aria-hidden />
            <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search free textures" placeholder="Oak, terrazzo, linen…" autoFocus />
          </label>
          <button type="submit" className="btn btn-secondary btn-sm">Search</button>
        </form>
        {error && <p className="small" role="alert">{error}</p>}
        {!results ? (
          <p className="tiny muted">Searching…</p>
        ) : results.length === 0 && !error ? (
          <p className="tiny muted">Nothing found. Try one simpler word, like “marble”.</p>
        ) : (
          <div className="lib-grid">
            {results.map((t) => (
              <button
                key={t.id}
                type="button"
                className="lib-card"
                disabled={!!adding || added.includes(t.id)}
                onClick={async () => {
                  setAdding(t.id);
                  setError("");
                  try {
                    const res = await fetch("/api/textures/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: t.id }) });
                    const body = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(body.error ?? "That texture could not be brought in.");
                    await onAdd(body.material);
                    setAdded((a) => [...a, t.id]);
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setAdding(null);
                  }
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={t.thumb} alt="" width={72} height={72} loading="lazy" className="mat-thumb" />
                <span className="tiny lib-name">{t.name}</span>
                {adding === t.id && <span className="lib-badge">Adding…</span>}
                {added.includes(t.id) && <span className="lib-badge">Added</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
