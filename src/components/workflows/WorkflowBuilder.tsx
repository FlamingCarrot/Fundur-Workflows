"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStudio } from "@/components/providers/StudioProvider";
import { designRequest } from "@/lib/design/client";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import {
  BuildInputSchema,
  BuildDraftSchema,
  type BuildInput,
  type BuildRecord,
  type BuilderSettings,
} from "@/lib/workflow/builder-model";
import type { WorkflowDraft } from "@/lib/workflow/editor-model";
import "./workflow.css";
const empty: BuildInput = {
  process: "",
  outputs: "",
  people: "",
  documents: "",
  aiHelp: "",
  procedure: "",
  answers: [],
};
export type AdminState = {
  backlog: {
    id: string;
    capability: string;
    status: string;
    workspace_name: string;
    workflow_name: string | null;
  }[];
  metrics: {
    id: string;
    name: string;
    summary: Record<string, number | boolean>;
  }[];
};
type BuilderState = { settings: BuilderSettings; builds: BuildRecord[] };
export function WorkflowBuilder() {
  const { viewer } = useStudio();
  return <PracticeBuilder key={`${viewer.userId}.${viewer.workspaceId}`} />;
}
function PracticeBuilder() {
  const { viewer, persistence } = useStudio(),
    router = useRouter();
  const [input, setInput] = useState(empty),
    [data, setData] = useState<BuilderState | null>(null),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [admin, setAdmin] = useState<AdminState | null>(null),
    [config, setConfig] = useState<BuilderSettings | null>(null),
    [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>(
      {},
    );
  const storageKey = `fundur.workflow.builder.${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}`;
  const recovered = useRef(false);
  const enabled = persistence === "server" && viewer.workspaceRole === "owner";
  const load = useCallback(async () => {
    if (!enabled) return;
    const result = await designRequest<BuilderState>("/api/workflows/build");
    setData(result);
    if (viewer.isAdmin) {
      const a = await designRequest<AdminState & { settings: BuilderSettings }>(
        "/api/admin/workflow-builder",
      );
      setAdmin(a);
      setConfig(a.settings);
    }
  }, [enabled, viewer.isAdmin]);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => setError((e as Error).message));
  }, [load]);
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const value = JSON.parse(saved),
            parsed = BuildDraftSchema.safeParse(value.input);
          if (parsed.success) {
            setInput({ ...empty, ...parsed.data });
            if (typeof value.selected === "string") setSelected(value.selected);
            if (
              value.questionAnswers &&
              typeof value.questionAnswers === "object"
            )
              setQuestionAnswers(
                Object.fromEntries(
                  Object.entries(value.questionAnswers)
                    .filter(
                      ([q, a]) =>
                        q.length <= 500 &&
                        typeof a === "string" &&
                        a.length <= 2000,
                    )
                    .slice(0, 6),
                ) as Record<string, string>,
              );
            setStatus(
              "Recovered your unfinished description from this browser.",
            );
          }
        }
      } catch {}
      recovered.current = true;
    });
  }, [storageKey]);
  useEffect(() => {
    if (recovered.current)
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ input, selected, questionAnswers }),
        );
      } catch {}
  }, [input, selected, questionAnswers, storageKey]);
  const record = data?.builds.find((b) => b.id === selected),
    result = record?.result;
  const permitted =
    enabled &&
    viewer.features?.ai !== false &&
    data?.settings.enabled &&
    (data.settings.audience === "owners" || viewer.isAdmin);
  async function run(mode: BuildRecord["mode"]) {
    const merged = {
      ...input,
      answers: [
        ...input.answers,
        ...Object.entries(questionAnswers)
          .filter(([, a]) => a.trim())
          .map(([question, answer]) => ({ question, answer })),
      ].slice(-12),
    };
    const parsed = BuildInputSchema.safeParse(merged);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setInput(merged);
    setQuestionAnswers({});
    setBusy(true);
    setError("");
    setStatus(
      mode === "interview"
        ? "Preparing follow-up questions…"
        : "Drafting and checking your workflow…",
    );
    try {
      const response = await designRequest<{ build: BuildRecord }>(
        "/api/workflows/build",
        {
          method: "POST",
          body: JSON.stringify({
            id: crypto.randomUUID(),
            mode,
            input: parsed.data,
          }),
        },
      );
      await load();
      setSelected(response.build.id);
      setStatus(
        response.build.status === "running"
          ? "This build is still running. Refresh its history shortly."
          : response.build.status === "ready"
            ? "Ready for your review."
            : "",
      );
      if (response.build.error) setError(response.build.error);
    } catch (e) {
      setError((e as Error).message);
      setStatus("");
      void load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    if (!record) return;
    setBusy(true);
    setError("");
    try {
      const response = await designRequest<{ draft: WorkflowDraft }>(
        `/api/workflows/build/${record.id}/accept`,
        { method: "POST" },
      );
      router.push(`/workflows?draft=${encodeURIComponent(response.draft.id)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 3 * 1024 * 1024)
        throw new Error("Choose a procedure file up to 3 MB.");
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/workflows/build/procedure", {
          method: "POST",
          body,
        }),
        response = await res.json();
      if (!res.ok)
        throw new Error(response.error ?? "Could not read this procedure.");
      setInput((v) => ({ ...v, procedure: response.text }));
      setStatus(
        "Procedure text is ready below. Review it before asking the AI.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings() {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      await designRequest("/api/admin/workflow-builder", {
        method: "PUT",
        body: JSON.stringify({
          action: "settings",
          enabled: config.enabled,
          audience: config.audience,
          monthlyCapZar: config.monthlyCapZar,
        }),
      });
      await load();
      setStatus("Pilot access and budget saved for this practice.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page workflow-page">
      <Link className="back-link" href="/workflows">
        ← Workflows
      </Link>
      <p className="eyebrow">Practice process</p>
      <h1 className="display-m">Build your workflow</h1>
      <p className="muted">
        Describe how you work. Review the draft, adjust it in the editor and
        publish when you are ready.
      </p>
      {!enabled && (
        <p role="status">Available to a signed-in practice owner.</p>
      )}
      {enabled && data && (
        <p className="workflow-budget">
          Builder spend this month: R{data.settings.spentZar.toFixed(2)} of R
          {data.settings.monthlyCapZar.toFixed(2)}. Model charges use reported
          usage or configured prices; a call can exceed its estimate. The cap
          stops further attempts.
        </p>
      )}
      {enabled && !permitted && data && (
        <p role="status">
          The platform Admin needs to enable the pilot for this practice and
          your account. Your draft history remains available.
        </p>
      )}
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <section
        className="card workflow-editor stack"
        style={{ padding: "1.25rem", gap: "1rem", marginTop: "1.5rem" }}
      >
        <h2 className="title">Your process</h2>
        {(
          [
            [
              "process",
              "Describe the phases and how work moves between them",
              12000,
            ],
            ["outputs", "What should each phase produce?", 4000],
            ["people", "Who contributes and who reviews or approves?", 4000],
            [
              "documents",
              "Which documents and selections do you work with?",
              4000,
            ],
            ["aiHelp", "Where would AI assistance save time?", 4000],
          ] as const
        ).map(([key, label, max]) => (
          <label className="field" key={key}>
            <span className="field-label">{label}</span>
            <textarea
              className="textarea"
              aria-label={label}
              value={input[key]}
              maxLength={max}
              rows={key === "process" ? 5 : 2}
              onChange={(e) =>
                setInput((v) => ({ ...v, [key]: e.target.value }))
              }
            />
          </label>
        ))}
        <details className="workflow-section">
          <summary>Add a procedure or checklist</summary>
          <p className="muted">
            TXT, Markdown, DOCX or a PDF with readable text, up to 3 MB and
            30,000 characters. Review the extracted text. Asking the AI sends
            your description and this text to the configured provider and saves
            the request privately for your practice. Unsupported capability
            descriptions are available to the platform Admin.
          </p>
          <label className="field">
            <span className="field-label">Choose procedure file</span>
            <input
              type="file"
              accept=".txt,.md,.docx,.pdf"
              disabled={!enabled || busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">Procedure text to review</span>
            <textarea
              className="textarea"
              aria-label="Procedure text to review"
              rows={8}
              maxLength={30000}
              value={input.procedure}
              onChange={(e) =>
                setInput((v) => ({ ...v, procedure: e.target.value }))
              }
            />
          </label>
        </details>
        {input.answers.length > 0 && (
          <details className="workflow-section">
            <summary>Previous answers ({input.answers.length})</summary>
            {input.answers.map((a, i) => (
              <p key={i}>
                <strong>{a.question}</strong>
                <br />
                {a.answer}
              </p>
            ))}
            <button
              className="btn"
              disabled={busy}
              onClick={() => setInput((v) => ({ ...v, answers: [] }))}
            >
              Clear previous answers
            </button>
          </details>
        )}
        {result?.questions.map((q) => (
          <label className="field" key={q}>
            <span className="field-label">{q}</span>
            <textarea
              className="textarea"
              aria-label={q}
              rows={2}
              maxLength={2000}
              value={questionAnswers[q] ?? ""}
              onChange={(e) =>
                setQuestionAnswers((v) => ({ ...v, [q]: e.target.value }))
              }
            />
          </label>
        ))}
        <div className="row wrap">
          <button
            className="btn"
            disabled={!permitted || busy}
            onClick={() => void run("interview")}
          >
            Ask follow-up questions
          </button>
          <button
            className="btn btn-primary"
            disabled={!permitted || busy}
            onClick={() => void run("generate")}
          >
            Generate draft
          </button>
        </div>
      </section>
      {record && (
        <section
          className="card stack"
          style={{ padding: "1.25rem", gap: "1rem", marginTop: "1.5rem" }}
        >
          <h2 className="title">
            {record.mode === "generate" ? "Draft preview" : "Interview"} · R
            {record.costZar.toFixed(2)}
          </h2>
          {record.status === "running" && (
            <p role="status">Building… Refresh history to check progress.</p>
          )}
          {record.error && (
            <p role="alert" className="workflow-error">
              {record.error}
            </p>
          )}
          {result?.notes && <p>{result.notes}</p>}
          {result && !result.reviewPassed && (
            <p role="alert">
              This draft passed structural checks but needs a closer review:{" "}
              {result.reviewFeedback || "The AI review did not pass."}
            </p>
          )}
          {result?.missingCapabilities.length ? (
            <div>
              <h3 className="title">Requests needing further development</h3>
              <ul>
                {result.missingCapabilities.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
              <p className="muted">
                Recorded for the platform Admin. These features are not part of
                the generated workflow.
              </p>
            </div>
          ) : null}
          {result?.workflow && (
            <>
              <h3 className="title">{result.workflow.name}</h3>
              <p>{result.workflow.description}</p>
              {result.workflow.phases.map((p, i) => (
                <section className="workflow-section" key={p.key}>
                  <h3 className="title">
                    {i + 1}. {p.name}
                  </h3>
                  <p>{p.description}</p>
                  <p className="muted">
                    {p.modules
                      .map((m) => MODULE_REGISTRY[m.split(":")[0]]?.name ?? m)
                      .join(" · ")}
                  </p>
                  <ul>
                    {p.checklist.map((c) => (
                      <li key={c.id}>
                        {c.text}
                        {c.essential ? " · required" : ""}
                      </li>
                    ))}
                  </ul>
                  {p.modules
                    .filter((m) => m.startsWith("structured_form:"))
                    .map((m) => {
                      const f = result.workflow!.forms.find(
                        (f) => f.key === m.split(":")[1],
                      );
                      return (
                        f && (
                          <div key={m}>
                            <h4>{result.workflow!.labels[f.key] ?? f.key}</h4>
                            {f.fields.map((field) => (
                              <label className="field" key={field.key}>
                                <span className="field-label">
                                  {field.label}
                                </span>
                                <textarea
                                  className="textarea"
                                  readOnly
                                  placeholder="Example project field"
                                  rows={2}
                                />
                              </label>
                            ))}
                          </div>
                        )
                      );
                    })}
                </section>
              ))}
              <p className="muted">
                This preview does not save a project. Essential checklist steps
                gate completion; approval decisions remain explicit steps for
                your team.
              </p>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void accept()}
              >
                {record.acceptedWorkflowId
                  ? "Return to draft in editor"
                  : "Open in editor"}
              </button>
            </>
          )}
        </section>
      )}
      <section
        className="card stack"
        style={{ padding: "1.25rem", gap: "1rem", marginTop: "1.5rem" }}
      >
        <div className="row wrap">
          <h2 className="title grow">Saved build history</h2>
          <button
            className="btn"
            disabled={!enabled || busy}
            onClick={() =>
              void load().catch((e) => setError((e as Error).message))
            }
          >
            Refresh history
          </button>
        </div>
        {data?.builds.map((b) => (
          <button
            className="btn workflow-draft-choice"
            aria-pressed={b.id === selected}
            key={b.id}
            onClick={() => {
              setSelected(b.id);
              setQuestionAnswers({});
            }}
          >
            <strong>
              {b.result?.workflow?.name ??
                (b.mode === "interview"
                  ? "Process interview"
                  : "Workflow draft")}
            </strong>
            <span className="muted">
              {new Date(b.createdAt).toLocaleString()} · {b.status} · R
              {b.costZar.toFixed(2)}
            </span>
          </button>
        ))}
        {record && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => {
              setInput(record.input);
              setQuestionAnswers({});
              setStatus("Restored this build's description for a new request.");
            }}
          >
            Use selected description
          </button>
        )}
      </section>
      {viewer.isAdmin && config && (
        <BuilderAdminControls
          admin={admin}
          config={config}
          setConfig={setConfig}
          busy={busy}
          saveSettings={saveSettings}
          load={load}
          setBusy={setBusy}
          setError={setError}
        />
      )}
    </main>
  );
}

export function BuilderAdminControls({
  admin,
  config,
  setConfig,
  busy,
  saveSettings,
  load,
  setBusy,
  setError,
}: {
  admin: AdminState | null;
  config: BuilderSettings;
  setConfig: (v: BuilderSettings) => void;
  busy: boolean;
  saveSettings: () => Promise<void>;
  load: () => Promise<void>;
  setBusy: (v: boolean) => void;
  setError: (v: string) => void;
}) {
  return (
    <details className="workflow-section" style={{ marginTop: "1.5rem" }}>
      <summary>Admin pilot controls and quality</summary>
      <div className="stack" style={{ gap: "1rem" }}>
        <label className="row">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) =>
              setConfig({ ...config, enabled: e.target.checked })
            }
          />{" "}
          Enable for this practice
        </label>
        <label className="field">
          <span className="field-label">Pilot audience</span>
          <select
            className="input"
              aria-label="Pilot audience"
            value={config.audience}
            onChange={(e) =>
              setConfig({
                ...config,
                audience: e.target.value as "admin" | "owners",
              })
            }
          >
            <option value="admin">Platform Admin owners only</option>
            <option value="owners">Practice owners</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Monthly builder cap in rand</span>
          <input
            className="input"
              aria-label="Monthly builder cap in rand"
            type="number"
            min={0}
            max={10000}
            step="0.01"
            value={config.monthlyCapZar}
            onChange={(e) =>
              setConfig({
                ...config,
                monthlyCapZar: Number(e.target.value),
              })
            }
          />
        </label>
        <button
          className="btn"
          disabled={busy}
          onClick={() => void saveSettings()}
        >
          Save pilot settings
        </button>
        <h3 className="title">Capability backlog across practices</h3>
        {admin?.backlog.map((c) => (
          <div className="workflow-section" key={c.id}>
            <p>{c.capability}</p>
            <p className="muted">
              {c.workspace_name}
              {c.workflow_name ? ` · ${c.workflow_name}` : ""}
            </p>
            <label className="field">
              <span className="field-label">Capability status</span>
              <select
                className="input"
                  aria-label="Capability status"
                value={c.status}
                disabled={busy}
                onChange={async (e) => {
                  setBusy(true);
                  try {
                    await designRequest("/api/admin/workflow-builder", {
                      method: "PUT",
                      body: JSON.stringify({
                        action: "capability",
                        id: c.id,
                        status: e.target.value,
                      }),
                    });
                    await load();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {["open", "planned", "delivered", "dismissed"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
        ))}
        <h3 className="title">Changes before first publication</h3>
        {admin?.metrics.map((m) => (
          <div className="workflow-section" key={m.id}>
            <strong>{m.name}</strong>
            <p>
              {Object.entries(m.summary)
                .map(
                  ([key, value]) =>
                    `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${typeof value === "boolean" ? (value ? "yes" : "no") : value}`,
                )
                .join(" · ")}
            </p>
          </div>
        ))}
        {!admin?.metrics.length && (
          <p className="muted">
            Edit summaries appear after a generated draft is first published.
          </p>
        )}
      </div>
    </details>
  );
}
