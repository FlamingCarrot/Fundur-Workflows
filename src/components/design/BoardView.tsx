"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Plus,
  ImagePlus,
  Link2,
  Trash2,
  ArrowRight,
  Maximize,
  X,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { DesignLink } from "./DesignLink";
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
import { BoardCanvas } from "./BoardCanvas";
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
  const [fitSignal, setFitSignal] = useState(0);
  const [selected, setSelected] = useState<string | null>(null),
    [zoom, setZoom] = useState(0),
    [group, setGroup] = useState("");
  const [uploading, setUploading] = useState(false),
    [uploadProgress, setUploadProgress] = useState(0),
    [uploadError, setUploadError] = useState("");
  const phase = getWorkflow(project).phases.find((p) =>
    p.modules.includes(`canvas_board:${boardKey}`),
  );
  const board = editor.data?.boards.find((b) => b.key === boardKey);
  const card = board?.cards.find((c) => c.id === selected);
  const images = project.documents.filter(
    (d) => d.stored && /\.(png|jpe?g|gif|webp)$/i.test(d.name),
  );
  const palettePhase = getWorkflow(project).phases.find((p) =>
    p.modules.includes("item_register:palette"),
  );
  function add(documentId: string | null = null, title = "New note") {
    const id = crypto.randomUUID();
    setSelected(id);
    setDetailsOpen(true);
    editor.update((data) => {
      const existing = data.boards.find((b) => b.key === boardKey),
        n = existing?.cards.length ?? 0;
      const next: BoardCard = {
        id,
        title,
        body: "",
        tags: [],
        group: "",
        documentId,
        color: "#f6f2e8",
        x: (n % 5) * 290,
        y: (Math.floor(n / 5) % 4) * 230,
        width: 260,
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
  async function upload(file?: File) {
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
      add(doc.id, file.name);
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
        <header className="row-between wrap design-header">
          <div>
            <p className="eyebrow">
              {project.name} · {phase.name}
            </p>
            <h1 className="display-m">{label(project, boardKey, "Board")}</h1>
            <p className="muted">
              Gather ideas, arrange them, and carry your selections forward.
            </p>
          </div>
          <DesignLink
            flush={editor.flush}
            className="btn btn-secondary"
            href={`/projects/${project.id}/documents#sharing-heading`}
          >
            <Link2 size={16} />
            Client links
          </DesignLink>
        </header>
        <SaveFeedback editor={editor} />
        {editor.data && (
          <>
            <div className="row wrap design-toolbar">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => add()}
              >
                <Plus size={16} />
                Add note
              </button>
              {fileStorage && (
                <label className="btn btn-secondary">
                  <ImagePlus size={16} />
                  {uploading
                    ? `Uploading ${Math.round(uploadProgress * 100)}%`
                    : "Upload image"}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    disabled={uploading}
                    onChange={(e) => {
                      void upload(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <label className="row small">
                Zoom
                <select
                  className="input"
                  value={zoom}
                  aria-label="Board zoom"
                  onChange={(e) => {
                    setZoom(Number(e.target.value));
                    if (!Number(e.target.value)) setFitSignal((n) => n + 1);
                  }}
                >
                  <option value={0}>Fit board</option>
                  {zoom > 0 && ![0.25, 0.5, 0.75, 1, 1.5, 2].includes(zoom) && (
                    <option value={zoom}>{Math.round(zoom * 100)}%</option>
                  )}
                  {[0.25, 0.5, 0.75, 1, 1.5, 2].map((z) => (
                    <option key={z} value={z}>
                      {z * 100}%
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="icon-btn"
                aria-label="Fit board to viewport"
                onClick={() => {
                  setZoom(0);
                  setFitSignal((n) => n + 1);
                }}
              >
                <Maximize size={17} />
              </button>
              <button
                type="button"
                className="btn btn-secondary board-details-toggle"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((o) => !o)}
              >
                <SlidersHorizontal size={16} />
                Card details
              </button>
              <label className="row small">
                Group
                <select
                  className="input"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  <option value="">All cards</option>
                  {[
                    ...new Set(
                      board?.cards.map((c) => c.group).filter(Boolean),
                    ),
                  ].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </label>
            </div>
            {uploadError && (
              <p role="alert" className="design-error">
                {uploadError}
              </p>
            )}
            <div className="board-workspace">
              {board ? (
                <BoardCanvas
                  board={board}
                  zoom={zoom}
                  onZoom={setZoom}
                  fitSignal={fitSignal}
                  selected={selected ?? undefined}
                  group={group}
                  imageUrl={(id) => downloadHref(project.id, id)}
                  onSelect={(id) => {
                    setSelected(id);
                    setDetailsOpen(true);
                  }}
                  onMove={(id, x, y) => edit(id, { x, y })}
                />
              ) : (
                <div className="board-empty">
                  <ImagePlus size={32} />
                  <h2>Your ideas start here</h2>
                  <p className="muted">
                    Add your first note, then pin images and organise your
                    direction.
                  </p>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => add()}
                  >
                    Add the first card
                  </button>
                </div>
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
                      Select a card to edit its notes, tags and group. Drag its
                      handle to move it; use the position fields for precise
                      placement.
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
                          if (doc) add(doc.id, doc.name);
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
                      {(["x", "y"] as const).map((axis) => (
                        <label key={axis} className="field">
                          <span className="field-label">
                            {axis.toUpperCase()} position
                          </span>
                          <input
                            className="input"
                            type="number"
                            min={0}
                            max={axis === "x" ? 1600 - card.width : 800}
                            value={card[axis]}
                            onChange={(e) =>
                              edit(card.id, { [axis]: Number(e.target.value) })
                            }
                          />
                        </label>
                      ))}
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
                        setSelected(null);
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
