/* eslint-disable @next/next/no-img-element -- Private concept images bypass the shared optimization cache. */
"use client";
import { useCallback, useEffect, useState, useRef } from "react";
import { ProjectWorkPage } from "@/components/projects/ProjectWorkPage";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { MissingProject } from "@/components/views/MissingProject";
import { useTextDraft } from "@/hooks/useTextDraft";
import { getWorkflow, label } from "@/lib/workflow";
import { designRequest } from "@/lib/design/client";
import { downloadHref } from "@/lib/studio/uploads";
import type { Project } from "@/lib/studio/types";
import type {
  ConceptHistory,
  ConceptResult,
  ConceptGeneration,
} from "@/lib/concepts/schema";
import { useDesign } from "@/components/design/useDesign";
import { SaveFeedback } from "@/components/design/SaveFeedback";
import "@/components/design/design.css";
const money = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(
    n,
  );
export function ConceptView({ projectId }: { projectId: string }) {
  const { ready, getProject, viewer } = useStudio(),
    project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <ConceptScreen
          key={`${viewer.userId}.${viewer.workspaceId}.${projectId}`}
          project={project}
        />
      ) : (
        <main className="page">
          <MissingProject />
        </main>
      )}
    </WhenReady>
  );
}
function ConceptScreen({ project }: { project: Project }) {
  const { viewer, persistence, receiveProject, toast } = useStudio(),
    editor = useDesign(project.id);
  const receiveRef = useRef(receiveProject);
  useEffect(() => {
    receiveRef.current = receiveProject;
  }, [receiveProject]);
  const boards = getWorkflow(project).phases.flatMap((p) =>
    p.modules
      .filter((m) => m.startsWith("canvas_board:"))
      .map((m) => m.split(":")[1]),
  );
  const [boardKey, setBoardKey] = useState(
      boards.includes("moodboard") ? "moodboard" : (boards[0] ?? ""),
    ),
    [levelId, setLevelId] = useState(""),
    [referenceId, setReferenceId] = useState(""),
    [count, setCount] = useState(3),
    [history, setHistory] = useState<ConceptHistory | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const scope = `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}.${project.id}`;
  const [direction, setDirection] = useTextDraft(
    `fundur.concept.direction.${scope}`,
  );
  const endpoint = `/api/projects/${encodeURIComponent(project.id)}/design/concepts`;
  const allowed =
    persistence === "server" &&
    viewer.features?.ai !== false &&
    viewer.workspaceRole !== "collaborator";
  const load = useCallback(async () => {
    if (!allowed) return;
    const data = await designRequest<ConceptHistory & { project?: Project }>(
      endpoint,
    );
    setHistory(data);
    if (data.project) receiveRef.current(data.project);
  }, [allowed, endpoint]);
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    const refresh = () =>
      void load().catch((e) => {
        if (alive) setError((e as Error).message);
      });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [load, allowed]);
  const running = history?.generations.some((g) => g.status === "running");
  async function generate() {
    setBusy(true);
    setError("");
    try {
      if (!(await editor.flush()))
        throw new Error("Save the board changes before generating concepts.");
      const result = await designRequest<{
        generations: ConceptGeneration[];
        project: Project;
      }>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          boardKey,
          levelId: referenceId
            ? null
            : levelId || history?.levels[0]?.id || null,
          referenceDocumentId: referenceId || null,
          direction,
          count,
        }),
      });
      setHistory((h) => (h ? { ...h, generations: result.generations } : h));
      receiveProject(result.project);
    } catch (e) {
      setError((e as Error).message);
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function add(result: ConceptResult, generation: ConceptGeneration) {
    const target = generation.input.boardKey;
    if (!boards.includes(target)) {
      setError(
        "This board is unavailable in the current workflow. The image remains in Documents.",
      );
      return;
    }
    if (!project.documents.some((d) => d.id === result.documentId)) {
      setError("Refresh the saved history before adding this image.");
      void load();
      return;
    }
    editor.update((data) => {
      const existing = data.boards.find((b) => b.key === target);
      if (existing?.cards.some((c) => c.documentId === result.documentId))
        return data;
      const n = existing?.cards.length ?? 0;
      const card = {
        id: crypto.randomUUID(),
        title: result.title,
        body: `AI concept — ${generation.input.direction}\n${result.direction}\nConceptual only; confirm geometry and materials.`,
        tags: ["AI concept"],
        group: "Concept alternatives",
        documentId: result.documentId,
        color: "#f6f2e8",
        x: (n % 5) * 290,
        y: (Math.floor(n / 5) % 4) * 230,
        width: 260,
      };
      return {
        ...data,
        boards: existing
          ? data.boards.map((b) =>
              b.id === existing.id ? { ...b, cards: [...b.cards, card] } : b,
            )
          : [
              ...data.boards,
              { id: crypto.randomUUID(), key: target, cards: [card] },
            ],
      };
    });
    toast("Concept added to the board");
  }
  const images = project.documents.filter(
    (d) => d.stored && /\.(png|jpe?g|webp)$/i.test(d.name),
  );
  return (
    <ProjectWorkPage className="concepts-page" project={project} beforeNavigate={editor.flush} title="Concept visuals"
      description="Explore interior directions from your saved plan or project image, then choose what to keep.">
      <SaveFeedback editor={editor} />
      <section
        className="card stack"
        style={{ padding: "1.25rem", gap: "1rem", marginTop: "1.5rem" }}
      >
        <h2>Create alternatives</h2>
        <p className="small muted">
          The saved reference and brief fields you have confirmed are sent to
          the configured image provider. Results are conceptual: review layout,
          proportions and finishes before using them.
        </p>
        {!allowed ? (
          <p className="small muted">
            Concept generation is available to signed-in designers with AI
            enabled.
          </p>
        ) : history && !history.configured ? (
          <p role="status">
            An administrator needs to connect private file storage, choose an
            OpenRouter image input/output model and set its estimated image
            price in AI settings.
          </p>
        ) : null}
        <label className="field">
          <span className="field-label">Design direction</span>
          <textarea
            aria-label="Design direction"
            className="textarea"
            rows={4}
            maxLength={2000}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="e.g. Warm oak, textured stone, soft daylight and a calm reception space"
          />
        </label>
        <div className="item-form-grid">
          <label className="field">
            <span className="field-label">Destination board</span>
            <select
              className="input"
              value={boardKey}
              onChange={(e) => setBoardKey(e.target.value)}
            >
              {boards.map((key) => (
                <option key={key} value={key}>
                  {label(project, key, key)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Reference</span>
            <select
              className="input"
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
            >
              <option value="">Saved floor plan</option>
              {images.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {!referenceId && (
            <label className="field">
              <span className="field-label">Floor</span>
              <select
                className="input"
                value={levelId || history?.levels[0]?.id || ""}
                onChange={(e) => setLevelId(e.target.value)}
              >
                {history?.levels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span className="field-label">Alternatives</span>
            <select
              className="input"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        {history?.estimatedZarPerImage != null && (
          <p className="small">
            Estimated cost: {money(history.estimatedZarPerImage * count)}.
            Actual provider charges may differ; billed costs are used when
            reported.
          </p>
        )}
        <div className="row wrap">
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              !allowed ||
              !history?.configured ||
              busy ||
              running ||
              !direction.trim() ||
              !boards.length ||
              (!referenceId && !history?.hasPlan)
            }
            onClick={() => void generate()}
          >
            {busy || running
              ? "Generating — saved results appear below…"
              : "Generate concept visuals"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!allowed}
            onClick={() =>
              void load().catch((e) => setError((e as Error).message))
            }
          >
            Refresh history
          </button>
        </div>
        {running && (
          <p role="status" className="small muted">
            You can return to this project to review saved alternatives. Check
            this history before starting another request.
          </p>
        )}
        {error && (
          <p role="alert" className="design-error">
            {error}
          </p>
        )}
      </section>
      <section className="stack" style={{ gap: "1.25rem", marginTop: "2rem" }}>
        <h2>Saved alternatives</h2>
        {history?.generations.map((g) => (
          <article
            key={g.id}
            className="card stack"
            style={{ padding: "1.25rem", gap: "1rem" }}
          >
            <div className="row-between wrap">
              <strong>
                {new Date(g.createdAt).toLocaleString("en-ZA", {
                  timeZone: "Africa/Johannesburg",
                })}
              </strong>
              <span className="small muted">
                {g.status} · Recorded cost {money(g.costZar)}
              </span>
            </div>
            <p className="small" style={{ whiteSpace: "pre-wrap" }}>
              {g.input.direction}
            </p>
            {g.error && (
              <p role="alert" className="design-error">
                {g.error}
              </p>
            )}
            <div className="concept-results">
              {g.results.map((r) => {
                const added = editor.data?.boards
                  .find((b) => b.key === g.input.boardKey)
                  ?.cards.some((c) => c.documentId === r.documentId);
                return (
                  <div
                    key={r.documentId}
                    className="stack"
                    style={{ gap: ".65rem" }}
                  >
                    <a
                      href={downloadHref(project.id, r.documentId)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        className="concept-result-image"
                        src={downloadHref(project.id, r.documentId)}
                        alt={`${r.title}: ${r.direction}`}
                      />
                    </a>
                    <strong>{r.title}</strong>
                    <p className="small muted">
                      {r.direction} · {money(r.costZar)}
                      {r.estimatedCost ? " (estimated)" : ""}
                    </p>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={added || !editor.data}
                      onClick={() => add(r, g)}
                    >
                      {added ? "Added to board" : "Add to board"}
                    </button>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
        {history && !history.generations.length && (
          <p className="muted">
            Your generated alternatives will be saved here.
          </p>
        )}
      </section>
    </ProjectWorkPage>
  );
}
