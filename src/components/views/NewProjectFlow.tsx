"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Layers, CornerDownLeft } from "lucide-react";
import { useTemplates } from "@/components/templates/useTemplates";
import { useStudio } from "@/components/providers/StudioProvider";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { SWATCHES, Swatch } from "@/components/ui/primitives";
import { listWorkflows, DEFAULT_WORKFLOW_ID, getWorkflow } from "@/lib/workflow";
import type { SwatchKey } from "@/lib/studio/types";

const STEPS = ["name", "client", "workflow", "details", "review"] as const;

function todayInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export function NewProjectFlow() {
  const router = useRouter();
  const { createProject, toast } = useStudio();
  const library = useTemplates();
  const [templateId, setTemplateId] = useState("");
  const template = library.templates.find(t => t.id === templateId);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [workflowId, setWorkflowId] = useState(DEFAULT_WORKFLOW_ID);
  const [startDate, setStartDate] = useState(todayInput);
  const [swatch, setSwatch] = useState<SwatchKey>("clay");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = STEPS[step];
  const canContinue =
    (current === "name" && name.trim().length > 1) ||
    (current === "client" && client.trim().length > 1) ||
    current === "workflow" ||
    (current === "details" && !!startDate) ||
    current === "review";

  useEffect(() => {
    inputRef.current?.focus();
  }, [step]);

  const next = async () => {
    if (!canContinue || creating) return;
    if (current === "review") {
      setCreating(true);
      const id = await createProject({
        name: name.trim(),
        client: client.trim(),
        workflowId,
        ...(templateId ? { templateId } : {}),
        swatch,
        startDate: new Date(startDate).toISOString(),
      });
      if (!id) {
        setCreating(false);
        return;
      }
      toast(`${name.trim()} is ready`);
      router.push(`/projects/${id}`);
      return;
    }
    setStep((s) => s + 1);
  };
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Enter continues on every step, not only the ones with a text field.
  // Text fields already submit the form; choice and colour buttons pick
  // themselves and then continue, so Enter after a click moves on.
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  });
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select, a, [contenteditable='true']")) return;
      const button = target?.closest("button");
      if (button && !formRef.current?.contains(button)) return;
      e.preventDefault();
      if (button && !button.disabled) button.click();
      void nextRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const workflow = getWorkflow({ workflowId, workflowVersion: template?.workflowVersion });

  return (
    <FocusFrame
      exitHref="/projects"
      exitLabel="Cancel new project"
      title="New project"
      right={<span className="tiny muted tabular">{step + 1} / {STEPS.length}</span>}
      progress={(step + 1) / STEPS.length}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={back} style={{ visibility: step ? "visible" : "hidden" }}>
            <ArrowLeft size={16} /> Back
          </button>
          <div className="row">
            <span className="tiny muted row hide-sm" style={{ gap: "0.35rem" }}>
              press <span className="kbd"><CornerDownLeft size={11} /></span>
            </span>
            <button type="button" className={`btn btn-lg ${current === "review" ? "btn-accent" : "btn-primary"}`} disabled={!canContinue || creating} onClick={next}>
              {current === "review" ? "Create project" : "Continue"}
              {current === "review" ? <Check size={18} /> : <ArrowRight size={18} />}
            </button>
          </div>
        </>
      }
    >
      <form
        ref={formRef}
        key={current}
        className="rise"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {current === "name" && (
          <Question eyebrow="Let's set it up" title="What's the project called?" hint="Use the name you'd say out loud, like the building or the floor.">
            <input ref={inputRef} className="input-hero" placeholder="e.g. Waterfront HQ, Level 3" value={name} onChange={(e) => setName(e.target.value)} />
          </Question>
        )}

        {current === "client" && (
          <Question eyebrow={name} title="Who is the client?" hint="Shared pages show this name, not ours.">
            <input ref={inputRef} className="input-hero" placeholder="Company or person" value={client} onChange={(e) => setClient(e.target.value)} />
          </Question>
        )}

        {current === "workflow" && (
          <Question eyebrow={name} title="Which process will it follow?" hint="Phases, steps and AI help come from the workflow. You can't switch once it starts.">
            <div className="stack" style={{ gap: "0.75rem" }}>
              {listWorkflows().map((wf) => (
                <button key={wf.id} type="button" className="choice" aria-pressed={workflowId === wf.id} onClick={() => { setWorkflowId(wf.id); setTemplateId(""); }}>
                  <span className="fact-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    <Layers size={17} />
                  </span>
                  <span className="stack grow" style={{ gap: "0.2rem" }}>
                    <span className="strong">{wf.name}</span>
                    <span className="small muted">{wf.phases.length} phases · {wf.phases.map((p) => p.name).join(", ")}</span>
                  </span>
                  {workflowId === wf.id && <Check size={18} />}
                </button>
              ))}
              <button type="button" className="choice" disabled>
                <span className="fact-icon"><Layers size={17} /></span>
                <span className="stack grow" style={{ gap: "0.2rem" }}>
                  <span className="strong">UX design</span>
                  <span className="small muted">Coming after interior design</span>
                </span>
              </button>
            </div>
            {library.allowed && (
              <div className="stack" style={{ marginTop: "1.5rem", gap: ".75rem" }}>
                <label className="field">
                  <span className="field-label">Start from a practice setup</span>
                  <select className="input" aria-label="Start from a practice setup"
                    value={templateId} onChange={e => {
                      setTemplateId(e.target.value);
                      const chosen = library.templates.find(t => t.id === e.target.value);
                      if (chosen) setWorkflowId(chosen.workflowId);
                    }}>
                    <option value="">Blank project</option>
                    {library.templates.filter(t => t.workflowId === workflowId).map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </label>
                {template && (
                  <p className="small muted">
                    {template.itemCount} schedule selections and {template.requirementCount} unchecked requirements.
                    No client files, prices or evidence are copied.
                  </p>
                )}
                {library.error && (
                  <div role="alert">
                    <p className="design-error">{library.error}</p>
                    <button type="button" className="btn btn-secondary" onClick={() => void library.reload()}>
                      Retry setups
                    </button>
                  </div>
                )}
              </div>
            )}
          </Question>
        )}

        {current === "details" && (
          <Question eyebrow={name} title="When does it kick off?" hint="Step due dates count from this day.">
            <input ref={inputRef} type="date" className="input-hero" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ maxWidth: 360 }} />
            <p className="eyebrow" style={{ margin: "2.75rem 0 1rem" }}>Pick a colour to spot it at a glance</p>
            <div className="swatch-pick" role="radiogroup">
              {SWATCHES.map((s) => (
                <button key={s.key} type="button" aria-pressed={swatch === s.key} onClick={() => setSwatch(s.key)}>
                  <Swatch swatch={s.key} size="lg" />
                  {s.name}
                </button>
              ))}
            </div>
          </Question>
        )}

        {current === "review" && (
          <Question eyebrow="Ready when you are" title={<>{name}<br /><em>for {client}</em></>}>
            {template && (
              <p className="small muted" style={{ marginBottom: "1rem" }}>
                Setup: {template.name} · {template.itemCount} selections · {template.requirementCount} unchecked requirements
              </p>
            )}
            <div className="card" style={{ padding: "0.5rem 0" }}>
              {workflow.phases.map((ph, i) => (
                <div key={ph.key} className="row" style={{ padding: "0.75rem 1.25rem", gap: "1rem" }}>
                  <span className="journey-marker" style={i === 0 ? { background: "var(--accent-fill)", color: "var(--accent-fill-ink)", boxShadow: "none" } : undefined}>
                    {i + 1}
                  </span>
                  <span className="stack grow">
                    <span className="small strong">{ph.name}</span>
                    <span className="tiny muted">{ph.checklist.length} steps{i === 0 ? " · starts today" : ""}</span>
                  </span>
                </div>
              ))}
            </div>
          </Question>
        )}
        <button type="submit" hidden />
      </form>
    </FocusFrame>
  );
}

function Question({
  eyebrow,
  title,
  hint,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="eyebrow truncate" style={{ marginBottom: "1rem" }}>{eyebrow}</p>
      <h1 className="display-l" style={{ marginBottom: hint ? "0.75rem" : "2.25rem" }}>{title}</h1>
      {hint && <p className="muted" style={{ marginBottom: "2.5rem" }}>{hint}</p>}
      {children}
    </div>
  );
}
