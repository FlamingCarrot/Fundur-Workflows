"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ImagePlus,
  Trash2,
  ArrowRight,
  X,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { DesignLink } from "./DesignLink";
import { ProjectNavigation } from "@/components/projects/ProjectNavigation";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { MissingProject } from "@/components/views/MissingProject";
import { getWorkflow, label } from "@/lib/workflow";
import { swatchVar, WhenReady } from "@/components/ui/primitives";
import { downloadHref, uploadToProject } from "@/lib/studio/uploads";
import { designRequest } from "@/lib/design/client";
import { addSelection } from "@/lib/design/model";
import type { BoardCard, DesignBoard } from "@/lib/design/schema";
import type { Project, ProjectDocument } from "@/lib/studio/types";
import { useDesign } from "./useDesign";
import { Whiteboard } from "@/components/whiteboard/Whiteboard";
import { boardElements, cardHeight, placeCard, withElements } from "@/lib/whiteboard/board";
import { topZ } from "@/lib/whiteboard/ops";
import type { Pt } from "@/lib/whiteboard/geometry";
import type { WbElement } from "@/lib/whiteboard/types";
import { useViewSetting, useViewSettingsLoaded } from "@/lib/view-settings/client";
import { assistantBridge } from "@/lib/assistant/bridge";
import { SaveFeedback } from "./SaveFeedback";
import { useMobileDialog } from "@/hooks/useMobileDialog";
import "./design.css";

export function BoardView({
  projectId,
  boardKey,
}: {
  projectId: string;
  boardKey: string;
}) {
  const { ready, getProject, viewer } = useStudio();
  const project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <BoardScreen
          key={`${viewer.userId}.${viewer.workspaceId}.${project.id}`}
          project={project}
          boardKey={boardKey}
        />
      ) : (
        <main className="page">
          <MissingProject />
        </main>
      )}
    </WhenReady>
  );
}
const KIND_NAMES: Record<WbElement["kind"], [string, string]> = {
  sticky: ["sticky", "stickies"],
  shape: ["shape", "shapes"],
  text: ["text", "texts"],
  connector: ["line", "lines"],
  pen: ["drawing", "drawings"],
  frame: ["frame", "frames"],
  card: ["image", "images"],
};
/** "2 stickies, a frame", for the chip over the assistant's message box. */
function selectionLabel(els: WbElement[]): string {
  const counts = new Map<WbElement["kind"], number>();
  for (const e of els) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts]
    .map(([k, n]) => (n === 1 ? `a ${KIND_NAMES[k][0]}` : `${n} ${KIND_NAMES[k][1]}`))
    .join(", ");
}
interface Camera {
  x: number;
  y: number;
  zoom: number;
}
const isCamera = (v: unknown): v is Camera | null =>
  v === null ||
  (typeof v === "object" &&
    v !== null &&
    ["x", "y", "zoom"].every(
      (k) => typeof (v as Record<string, unknown>)[k] === "number" && Number.isFinite((v as Record<string, number>)[k]),
    ) &&
    (v as Camera).zoom > 0);
