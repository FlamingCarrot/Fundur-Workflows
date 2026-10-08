"use client";
import { useRef, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { MissingProject } from "@/components/views/MissingProject";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { getForm, phaseWithForm, label } from "@/lib/workflow";
import { designRequest } from "@/lib/design/client";
import type { Project } from "@/lib/studio/types";
export function ProjectForm({
  projectId,
  formKey,
}: {
  projectId: string;
  formKey: string;
}) {
  const { ready, getProject, viewer } = useStudio(),
    project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <FormScreen
          key={`${viewer.userId}.${viewer.workspaceId}.${projectId}.${formKey}`}
          project={project}
          formKey={formKey}
        />
      ) : (
        <main className="page">
          <MissingProject />
        </main>
      )}
    </WhenReady>
  );
}
function FormScreen({
  project,
  formKey,
}: {
  project: Project;
  formKey: string;
}) {
  const { viewer, persistence, receiveProject } = useStudio(),
    form = getForm(project, formKey),
    phase = phaseWithForm(project, formKey),
    scope = `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}.${project.id}.${formKey}`,
    draftKey = `fundur.form.draft.${persistence}.${scope}`;
  const [dirty, setDirty] = useState<Record<string, string>>(() => {
      try {
        const recovered = JSON.parse(localStorage.getItem(draftKey) ?? "{}");
        return Object.fromEntries(
          Object.entries(recovered).filter(
            ([k, v]) =>
              typeof v === "string" &&
              v.length <= 20000 &&
              form?.fields.some((f) => f.key === k),
          ),
        ) as Record<string, string>;
      } catch {
        return {};
      }
    }),
    latest = useRef(dirty);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const values = { ...(project.formValues?.[formKey] ?? {}), ...dirty };
  function keep(patch: Record<string, string>) {
    latest.current = patch;
    setDirty(patch);
    try {
      if (Object.keys(patch).length)
        localStorage.setItem(draftKey, JSON.stringify(patch));
      else localStorage.removeItem(draftKey);
    } catch {
      setError(
        "This browser could not keep a recovery draft. Keep the form open until it is saved.",
      );
    }
  }
  async function save() {
    if (busy) return false;
    const patch = { ...latest.current };
    if (!Object.keys(patch).length) return true;
    setBusy(true);
    setError("");
    try {
      const saved =
        persistence === "server"
          ? (
              await designRequest<{ project: Project }>(
                `/api/projects/${encodeURIComponent(project.id)}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    type: "setFormValues",
                    formKey,
                    patch,
                  }),
                },
              )
            ).project
          : {
              ...project,
              formValues: {
                ...project.formValues,
                [formKey]: { ...project.formValues?.[formKey], ...patch },
              },
            };
      receiveProject(saved);
      keep(
        Object.fromEntries(
          Object.entries(latest.current).filter(([k, v]) => patch[k] !== v),
        ),
      );
      setMessage("Saved");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  if (!form || !phase || formKey === "brief")
    return (
      <main className="page">
        <p>This form is unavailable.</p>
      </main>
    );
  return (
    <FocusFrame
      title={label(
        project,
        formKey,
        formKey.startsWith("notes:") ? "Phase notes" : formKey,
      )}
      exitHref={`/projects/${project.id}/phases/${phase.key}`}
      beforeExit={save}
    >
      <main className="page" style={{ maxWidth: 850 }}>
        <p className="eyebrow">
          {project.name} · {phase.name}
        </p>
        <h1 className="display-m">
          {label(
            project,
            formKey,
            formKey.startsWith("notes:") ? "Phase notes" : formKey,
          )}
        </h1>
        <p className="muted">
          Project fields defined by your practice workflow.
        </p>
        <form
          className="stack"
          style={{ gap: "1.25rem", marginTop: "2rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {form.fields.map((f) => (
            <label key={f.key} className="field">
              <span className="field-label">{f.label}</span>
              {f.hint && <span className="small muted">{f.hint}</span>}
              <textarea
                className="textarea"
                aria-label={f.label}
                rows={4}
                maxLength={20000}
                style={{ fontSize: 16 }}
                placeholder={f.placeholder}
                value={values[f.key] ?? ""}
                onChange={(e) => {
                  setMessage("");
                  keep({ ...latest.current, [f.key]: e.target.value });
                }}
              />
            </label>
          ))}
          <div className="row wrap">
            <button
              className="btn btn-primary"
              style={{ minHeight: 44 }}
              disabled={busy || !Object.keys(dirty).length}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
            <span className="small muted" role="status">
              {Object.keys(dirty).length ? "Unsaved changes" : message}
            </span>
          </div>
          {error && (
            <p role="alert" style={{ color: "var(--bad)" }}>
              {error}
            </p>
          )}
        </form>
      </main>
    </FocusFrame>
  );
}
