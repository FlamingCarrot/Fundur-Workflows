"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useStudio } from "@/components/providers/StudioProvider";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "@/components/views/MissingProject";
import { useDesign } from "@/components/design/useDesign";
import { SaveFeedback } from "@/components/design/SaveFeedback";
import { DesignLink } from "@/components/design/DesignLink";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";
import { draftRfq, recordRfqRequested, saveRfq } from "@/lib/sourcing/model";
import type { RfqDraft } from "@/lib/sourcing/schema";
import { useSourcingLibrary } from "./useSourcingLibrary";
import { PracticeLibrary } from "./PracticeLibrary";
import { recoverRfq, RfqReview } from "./RfqReview";
import "@/components/design/design.css";
import "./sourcing.css";
export function RfqsView({ projectId }: { projectId: string }) {
  const { ready, getProject, viewer } = useStudio();
  const project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <RfqScreen
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
function RfqScreen({ project }: { project: Project }) {
  const { viewer, persistence } = useStudio(),
    editor = useDesign(project.id),
    library = useSourcingLibrary();
  const data = editor.data,
    phase = getWorkflow(project).phases.find((p) =>
      p.modules.includes("message_drafter"),
    );
  const [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [supplierFilter, setSupplierFilter] = useState(""),
    [supplierName, setSupplierName] = useState(""),
    [email, setEmail] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [deadline, setDeadline] = useState(""),
    [draft, setDraft] = useState<RfqDraft | null>(null),
    [recovered, setRecovered] = useState<RfqDraft | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const recoveryKey = `fundur.rfq-review.v1.${persistence}.${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}.${project.id}`;
  useEffect(() => {
    const saved = recoverRfq(recoveryKey);
    if (saved) queueMicrotask(() => setRecovered(saved.initial));
  }, [recoveryKey]);
  const shown =
    data?.items.filter(
      (i) =>
        (!supplierFilter || i.supplier === supplierFilter) &&
        `${i.name} ${i.category}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const picked = data?.items.filter((i) => selected.includes(i.id)) ?? [];
  const date = (value: string) =>
    new Date(value).toLocaleDateString("en-ZA", {
      timeZone: "Africa/Johannesburg",
    });
  async function copy(request: RfqDraft) {
    try {
      await navigator.clipboard.writeText(
        `Subject: ${request.subject}\n${request.recipientEmail ? `To: ${request.recipientEmail}\n` : ""}\n${request.body}`,
      );
      setNotice("Request copied.");
      setError("");
    } catch {
      setError(
        "Copy was unavailable. Download the text or open the draft to copy it.",
      );
    }
  }
  function download(request: RfqDraft) {
    const blob = new Blob(
        [
          `Subject: ${request.subject}\nTo: ${request.recipientEmail ?? "To be confirmed"}\n\n${request.body}`,
        ],
        { type: "text/plain;charset=utf-8" },
      ),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `quotation-request-${request.id}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (!phase)
    return (
      <main className="page">
        <p>Quote requests are not part of this workflow.</p>
        <Link href={`/projects/${project.id}`}>Back to project</Link>
      </main>
    );
  return (
    <FocusFrame
      wide
      title="Quote requests"
      exitHref={`/projects/${project.id}/phases/${phase.key}`}
      beforeExit={editor.flush}
      right={
        <span role="status" className="tiny muted">
          {editor.status}
        </span>
      }
    >
      <div className="design-page rfq-page" style={swatchVar(project.swatch)}>
        <header className="design-header">
          <p className="eyebrow">
            {project.name} · {phase.name}
          </p>
          <h1 className="display-m">Quote requests</h1>
          <p className="muted">
            Turn saved selections into a clear supplier request. Review it, use
            it in your email app, and track requests you have sent.
          </p>
        </header>
        <nav className="design-tabs" aria-label="Sourcing views">
          <DesignLink
            flush={editor.flush}
            href={`/projects/${project.id}/items/register`}
          >
            Sourcing register
          </DesignLink>
          <DesignLink
            flush={editor.flush}
            href={`/projects/${project.id}/items/schedule`}
          >
            Schedule
          </DesignLink>
        </nav>
        <SaveFeedback editor={editor} />
        <PracticeLibrary library={library} />
        {error && (
          <p className="design-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="small">
            {notice}
          </p>
        )}
        {data && (
          <>
            {recovered && !draft && (
              <section className="card rfq-recovery">
                <p>An unfinished quotation edit is kept in this browser.</p>
                <div className="row wrap">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      setDraft(recovered);
                      setRecovered(null);
                    }}
                  >
                    Recover unfinished draft
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      try {
                        localStorage.removeItem(recoveryKey);
                      } catch {}
                      setRecovered(null);
                    }}
                  >
                    Discard recovery
                  </button>
                </div>
              </section>
            )}
            {draft ? (
              <RfqReview
                key={draft.id}
                initial={draft}
                recoveryKey={recoveryKey}
                onCancel={() => {
                  setDraft(null);
                  setRecovered(null);
                }}
                onSave={async (request) => {
                  if (!editor.update((d) => saveRfq(d, request))) return false;
                  return editor.flush();
                }}
              />
            ) : (
              <section className="card rfq-form">
                <h2>Create a quotation draft</h2>
                <p className="small muted">
                  Select up to 50 items. Requests capture their current
                  specifications; saved drafts stay as written when selections
                  change.
                </p>
                <div className="rfq-fields">
                  {library.allowed && (
                    <label className="field">
                      <span className="field-label">Practice supplier</span>
                      <select
                        aria-label="Practice supplier"
                        className="input"
                        defaultValue=""
                        onChange={(e) => {
                          const entry = library.entries.find(
                            (r) => r.id === e.target.value,
                          );
                          if (entry?.kind === "supplier") {
                            setSupplierName(entry.data.name);
                            setEmail(entry.data.email ?? "");
                          }
                        }}
                      >
                        <option value="">Enter details below</option>
                        {library.entries
                          .filter((r) => r.kind === "supplier")
                          .map((r) => (
                            <option value={r.id} key={r.id}>
                              {r.data.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className="field">
                    <span className="field-label">Supplier for request</span>
                    <input
                      className="input"
                      maxLength={200}
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Email for request</span>
                    <input
                      className="input"
                      type="email"
                      maxLength={254}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Quotation template</span>
                    <select
                      aria-label="Quotation template"
                      className="input"
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                    >
                      <option value="">Standard quotation request</option>
                      {library.entries
                        .filter((r) => r.kind === "template")
                        .map((r) => (
                          <option value={r.id} key={r.id}>
                            {r.data.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">
                      Requested quote deadline
                    </span>
                    <input
                      className="input"
                      type="date"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Find request items</span>
                    <input
                      className="input"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Selection or category"
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Item supplier filter</span>
                    <select
                      aria-label="Item supplier filter"
                      className="input"
                      value={supplierFilter}
                      onChange={(e) => setSupplierFilter(e.target.value)}
                    >
                      <option value="">All suppliers</option>
                      {[
                        ...new Set(
                          data.items.map((i) => i.supplier).filter(Boolean),
                        ),
                      ]
                        .sort()
                        .map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="row wrap">
                  <p className="small strong">{picked.length} selected</p>
                  <button
                    className="btn btn-secondary"
                    disabled={!shown.length}
                    onClick={() =>
                      setSelected(shown.slice(0, 50).map((i) => i.id))
                    }
                  >
                    Select visible{shown.length > 50 ? " (first 50)" : ""}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setSelected([])}
                  >
                    Clear selection
                  </button>
                </div>
                <div className="rfq-selection-list">
                  {shown.map((i) => (
                    <label className="rfq-selection" key={i.id}>
                      <input
                        type="checkbox"
                        aria-label={`Include ${i.name}`}
                        checked={selected.includes(i.id)}
                        disabled={
                          !selected.includes(i.id) && picked.length >= 50
                        }
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
                          {i.dimensions || "Dimensions to be confirmed"}
                          {i.supplier ? ` · ${i.supplier}` : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {!shown.length && (
                  <p className="muted">
                    {data.items.length
                      ? "No selections match this filter."
                      : "Add selections to your schedule to start a request."}
                  </p>
                )}
                <button
                  className="btn btn-primary"
                  disabled={!picked.length || !!recovered}
                  onClick={() => {
                    try {
                      const template = library.entries.find(
                        (r) => r.id === templateId,
                      );
                      if (templateId && template?.kind !== "template")
                        throw new Error("Choose an available template.");
                      setDraft(
                        draftRfq(picked, {
                          supplierName,
                          recipientEmail: email.trim() || null,
                          project: project.name,
                          client: project.client,
                          practice: viewer.workspace || viewer.name,
                          deadline,
                          template:
                            template?.kind === "template"
                              ? template.data
                              : undefined,
                        }),
                      );
                      setError("");
                      setNotice("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Review draft
                </button>
              </section>
            )}
            <section className="rfq-saved">
              <h2>Saved requests</h2>
              {!data.rfqs?.length && (
                <p className="muted">No saved quotation requests yet.</p>
              )}
              {data.rfqs?.map((request) => (
                <article className="card rfq-request" key={request.id}>
                  <div className="row-between wrap">
                    <h3>{request.subject}</h3>
                    <span className="badge">
                      {request.requestedAt ? "Request recorded" : "Draft"}
                    </span>
                  </div>
                  <p className="small muted">
                    {request.supplierName} ·{" "}
                    {request.recipientEmail || "Email to be confirmed"} ·{" "}
                    {request.itemIds.length} selection(s)
                  </p>
                  <p className="tiny muted">
                    Created {date(request.createdAt)}
                    {request.requestedAt
                      ? ` · Sent recorded ${date(request.requestedAt)}`
                      : ""}
                  </p>
                  <details>
                    <summary>View request text</summary>
                    <pre className="rfq-text">{request.body}</pre>
                  </details>
                  <div className="row wrap">
                    <button
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => void copy(request)}
                    >
                      Copy request
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => download(request)}
                    >
                      Download text
                    </button>
                    {!request.requestedAt && (
                      <>
                        <button
                          className="btn btn-secondary"
                          disabled={!!draft || !!recovered || busy}
                          onClick={() => setDraft(request)}
                        >
                          Edit draft
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={!!draft || busy || !!editor.conflict}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              if (!(await editor.flush()))
                                throw new Error(
                                  "Save this project before recording the request.",
                                );
                              if (
                                !editor.update((d) =>
                                  recordRfqRequested(d, request.id),
                                ) ||
                                !(await editor.flush())
                              )
                                throw new Error(
                                  "The request has not been saved. Resolve the save issue above.",
                                );
                              setNotice(
                                "Sent request recorded. Items needing sourcing now show quote requested.",
                              );
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Record sent request
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-secondary"
                      disabled={busy || !!draft}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Remove this saved request? Item sourcing statuses stay as they are.",
                          )
                        )
                          editor.update((d) => ({
                            ...d,
                            rfqs: d.rfqs?.filter((r) => r.id !== request.id),
                          }));
                      }}
                    >
                      Remove request
                    </button>
                  </div>
                  {!request.requestedAt && (
                    <p className="tiny muted">
                      Use “Record sent request” after sending outside Fundur.
                      This updates items needing sourcing and preserves ordered
                      or delivered items.
                    </p>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </FocusFrame>
  );
}
