"use client";
import { useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { WhenReady } from "@/components/ui/primitives";
import { MissingProject } from "@/components/views/MissingProject";
import { useDesign } from "@/components/design/useDesign";
import { DesignLink } from "@/components/design/DesignLink";
import { SaveFeedback } from "@/components/design/SaveFeedback";
import type { Project } from "@/lib/studio/types";
import { captureSetup } from "@/lib/templates/model";
import { projectRegulations } from "@/lib/regulations/model";
import { useTemplates } from "./useTemplates";
import "@/components/design/design.css";
import "@/components/sourcing/sourcing.css";
export function TemplatesView({ projectId }: { projectId: string }) {
  const { ready, getProject, viewer } = useStudio(),
    project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <TemplateScreen
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
function TemplateScreen({ project }: { project: Project }) {
  const editor = useDesign(project.id),
    library = useTemplates(),
    [selected, setSelected] = useState<string[]>([]),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <FocusFrame
      title="Reusable project setups"
      wide
      beforeExit={editor.flush}
      exitHref={`/projects/${project.id}/documents`}
    >
      <div className="design-page rfq-page">
        <header className="design-header">
          <p className="eyebrow">{project.name}</p>
          <h1 className="display-m">Reusable project setups</h1>
          <p className="muted">
            Start a similar project with a chosen schedule and requirement
            titles.
          </p>
        </header>
        {!library.allowed ? (
          <p>
            Practice setups are available to owners and members with design
            tools enabled.
          </p>
        ) : (
          <>
            <nav className="design-tabs" aria-label="Setup sources">
              <DesignLink
                flush={editor.flush}
                href={`/projects/${project.id}/items/schedule`}
              >
                Review schedule
              </DesignLink>
              <DesignLink
                flush={editor.flush}
                href={`/projects/${project.id}/regulations`}
              >
                Review requirement titles
              </DesignLink>
            </nav>
            <SaveFeedback editor={editor} />
            {(error || library.error) && (
              <div role="alert">
                <p className="design-error">{error || library.error}</p>
                <button
                  className="btn btn-secondary"
                  onClick={() => void library.reload()}
                >
                  Retry library
                </button>
              </div>
            )}
            {notice && <p role="status">{notice}</p>}
            {editor.data && (
              <form
                className="card rfq-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    if (!(await editor.flush()))
                      throw new Error(
                        "Save this project before capturing a setup.",
                      );
                    await library.save({
                      name,
                      data: captureSetup(project, editor.data!, selected),
                    });
                    setNotice(
                      "Setup saved. Choose it when creating a new project.",
                    );
                    setName("");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h2>Save a practice setup</h2>
                <label className="field">
                  <span className="field-label">Setup name</span>
                  <input
                    className="input"
                    disabled={busy}
                    required
                    maxLength={200}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Small office essentials"
                  />
                </label>
                <p className="small muted">
                  Shared with practice owners and members. Review requirement titles, item names,
                  tags and specifications for client-specific text before
                  saving. Each new project gets fresh item IDs and unchecked
                  requirements. Prices, suppliers, delivery dates, orders,
                  files, notes and review evidence reset.
                </p>
                <div className="row wrap">
                  <strong>{selected.length} selections</strong>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() =>
                      setSelected(
                        editor.data!.items.slice(0, 200).map((i) => i.id),
                      )
                    }
                  >
                    Select first {Math.min(200, editor.data.items.length)}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => setSelected([])}
                  >
                    Clear selections
                  </button>
                </div>
                <div className="rfq-selection-list">
                  {editor.data.items.map((i) => (
                    <label className="rfq-selection" key={i.id}>
                      <input
                        type="checkbox"
                        aria-label={`Reuse ${i.name}`}
                        disabled={
                          busy ||
                          (!selected.includes(i.id) && selected.length >= 200)
                        }
                        checked={selected.includes(i.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, i.id]
                              : ids.filter((id) => id !== i.id),
                          )
                        }
                      />
                      <span>
                        <strong>{i.name}</strong>
                        <span className="small muted">
                          Qty {i.quantity} ·{" "}
                          {i.dimensions || "Dimensions to confirm"}
                        </span>
                        {selected.includes(i.id) && (
                          <span className="small muted">
                            {i.specification || "Specification to confirm"}
                            {i.tags.length
                              ? ` · Tags: ${i.tags.join(", ")}`
                              : ""}
                          </span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                <details>
                  <summary>
                    {Object.keys(projectRegulations(project)).length} unchecked
                    requirement titles to reuse
                  </summary>
                  <ul>
                    {Object.values(projectRegulations(project)).map((r, i) => (
                      <li key={i}>{r.title}</li>
                    ))}
                  </ul>
                </details>
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? "Saving setup…" : "Save setup"}
                </button>
              </form>
            )}
            <section>
              <h2>Practice setups</h2>
              <p className="small muted">
                Choose a setup in the workflow step when creating a new project.
                Existing projects stay intact when a setup is removed.
              </p>
              {!library.templates.length && (
                <p className="muted">No reusable setups yet.</p>
              )}
              {library.templates.map((t) => (
                <article className="card rfq-request" key={t.id}>
                  <h3>{t.name}</h3>
                  <p className="small muted">
                    {t.itemCount} selections · {t.requirementCount} requirement
                    titles · workflow version {t.workflowVersion}
                  </p>
                  <button
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Remove ${t.name} from the practice library?`,
                        )
                      )
                        return;
                      setBusy(true);
                      try {
                        await library.remove(t.id);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Remove setup {t.name}
                  </button>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </FocusFrame>
  );
}
