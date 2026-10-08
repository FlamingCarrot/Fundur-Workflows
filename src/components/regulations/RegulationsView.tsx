"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { MissingProject } from "@/components/views/MissingProject";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import {
  regulationPhase,
  projectRegulations,
  regulationSchema,
  regulationDraftSchema,
  type Regulation,
} from "@/lib/regulations/model";
import {
  precheckSchema,
  type PrecheckResult,
} from "@/lib/regulations/precheck-schema";
import { designRequest } from "@/lib/design/client";
import { zar } from "@/lib/studio/format";
import type { Project } from "@/lib/studio/types";
import "@/components/design/design.css";

export function RegulationsView({ projectId }: { projectId: string }) {
  const { ready, getProject, viewer } = useStudio();
  const project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <RegulationsScreen
          key={`${viewer.userId}.${viewer.workspaceId}.${project.id}`}
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
const categoryLabel = {
  fire_egress: "Fire & egress",
  accessibility: "Accessibility",
  other: "Other",
};
function RegulationsScreen({ project }: { project: Project }) {
  const { viewer, persistence, setRegulation, deleteRegulation, setCheck } =
    useStudio();
  const phase = regulationPhase(project);
  const requirements = projectRegulations(project),
    entries = Object.entries(requirements);
  const [form, setForm] = useState<{
    id: string;
    value: Regulation;
    draftId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState<PrecheckResult | null>(null),
    [selected, setSelected] = useState<number[]>([]);
  const [flagIds] = useState(() => new Map<number, string>());
  const [addedFlags, setAddedFlags] = useState<number[]>([]);
  const [filter, setFilter] = useState("all");
  if (!phase)
    return (
      <main className="page">
        <p>This workflow has no regulation checklist.</p>
        <Link href={`/projects/${project.id}`}>Back to project</Link>
      </main>
    );
  const editable =
    !project.completedPhases.includes(phase.key) && project.status === "active";
  const aiEnabled =
    persistence === "server" &&
    viewer.features?.ai !== false &&
    viewer.workspaceRole !== "collaborator" &&
    editable;
  const checked = entries.filter(([id]) => project.checks[id]).length;
  async function precheck() {
    setBusy(true);
    setError("");
    try {
      const result = await designRequest<PrecheckResult>(
        `/api/projects/${encodeURIComponent(project.id)}/regulations/precheck`,
        { method: "POST", body: "{}" },
      );
      const parsed = precheckSchema.safeParse({ flags: result.flags });
      if (!parsed.success)
        throw new Error("The flag list could not be read. Please retry.");
      setDraft({ ...result, flags: parsed.data.flags });
      setSelected([]);
      setAddedFlags([]);
      flagIds.clear();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addFlags() {
    if (!draft) return;
    setBusy(true);
    setError("");
    const added: number[] = [];
    try {
      for (const n of selected) {
        const flag = draft.flags[n];
        if (!flagIds.has(n)) flagIds.set(n, `reg-${crypto.randomUUID()}`);
        if (!(await setRegulation(project.id, flagIds.get(n)!, flag)))
          throw new Error(
            "Some flags could not be saved. Retry the remaining selection.",
          );
        added.push(n);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSelected((ids) => ids.filter((n) => !added.includes(n)));
      setAddedFlags((ids) => [...new Set([...ids, ...added])]);
      setBusy(false);
    }
  }
  const applied = entries.map(([id]) => id);
  return (
    <FocusFrame
      exitHref={`/projects/${project.id}/phases/${phase.key}`}
      title="Regulation checklist"
      wide
    >
      <main className="design-page" style={swatchVar(project.swatch)}>
        <header className="row-between wrap design-header">
          <div>
            <p className="eyebrow">
              {project.name} · {phase.name}
            </p>
            <h1 className="display-m">Regulation checklist</h1>
            <p className="muted">
              {checked} of {entries.length} requirements checked. Every
              requirement must be checked before this phase can finish.
            </p>
          </div>
          <div className="row wrap">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !aiEnabled || !!form}
              onClick={precheck}
            >
              <Sparkles size={16} /> AI pre-check
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !editable || entries.length >= 100 || !!form}
              onClick={() =>
                setForm({
                  id: `reg-${crypto.randomUUID()}`,
                  draftId: "new",
                  value: { title: "", category: "other", notes: "" },
                })
              }
            >
              <Plus size={16} /> Add requirement
            </button>
          </div>
        </header>
        <p className="callout small">
          Set the requirements for this project and record the evidence you
          reviewed. Starter prompts and AI flags require professional
          verification; a tick records your review and does not certify
          statutory compliance. Changing a requirement or its evidence clears
          its tick.
        </p>
        {persistence !== "server" && (
          <p className="tiny muted">
            The browser demo supports checklist editing. AI pre-checks use the
            configured model in the signed-in deployment.
          </p>
        )}
        <nav className="design-tabs" aria-label="Documentation views">
          <Link href={`/projects/${project.id}/items/schedule`}>
            Finishes schedule
          </Link>
          <Link
            href={`/projects/${project.id}/regulations`}
            aria-current="page"
          >
            Regulation checklist
          </Link>
          <Link href={`/projects/${project.id}/phases/${phase.key}`}>
            Phase and completion
          </Link>
        </nav>
        {error && (
          <p role="alert" className="callout">
            {error}
          </p>
        )}
        {form && (
          <RequirementForm
            key={form.id}
            draftKey={`fundur.regulation.draft.${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}.${project.id}.${form.draftId}`}
            initial={form.value}
            busy={busy}
            onCancel={() => setForm(null)}
            onSave={async (value) => {
              setBusy(true);
              setError("");
              try {
                const saved = await setRegulation(project.id, form.id, value);
                if (!saved) {
                  setError(
                    "The requirement could not be saved. Keep this form open and retry.",
                  );
                  return false;
                }
                setForm(null);
                return true;
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
        {draft && (
          <section
              className="card stack regulation-review"
            style={{ gap: "1rem", marginBottom: "1.5rem" }}
            aria-label="AI flags to review"
          >
            <div>
              <h2 className="display-s">Flags to review</h2>
              <p className="small muted">
                AI {zar(draft.costZar)} · {draft.model}. Select the questions to
                add as unchecked requirements.
              </p>
              {draft.reviewNote && (
                <p className="callout" role="alert">
                  {draft.reviewNote}
                </p>
              )}
              {!draft.flags.length && (
                <p>
                  No flags returned. Verify the checklist and supporting
                  evidence yourself.
                </p>
              )}
            </div>
            {draft.flags.map((f, n) => {
              const saved =
                addedFlags.includes(n) &&
                applied.includes(flagIds.get(n) ?? "");
              return (
                <label key={n} className="regulation-flag">
                  <input
                    type="checkbox"
                    checked={saved || selected.includes(n)}
                    disabled={busy || saved || !editable}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked ? [...s, n] : s.filter((i) => i !== n),
                      )
                    }
                  />
                  <span>
                    <strong>{f.title}</strong>
                    <span
                      className="small muted"
                      style={{ display: "block", whiteSpace: "pre-wrap" }}
                    >
                      {f.notes}
                    </span>
                    {saved && <span className="tiny">Added to checklist</span>}
                  </span>
                </label>
              );
            })}
            <div className="row wrap">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !selected.length || !editable || !!form}
                onClick={addFlags}
              >
                Add {selected.length} selected{" "}
                {selected.length === 1 ? "flag" : "flags"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setSelected([]);
                }}
              >
                Dismiss draft
              </button>
            </div>
          </section>
        )}
        <label className="row small" style={{ margin: "1rem 0" }}>
          Show{" "}
          <select
            className="input"
            aria-label="Requirement filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All requirements</option>
            <option value="open">Still to verify</option>
            <option value="checked">Checked</option>
          </select>
        </label>
        <div className="stack" style={{ gap: "1rem" }}>
          {entries
            .filter(
              ([id]) =>
                filter === "all" ||
                (filter === "checked"
                  ? !!project.checks[id]
                  : !project.checks[id]),
            )
            .map(([id, r]) => (
              <article
                key={id}
                className="card regulation-card"
                data-regulation-id={id}
              >
                <div
                  className="row-between"
                  style={{ alignItems: "flex-start", gap: "0.75rem" }}
                >
                  <label className="regulation-flag">
                    <input
                      type="checkbox"
                      aria-label={`Reviewed: ${r.title}`}
                      checked={!!project.checks[id]}
                      disabled={busy || !editable || !!form}
                      onChange={async (e) => {
                        setBusy(true);
                        setError("");
                        try {
                          if (
                            !(await setCheck(project.id, id, e.target.checked))
                          )
                            setError(
                              "This check could not be saved. Reload the checklist before retrying.",
                            );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    <span>
                      <span className="eyebrow">
                        {categoryLabel[r.category]}
                      </span>
                      <strong style={{ display: "block" }}>{r.title}</strong>
                    </span>
                  </label>
                  <div className="row">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Edit ${r.title}`}
                      disabled={busy || !editable || !!form}
                      onClick={() => setForm({ id, value: r, draftId: id })}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${r.title}`}
                      disabled={
                        busy || !editable || !!form || entries.length <= 1
                      }
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          if (!(await deleteRegulation(project.id, id)))
                            setError(
                              "The requirement could not be removed. Reload before retrying.",
                            );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <p
                  className="small muted"
                  style={{
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    marginTop: "0.75rem",
                  }}
                >
                  {r.notes || "No evidence notes yet."}
                </p>
                {project.checks[id] && (
                  <span className="tiny row" style={{ color: "var(--good)" }}>
                    <Check size={14} /> Checked by the designer
                  </span>
                )}
              </article>
            ))}
        </div>
      </main>
    </FocusFrame>
  );
}
function RequirementForm({
  initial,
  busy,
  onSave,
  onCancel,
  draftKey,
}: {
  initial: Regulation;
  draftKey: string;
  busy: boolean;
  onSave: (value: Regulation) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
        const parsed = regulationDraftSchema.safeParse(saved?.draft);
        if (
          parsed.success &&
          JSON.stringify(saved.initial) === JSON.stringify(initial)
        )
          return parsed.data;
      } catch {
        /* Keep the saved requirement when browser recovery is unavailable. */
      }
      return initial;
    }),
    [error, setError] = useState("");
  useEffect(() => {
    if (draft === initial) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ initial, draft }));
    } catch {
      /* The form remains in memory for explicit saving. */
    }
  }, [draft, initial, draftKey]);
  const clear = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* Saving does not depend on recovery cleanup. */
    }
  };
  return (
    <form
      className="card stack regulation-form"
      style={{ gap: "1rem", marginBottom: "1.5rem" }}
      aria-label="Edit requirement"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = regulationSchema.safeParse(draft);
        if (!parsed.success) {
          setError(parsed.error.issues[0].message);
          return;
        }
        void onSave(parsed.data).then((saved) => {
          if (saved) clear();
        });
      }}
    >
      <h2 className="display-s">Requirement and evidence</h2>
      <label className="field">
        <span className="field-label">Requirement</span>
        <input
          aria-label="Requirement"
          className="input"
          autoFocus
          maxLength={500}
          value={draft.title}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
      </label>
      <label className="field">
        <span className="field-label">Category</span>
        <select
          aria-label="Category"
          className="input"
          value={draft.category}
          disabled={busy}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              category: e.target.value as Regulation["category"],
            }))
          }
        >
          {Object.entries(categoryLabel).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Evidence / review notes</span>
        <textarea
          aria-label="Evidence / review notes"
          className="textarea input"
          rows={5}
          maxLength={3000}
          value={draft.notes}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
        />
      </label>
      {error && (
        <p role="alert" className="tiny">
          {error}
        </p>
      )}
      <div className="row wrap">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save requirement
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => {
            clear();
            onCancel();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