function BoardScreen({
  project,
  boardKey,
}: {
  project: Project;
  boardKey: string;
}) {
  const editor = useDesign(project.id);
  const { fileStorage, receiveProject, toast, viewer, setAssistantOpen } =
    useStudio();
  const mobileStyle = useMobileDialog(550);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [selectRequest, setSelectRequest] = useState<{ ids: string[]; signal: number }>();
  const [camera, setCamera] = useViewSetting<Camera | null>(
    `design.board.camera.${project.id}.${boardKey}`,
    null,
    isCamera,
  );
  const settingsLoaded = useViewSettingsLoaded();
  const fileInput = useRef<HTMLInputElement>(null);
  const dropAt = useRef<Pt | null>(null);
  const [uploading, setUploading] = useState(false),
    [uploadProgress, setUploadProgress] = useState(0),
    [uploadError, setUploadError] = useState("");
  const phase = getWorkflow(project).phases.find((p) =>
    p.modules.includes(`canvas_board:${boardKey}`),
  );
  const board = editor.data?.boards.find((b) => b.key === boardKey);
  const card =
    selection.length === 1
      ? board?.cards.find((c) => c.id === selection[0])
      : undefined;
  const elements = useMemo(() => boardElements(board), [board]);
  // The assistant's changes show here as they save, and Ctrl+Z on the board takes them back.
  const [adopted, setAdopted] = useState<{ signal: number; before: WbElement[] }>();
  const latest = useRef({ data: editor.data, elements });
  useEffect(() => {
    latest.current = { data: editor.data, elements };
  });
  const { flush, adopt } = editor;
  useEffect(() => {
    assistantBridge.setBoardHost({
      projectId: project.id,
      boardKey,
      flush,
      adopt: (next, revision) => {
        const data = latest.current.data;
        if (!data) return false;
        const before = latest.current.elements;
        const ok = adopt(
          {
            ...data,
            boards: next
              ? data.boards.some((b) => b.key === boardKey)
                ? data.boards.map((b) => (b.key === boardKey ? next : b))
                : [...data.boards, next]
              : data.boards.filter((b) => b.key !== boardKey),
          },
          revision,
        );
        if (ok) setAdopted((a) => ({ signal: (a?.signal ?? 0) + 1, before }));
        return ok;
      },
    });
    return () => assistantBridge.releaseBoard(project.id, boardKey);
  }, [project.id, boardKey, flush, adopt]);
  useEffect(() => {
    assistantBridge.setBoardFocus({
      projectId: project.id,
      boardKey,
      selection,
      selectionLabel: selectionLabel(elements.filter((e) => selection.includes(e.id))),
    });
  }, [project.id, boardKey, selection, elements]);
  const images = project.documents.filter(
    (d) => d.stored && /\.(png|jpe?g|gif|webp)$/i.test(d.name),
  );
  const palettePhase = getWorkflow(project).phases.find((p) =>
    p.modules.includes("item_register:palette"),
  );
  /** Saves the whiteboard: its cards and everything else on it, as one change. */
  const saveElements = useCallback(
    (next: WbElement[]) =>
      editor.update((data) => {
        const existing = data.boards.find((b) => b.key === boardKey);
        const nextBoard = withElements(
          existing ?? { id: crypto.randomUUID(), key: boardKey, cards: [] },
          next,
        );
        const kept = new Set(nextBoard.cards.map((c) => c.id));
        return {
          ...data,
          boards: existing
            ? data.boards.map((b) => (b.id === existing.id ? nextBoard : b))
            : [...data.boards, nextBoard],
          // A card taken off the board no longer feeds its palette selection.
          items: data.items.map((i) =>
            i.sourceCardId && !kept.has(i.sourceCardId) && existing?.cards.some((c) => c.id === i.sourceCardId)
              ? { ...i, sourceCardId: null }
              : i,
          ),
        };
      }),
    [editor, boardKey],
  );
  function add(documentId: string | null = null, title = "New note", at?: Pt | null) {
    const id = crypto.randomUUID();
    editor.update((data) => {
      const existing = data.boards.find((b) => b.key === boardKey);
      const width = 260;
      const height = cardHeight({ width, documentId, title, body: "" });
      const spot = at
        ? { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2) }
        : placeCard(existing);
      const next: BoardCard = {
        id,
        title,
        body: "",
        tags: [],
        group: "",
        documentId,
        color: "#f6f2e8",
        x: spot.x,
        y: spot.y,
        width,
        height,
        z: topZ(boardElements(existing)),
      };
      const nextBoard: DesignBoard = existing
        ? { ...existing, cards: [...existing.cards, next] }
        : { id: crypto.randomUUID(), key: boardKey, cards: [next] };
      return {
        ...data,
        boards: existing
          ? data.boards.map((b) => (b.id === existing.id ? nextBoard : b))
          : [...data.boards, nextBoard],
      };
    });
    setSelectRequest((r) => ({ ids: [id], signal: (r?.signal ?? 0) + 1 }));
  }
  function edit(id: string, patch: Partial<BoardCard>) {
    editor.update((data) => ({
      ...data,
      boards: data.boards.map((b) =>
        b.key === boardKey
          ? {
              ...b,
              cards: b.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
            }
          : b,
      ),
    }));
  }
  async function uploadAll(files: File[], at?: Pt | null) {
    for (const [i, file] of files.slice(0, 20).entries())
      await upload(file, at ? { x: at.x + i * 40, y: at.y + i * 40 } : null);
  }
  async function upload(file?: File, at?: Pt | null) {
    if (!file || !phase) return;
    if (
      !/^image\/(png|jpeg|gif|webp)$/.test(file.type) ||
      file.size > 20 * 1024 * 1024
    ) {
      setUploadError("Choose a PNG, JPEG, GIF or WebP image up to 20 MB.");
      return;
    }
    setUploading(true);
    setUploadError("");
    setUploadProgress(0);
    try {
      const storageKey = await uploadToProject(
        project.id,
        file,
        setUploadProgress,
      );
      const doc: ProjectDocument = {
        id: crypto.randomUUID(),
        name: file.name,
        sizeBytes: file.size,
        phaseKey: phase.key,
        uploadedAt: new Date().toISOString(),
        clientVisible: false,
        storageKey,
        stored: true,
        version: 1,
      };
      const result = await designRequest<{ project: Project }>(
        `/api/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ type: "addDocuments", documents: [doc] }),
        },
      );
      receiveProject(result.project);
      add(doc.id, file.name, at);
      toast("Image added to the board");
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  if (!phase)
    return (
      <main className="page">
        <p>This board is not part of this workflow.</p>
        <Link href={`/projects/${project.id}`}>Back to project</Link>
      </main>
    );
  return (
    <FocusFrame
      project={project}
      beforeExit={editor.flush}
      wide
      exitHref={`/projects/${project.id}/phases/${phase.key}`}
      title={label(project, boardKey, "Board")}
      right={
        <span className="row">
          <span className="tiny muted" role="status">
            {editor.status}
          </span>
          {viewer.features?.ai !== false &&
            viewer.workspaceRole !== "collaborator" && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Ask AI about this board"
                onClick={() => setAssistantOpen(true)}
              >
                <Sparkles size={17} />
              </button>
            )}
        </span>
      }
    >
      <main
        className="design-page board-page"
        style={swatchVar(project.swatch)}
      >
        <header className="row-between wrap design-header" style={{ marginBottom: "1.25rem" }}>
          <div>
            <h1 className="display-m" style={{ fontSize: "1.5rem", marginBottom: "0.2rem" }}>{label(project, boardKey, "Board")}</h1>
            <p className="muted small">
              Gather ideas, arrange them, and carry your selections forward.
            </p>
          </div>
        </header>
        <SaveFeedback editor={editor} />
        {editor.data && (
          <>
            {uploadError && (
              <p role="alert" className="design-error">
                {uploadError}
              </p>
            )}
            <div className="board-workspace">
              <div className="row design-toolbar board-actions">
                {viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" && <DesignLink flush={editor.flush} href={`/projects/${project.id}/concepts`} className="btn btn-secondary"><Sparkles size={16}/>Concept visuals</DesignLink>}
                {fileStorage && (
                  <label className="btn btn-secondary">
                    <ImagePlus size={16} />
                    {uploading
                      ? `Uploading ${Math.round(uploadProgress * 100)}%`
                      : "Upload images"}
                    <input
                      ref={fileInput}
                      className="sr-only"
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      disabled={uploading}
                      onChange={(e) => {
                        void uploadAll([...(e.target.files ?? [])], dropAt.current);
                        dropAt.current = null;
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
                <button
                  type="button"
                  className="btn btn-secondary board-details-toggle"
                  aria-expanded={detailsOpen}
                  onClick={() => setDetailsOpen((o) => !o)}
                >
                  <SlidersHorizontal size={16} />
                  {card ? "Card details" : "Images"}
                </button>
              </div>
              {settingsLoaded && (
                <Whiteboard
                  key={boardKey}
                  elements={elements}
                  onChange={saveElements}
                  imageUrl={(id) => downloadHref(project.id, id)}
                  camera={camera}
                  onCamera={setCamera}
                  onSelection={setSelection}
                  adopted={adopted}
                  selectRequest={selectRequest}
                  onOpen={() => setDetailsOpen(true)}
                  onAddImage={(at) => {
                    dropAt.current = at;
                    if (fileStorage && fileInput.current) fileInput.current.click();
                    else setDetailsOpen(true);
                  }}
                  onFiles={
                    fileStorage && phase
                      ? (files, at) => void uploadAll(files, at)
                      : undefined
                  }
                />
              )}
              <aside
                className="card board-inspector"
                data-open={detailsOpen}
                aria-label="Card details"
                style={mobileStyle}
              >
                <div className="board-inspector-head">
                  <h2>{card ? "Edit card" : "Make it yours"}</h2>
                  <button
                    type="button"
                    className="icon-btn board-inspector-close"
                    aria-label="Close card details"
                    onClick={() => setDetailsOpen(false)}
                  >
                    <X size={18} />
                  </button>
                </div>
                {!card ? (
                  <>
                    <p className="small muted">
                      Double-click an image card to edit its notes, tags and
                      group. Pick a project image to pin it to the board.
                    </p>
                    <label className="field">
                      <span className="field-label">Add a project image</span>
                      <select
                        className="input"
                        value=""
                        onChange={(e) => {
                          const doc = images.find(
                            (d) => d.id === e.target.value,
                          );
                          if (doc) add(doc.id, doc.name, dropAt.current);
                          dropAt.current = null;
                        }}
                      >
                        <option value="">Choose an uploaded image</option>
                        {images.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {!fileStorage && (
                      <p className="small muted">
                        Image uploads are available when project file storage is
                        connected.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span className="field-label">Title</span>
                      <input
                        className="input"
                        value={card.title}
                        maxLength={200}
                        onChange={(e) =>
                          edit(card.id, { title: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Notes</span>
                      <textarea
                        aria-label="Notes"
                        className="textarea"
                        rows={5}
                        value={card.body}
                        maxLength={5000}
                        onChange={(e) =>
                          edit(card.id, { body: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Tags</span>
                      <input
                        className="input"
                        key={card.id}
                        defaultValue={card.tags.join(", ")}
                        placeholder="Oak, warm, acoustic"
                        onBlur={(e) =>
                          edit(card.id, {
                            tags: [
                              ...new Set(
                                e.target.value
                                  .split(",")
                                  .map((t) => t.trim())
                                  .filter(Boolean),
                              ),
                            ],
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Group</span>
                      <input
                        className="input"
                        value={card.group}
                        maxLength={100}
                        onChange={(e) =>
                          edit(card.id, { group: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Image</span>
                      <select
                        className="input"
                        value={card.documentId ?? ""}
                        onChange={(e) =>
                          edit(card.id, { documentId: e.target.value || null })
                        }
                      >
                        <option value="">Note only</option>
                        {images.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="design-position">
                      <label className="field">
                        <span className="field-label">Colour</span>
                        <input
                          type="color"
                          value={card.color}
                          onChange={(e) =>
                            edit(card.id, { color: e.target.value })
                          }
                        />
                      </label>
                    </div>
                    {palettePhase &&
                      (editor.data.items.some(
                        (i) => i.sourceCardId === card.id,
                      ) ? (
                        <DesignLink
                          flush={editor.flush}
                          className="btn btn-secondary"
                          href={`/projects/${project.id}/items/palette`}
                        >
                          <ArrowRight size={16} />
                          Open palette selection
                        </DesignLink>
                      ) : (
                        <button
                          className="btn btn-primary"
                          type="button"
                          onClick={() => {
                            editor.update((d) =>
                              addSelection(d, card, crypto.randomUUID()),
                            );
                            toast(
                              "Selection added to the palette and schedule",
                            );
                          }}
                        >
                          Add to palette
                        </button>
                      ))}
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        editor.update((d) => ({
                          ...d,
                          boards: d.boards.map((b) =>
                            b.key === boardKey
                              ? {
                                  ...b,
                                  cards: b.cards.filter(
                                    (c) => c.id !== card.id,
                                  ),
                                }
                              : b,
                          ),
                          items: d.items.map((i) =>
                            i.sourceCardId === card.id
                              ? { ...i, sourceCardId: null }
                              : i,
                          ),
                        }));
                        setSelection([]);
                      }}
                    >
                      <Trash2 size={15} />
                      Remove card
                    </button>
                  </>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </FocusFrame>
  );
}
