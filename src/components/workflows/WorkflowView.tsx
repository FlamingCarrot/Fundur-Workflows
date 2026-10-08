"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStudio } from "@/components/providers/StudioProvider";
import { designRequest } from "@/lib/design/client";
import { listWorkflows } from "@/lib/workflow";
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type PhaseDefinition,
} from "@/lib/workflow/schema";
import {
  EDITABLE_MODULES,
  moveEntry,
  publishErrors,
  type WorkflowDraft,
  type WorkflowLibrary,
} from "@/lib/workflow/editor-model";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import "./workflow.css";
const key = () => `step-${crypto.randomUUID().slice(0, 8)}`;
export function WorkflowView() {
  const { viewer, persistence } = useStudio();
  const [library, setLibrary] = useState<WorkflowLibrary>({
      drafts: [],
      versions: listWorkflows(),
    }),
    [selected, setSelected] = useState(""),
    [source, setSource] = useState(listWorkflows()[0].id),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const enabled = persistence === "server" && viewer.workspaceRole === "owner";
  const openedRequested=useRef(false);
  const load = useCallback(async () => {
    if (enabled)
      return designRequest<WorkflowLibrary>("/api/workflows").then((data)=>{setLibrary(data);if(!openedRequested.current){const requested=new URLSearchParams(window.location.search).get("draft");if(requested&&data.drafts.some(d=>d.id===requested))setSelected(requested);openedRequested.current=true;}});
  }, [enabled]);
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [load]);
  async function create(definition?: WorkflowDefinition) {
    setBusy(true);
    setError("");
    try {
      const result = await designRequest<{ draft: WorkflowDraft }>(
        "/api/workflows",
        {
          method: "POST",
          body: JSON.stringify(
            definition ? { definition } : { sourceId: source },
          ),
        },
      );
      await load();
      setSelected(result.draft.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const draft = library.drafts.find((d) => d.id === selected);
  const latest = [...new Map(library.versions.map((w) => [w.id, w])).values()];
  return (
    <main className="page workflow-page">
      <p className="eyebrow">Practice library</p>
      <h1 className="display-m">Workflows</h1>
      {enabled&&<Link className="btn" href="/workflows/build">Build from your process</Link>}
      <p className="muted">
        Shape your practice process, preview it and publish versions for new
        projects. Running projects keep their original definition.
      </p>
      {!enabled && (
        <p role="status">
          Workflow editing is available to a signed-in workspace owner.
        </p>
      )}
      <section
        className="card stack"
        style={{ padding: "1.25rem", gap: "1rem", marginTop: "1.5rem" }}
      >
        <div className="row wrap">
          <label className="field grow">
            <span className="field-label">Copy a published workflow</span>
            <select
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            >
              {latest.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · v{w.version}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-primary"
            disabled={!enabled || busy}
            onClick={() => void create()}
          >
            Create practice draft
          </button>
          <label className="btn btn-secondary">
            Import JSON
            <input
              className="sr-only"
              type="file"
              accept=".json,application/json"
              disabled={!enabled || busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > 100000) {
                  setError("Keep imports under 100 KB.");
                  return;
                }
                try {
                  await create(
                    WorkflowDefinitionSchema.parse(
                      JSON.parse(await file.text()),
                    ),
                  );
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="workflow-error">
            {error}
          </p>
        )}
      </section>
      <div className="workflow-layout">
        <aside
          className="stack"
          style={{ gap: ".5rem" }}
          aria-label="Practice workflows"
        >
          {library.drafts.map((d) => (
            <button
              className="card card-link workflow-draft-choice"
              key={d.id}
              aria-pressed={d.id === selected}
              onClick={() => setSelected(d.id)}
            >
              <strong>{d.definition.name}</strong>
              <span className="tiny muted">
                {d.publishedVersion
                  ? `Published v${d.publishedVersion} · draft v${d.publishedVersion + 1}`
                  : "Unpublished draft"}
              </span>
            </button>
          ))}
        </aside>
        {draft ? (
          <Editor
            key={draft.id}
            draft={draft}
            versions={library.versions.filter((v) => v.id === draft.id)}
            scope={`${viewer.userId}.${viewer.workspaceId}`}
            onChanged={async () => {
              await load();
            }}
          />
        ) : (
          <section className="card" style={{ padding: "1.5rem" }}>
            <p className="muted">
              Create or select a draft to edit its process.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
function Editor({
  draft,
  versions,
  scope,
  onChanged,
}: {
  draft: WorkflowDraft;
  versions: WorkflowDefinition[];
  scope: string;
  onChanged: () => Promise<void>;
}) {
  const draftKey = `fundur.workflow.draft.${scope}.${draft.id}`;
  const recovered = useRef<{
    revision: number;
    definition: WorkflowDefinition;
  } | null>(null);
  const [definition, setDefinition] = useState(() => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (value) {
        const validated = {
          revision: Number(value.revision),
          definition: WorkflowDefinitionSchema.parse(value.definition),
        };
        if (validated.revision === draft.revision) return validated.definition;
        recovered.current = validated;
      }
    } catch {}
    return draft.definition;
  });
  const [revision, setRevision] = useState(draft.revision),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState(false),
    [restoreVersion, setRestoreVersion] = useState("");
  const saved = useRef(JSON.stringify(draft.definition));
  const latestDefinition = useRef(definition);
  latestDefinition.current = definition;
  const changed = JSON.stringify(definition) !== saved.current;
  const validation = publishErrors(definition);
  const errors = validation.errors;
  function change(next: WorkflowDefinition) {
    setDefinition(next);
    setMessage("");
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ revision, definition: next }),
      );
    } catch {
      setError(
        "Browser recovery is unavailable. Save this draft before leaving.",
      );
    }
  }
  async function action(action: "save" | "publish" | "restore") {
    if (busy) return;
    setBusy(true);
    setError("");
    const sent = definition;
    try {
      const result = await designRequest<{ draft: WorkflowDraft }>(
        `/api/workflows/${encodeURIComponent(draft.id)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            action,
            revision,
            ...(action === "save" ? { definition: sent } : {}),
            ...(action === "restore"
              ? { version: Number(restoreVersion) }
              : {}),
          }),
        },
      );
      setRevision(result.draft.revision);
      saved.current = JSON.stringify(result.draft.definition);
      if (latestDefinition.current === sent || action !== "save") {
        setDefinition(result.draft.definition);
        localStorage.removeItem(draftKey);
      } else {
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            revision: result.draft.revision,
            definition: latestDefinition.current,
          }),
        );
      }
      setMessage(
        action === "publish"
          ? `Published version ${result.draft.publishedVersion}. New projects can use it.`
          : action === "restore"
            ? "Older version copied to a new draft. Review and publish when ready."
            : "Draft saved",
      );
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const result = await designRequest<{ draft: WorkflowDraft }>(
        `/api/workflows/${encodeURIComponent(draft.id)}`,
      );
      setDefinition(result.draft.definition);
      setRevision(result.draft.revision);
      saved.current = JSON.stringify(result.draft.definition);
      localStorage.removeItem(draftKey);
      recovered.current = null;
      setError("");
      setMessage("Latest draft loaded");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function editPhase(index: number, patch: Partial<PhaseDefinition>) {
    change({
      ...definition,
      phases: definition.phases.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    });
  }
  function exportJson() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(definition, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-${draft.id}-v${definition.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="card workflow-editor stack"
      style={{ padding: "1.25rem", gap: "1.25rem" }}
    >
      <div className="row-between wrap">
        <h2>Edit practice workflow</h2>
        <span className="small muted">
          v{draft.publishedVersion + 1} draft ·{" "}
          {changed ? "Unsaved changes" : "Saved"}
        </span>
      </div>
      {recovered.current && (
        <div className="workflow-error">
          <p>
            A browser draft was saved against an older revision. Review it
            against the current process before saving.
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              change(recovered.current!.definition);
              recovered.current = null;
            }}
          >
            Recover browser edits
          </button>
        </div>
      )}
      <div className="row wrap">
        <button
          className="btn btn-primary"
          disabled={busy || !changed}
          onClick={() => void action("save")}
        >
          Save draft
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy || changed || errors.length > 0}
          onClick={() => void action("publish")}
        >
          Publish new version
        </button>
        <button
          className="btn btn-secondary"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Back to editor" : "Preview workflow"}
        </button>
        <button className="btn btn-ghost" onClick={exportJson}>
          Export JSON
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void reload()}
        >
          Discard edits and reload
        </button>
      </div>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="workflow-error" role="alert">
          {error}
        </p>
      )}
      {errors.length > 0 && (
        <div className="workflow-error" role="alert">
          <strong>Resolve before publishing</strong>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {preview ? (
        <div className="stack" style={{ gap: "1rem" }}>
          <h3>{definition.name}</h3>
          <p>{definition.description}</p>
          {definition.phases.map((p, i) => (
            <article className="workflow-section" key={p.key}>
              <h3>
                {i + 1}. {p.name}
              </h3>
              <p className="small muted">{p.description}</p>
              <p className="tiny muted">{p.modules.join(" · ")}</p>
              <ul>
                {p.checklist.map((c) => (
                  <li key={c.id}>
                    {c.text}
                    {c.essential ? " · essential" : ""}
                    {c.relativeDaysDue != null
                      ? ` · day ${c.relativeDaysDue}`
                      : ""}
                  </li>
                ))}
              </ul>
              {p.modules
                .filter((m) => m.startsWith("structured_form:"))
                .map((m) => {
                  const form = definition.forms.find(
                    (f) => f.key === m.split(":")[1],
                  );
                  return (
                    <p className="small" key={m}>
                      {form?.fields.map((f) => f.label).join(" · ")}
                    </p>
                  );
                })}
            </article>
          ))}
          <h3>Handoffs</h3>
          {definition.handoffs.map((h, i) => (
            <p className="small" key={i}>
              {h.from} → {h.to}
              {h.description ? `: ${h.description}` : ""}
            </p>
          ))}
        </div>
      ) : (
        <>
          <label className="field">
            <span className="field-label">Workflow name</span>
            <input
              className="input"
              value={definition.name}
              maxLength={200}
              onChange={(e) => change({ ...definition, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Description</span>
            <textarea
              className="textarea"
              aria-label="Workflow description"
              rows={3}
              maxLength={2000}
              value={definition.description}
              onChange={(e) =>
                change({ ...definition, description: e.target.value })
              }
            />
          </label>
          <h3>Phases and steps</h3>
          {definition.phases.map((p, i) => (
            <details className="workflow-section" key={i} open={i === 0}>
              <summary>
                {i + 1}. {p.name || "Untitled phase"}
              </summary>
              <div
                className="stack"
                style={{ gap: ".85rem", marginTop: "1rem" }}
              >
                <div className="row wrap">
                  <button
                    className="btn btn-ghost"
                    disabled={i === 0}
                    onClick={() =>
                      change({
                        ...definition,
                        phases: moveEntry(definition.phases, i, -1),
                      })
                    }
                  >
                    Move up
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={i === definition.phases.length - 1}
                    onClick={() =>
                      change({
                        ...definition,
                        phases: moveEntry(definition.phases, i, 1),
                      })
                    }
                  >
                    Move down
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={definition.phases.length <= 1}
                    onClick={() =>
                      change({
                        ...definition,
                        phases: definition.phases.filter((_, n) => i !== n),
                      })
                    }
                  >
                    Remove phase
                  </button>
                </div>
                <div className="workflow-fields">
                  <label className="field">
                    <span className="field-label">Phase name</span>
                    <input
                      className="input"
                      value={p.name}
                      onChange={(e) => editPhase(i, { name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Phase key</span>
                    <input
                      className="input"
                      value={p.key}
                      onChange={(e) => editPhase(i, { key: e.target.value })}
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">Phase description</span>
                  <textarea
                    className="textarea"
                    aria-label={`Phase ${i + 1} description`}
                    rows={2}
                    value={p.description}
                    onChange={(e) =>
                      editPhase(i, { description: e.target.value })
                    }
                  />
                </label>
                <strong className="small">Modules</strong>
                <div className="stack" style={{ gap: ".5rem" }}>
                  {p.modules.map((m, n) => (
                    <div key={n} className="row">
                      <select
                        className="input grow"
                        aria-label={`Phase ${i + 1} module ${n + 1}`}
                        value={m}
                        onChange={(e) =>
                          editPhase(i, {
                            modules: p.modules.map((v, j) =>
                              j === n ? e.target.value : v,
                            ),
                          })
                        }
                      >
                        {moduleOptions(definition).map((o) => (
                          <option value={o.key} key={o.key}>
                            {o.name}
                          </option>
                        ))}
                        {!moduleOptions(definition).some(
                          (o) => o.key === m,
                        ) && <option value={m}>{m}</option>}
                      </select>
                      <button
                        className="btn btn-ghost"
                        aria-label={`Remove ${m} from phase ${i + 1}`}
                        disabled={p.modules.length === 1}
                        onClick={() =>
                          editPhase(i, {
                            modules: p.modules.filter((_, j) => j !== n),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    editPhase(i, { modules: [...p.modules, "documents"] })
                  }
                >
                  Add module
                </button>
                <strong className="small">Checklist steps</strong>
                {p.checklist.map((c, n) => (
                  <div className="workflow-step stack" key={c.id}>
                    <label className="field">
                      <span className="field-label">Step {n + 1}</span>
                      <input
                        className="input"
                        value={c.text}
                        onChange={(e) =>
                          editPhase(i, {
                            checklist: p.checklist.map((v, j) =>
                              j === n ? { ...v, text: e.target.value } : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <div className="row wrap">
                      <label className="row small">
                        <input
                          type="checkbox"
                          checked={c.essential}
                          onChange={(e) =>
                            editPhase(i, {
                              checklist: p.checklist.map((v, j) =>
                                j === n
                                  ? { ...v, essential: e.target.checked }
                                  : v,
                              ),
                            })
                          }
                        />
                        Essential for completion
                      </label>
                      <label className="field">
                        <span className="field-label">
                          Days from project start
                        </span>
                        <input
                          className="input"
                          type="number"
                          value={c.relativeDaysDue ?? ""}
                          onChange={(e) =>
                            editPhase(i, {
                              checklist: p.checklist.map((v, j) =>
                                j === n
                                  ? {
                                      ...v,
                                      relativeDaysDue:
                                        e.target.value === ""
                                          ? undefined
                                          : Number(e.target.value),
                                    }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        className="btn btn-ghost"
                        disabled={n === 0}
                        onClick={() =>
                          editPhase(i, {
                            checklist: moveEntry(p.checklist, n, -1),
                          })
                        }
                      >
                        Move step up
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          editPhase(i, {
                            checklist: p.checklist.filter((_, j) => j !== n),
                          })
                        }
                      >
                        Remove step
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    editPhase(i, {
                      checklist: [
                        ...p.checklist,
                        { id: key(), text: "New step", essential: false },
                      ],
                    })
                  }
                >
                  Add step
                </button>
              </div>
            </details>
          ))}
          <button
            className="btn btn-secondary"
            onClick={() =>
              change({
                ...definition,
                phases: [
                  ...definition.phases,
                  {
                    key: `phase_${crypto.randomUUID().slice(0, 8)}`,
                    name: "New phase",
                    description: "",
                    modules: ["checklist", "documents"],
                    checklist: [],
                    ai_actions: [],
                  },
                ],
              })
            }
          >
            Add phase
          </button>
          <h3>Forms and fields</h3>
          <p className="small muted">
            Add the form module to a phase after defining its fields. Fields are
            editable project text areas.
          </p>
          {definition.forms.map((f, i) => (
            <details className="workflow-section" key={i}>
              <summary>{definition.labels[f.key] ?? f.key}</summary>
              <div
                className="stack"
                style={{ gap: ".85rem", marginTop: "1rem" }}
              >
                <div className="workflow-fields">
                  <label className="field">
                    <span className="field-label">Form key</span>
                    <input
                      className="input"
                      value={f.key}
                      onChange={(e) =>
                        change({
                          ...definition,
                          forms: definition.forms.map((v, n) =>
                            i === n ? { ...v, key: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Form label</span>
                    <input
                      className="input"
                      value={definition.labels[f.key] ?? ""}
                      onChange={(e) =>
                        change({
                          ...definition,
                          labels: {
                            ...definition.labels,
                            [f.key]: e.target.value,
                          },
                        })
                      }
                    />
                  </label>
                </div>
                {f.fields.map((field, j) => (
                  <div className="workflow-step stack" key={j}>
                    <div className="workflow-fields">
                      <label className="field">
                        <span className="field-label">Field key</span>
                        <input
                          className="input"
                          value={field.key}
                          onChange={(e) =>
                            change({
                              ...definition,
                              forms: definition.forms.map((v, n) =>
                                i === n
                                  ? {
                                      ...v,
                                      fields: v.fields.map((q, k) =>
                                        j === k
                                          ? { ...q, key: e.target.value }
                                          : q,
                                      ),
                                    }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                      <label className="field">
                        <span className="field-label">Field label</span>
                        <input
                          className="input"
                          value={field.label}
                          onChange={(e) =>
                            change({
                              ...definition,
                              forms: definition.forms.map((v, n) =>
                                i === n
                                  ? {
                                      ...v,
                                      fields: v.fields.map((q, k) =>
                                        j === k
                                          ? { ...q, label: e.target.value }
                                          : q,
                                      ),
                                    }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span className="field-label">Help text</span>
                      <input
                        className="input"
                        value={field.hint ?? ""}
                        onChange={(e) =>
                          change({
                            ...definition,
                            forms: definition.forms.map((v, n) =>
                              i === n
                                ? {
                                    ...v,
                                    fields: v.fields.map((q, k) =>
                                      j === k
                                        ? { ...q, hint: e.target.value }
                                        : q,
                                    ),
                                  }
                                : v,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      className="btn btn-ghost"
                      disabled={f.fields.length <= 1}
                      onClick={() =>
                        change({
                          ...definition,
                          forms: definition.forms.map((v, n) =>
                            i === n
                              ? {
                                  ...v,
                                  fields: v.fields.filter((_, k) => k !== j),
                                }
                              : v,
                          ),
                        })
                      }
                    >
                      Remove field
                    </button>
                  </div>
                ))}
                <button
                  className="btn btn-secondary"
                  onClick={() =>
                    change({
                      ...definition,
                      forms: definition.forms.map((v, n) =>
                        i === n
                          ? {
                              ...v,
                              fields: [
                                ...v.fields,
                                {
                                  key: `field_${crypto.randomUUID().slice(0, 8)}`,
                                  label: "New field",
                                },
                              ],
                            }
                          : v,
                      ),
                    })
                  }
                >
                  Add field
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    change({
                      ...definition,
                      forms: definition.forms.filter((_, n) => i !== n),
                    })
                  }
                >
                  Remove form
                </button>
              </div>
            </details>
          ))}
          <button
            className="btn btn-secondary"
            onClick={() =>
              change({
                ...definition,
                forms: [
                  ...definition.forms,
                  {
                    key: `form_${crypto.randomUUID().slice(0, 8)}`,
                    fields: [{ key: "notes", label: "Notes" }],
                  },
                ],
              })
            }
          >
            Add form
          </button>
          <h3>Handoffs</h3>
          <p className="small muted">
            Use phase.output → phase.input references. These describe the
            transfer for the next phase; they do not execute arbitrary
            automations.
          </p>
          {definition.handoffs.map((h, i) => (
            <div className="workflow-step stack" key={i}>
              <div className="workflow-fields">
                {(["from", "to"] as const).map((field) => (
                  <label className="field" key={field}>
                    <span className="field-label">
                      {field === "from" ? "From" : "To"}
                    </span>
                    <input
                      className="input"
                      value={h[field]}
                      onChange={(e) =>
                        change({
                          ...definition,
                          handoffs: definition.handoffs.map((v, n) =>
                            i === n ? { ...v, [field]: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="field">
                <span className="field-label">Handoff description</span>
                <input
                  className="input"
                  value={h.description ?? ""}
                  onChange={(e) =>
                    change({
                      ...definition,
                      handoffs: definition.handoffs.map((v, n) =>
                        i === n ? { ...v, description: e.target.value } : v,
                      ),
                    })
                  }
                />
              </label>
              <button
                className="btn btn-ghost"
                onClick={() =>
                  change({
                    ...definition,
                    handoffs: definition.handoffs.filter((_, n) => i !== n),
                  })
                }
              >
                Remove handoff
              </button>
            </div>
          ))}
          <button
            className="btn btn-secondary"
            onClick={() =>
              change({
                ...definition,
                handoffs: [
                  ...definition.handoffs,
                  {
                    from: `${definition.phases[0].key}.output`,
                    to: `${definition.phases.at(-1)!.key}.input`,
                    description: "",
                  },
                ],
              })
            }
          >
            Add handoff
          </button>
        </>
      )}
      <div className="workflow-section stack" style={{ gap: ".75rem" }}>
        <h3>Published versions</h3>
        <p className="small muted">
          Restore copies a previous edition into the draft. Publish it as a new
          version to make it available for new projects.
        </p>
        <div className="row wrap">
          <select
            className="input grow"
            aria-label="Published version to restore"
            value={restoreVersion}
            onChange={(e) => setRestoreVersion(e.target.value)}
          >
            <option value="">Choose a version</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} · {v.name}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            disabled={busy || changed || !restoreVersion}
            onClick={() => void action("restore")}
          >
            Restore to draft
          </button>
        </div>
      </div>
    </section>
  );
}
function moduleOptions(def: WorkflowDefinition) {
  return EDITABLE_MODULES.flatMap((m) =>
    m === "structured_form"
      ? def.forms.map((f) => ({
          key: `structured_form:${f.key}`,
          name: `Form: ${def.labels[f.key] ?? f.key}`,
        }))
      : m === "canvas_board"
        ? ["moodboard", "references"].map((k) => ({
            key: `canvas_board:${k}`,
            name: `Board: ${k}`,
          }))
        : m === "item_register"
          ? ["palette", "schedule", "register", "outstanding"].map((k) => ({
              key: `item_register:${k}`,
              name: `Selections: ${k}`,
            }))
          : [{ key: m, name: MODULE_REGISTRY[m].name }],
  );
}
