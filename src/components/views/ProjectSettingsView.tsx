"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Lock, Plus, Trash2, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { SWATCHES, Swatch, WhenReady, swatchVar } from "@/components/ui/primitives";
import { RulesView } from "@/components/layout/RulesView";
import { moduleTarget } from "@/components/modules/moduleTarget";
import { MissingProject } from "./MissingProject";
import { baseWorkflow, getWorkflow, usesModule } from "@/lib/workflow";
import { newPhaseKey, newStepId, workflowOutline, type OutlinePhase, type OutlineStep, type WorkflowChange } from "@/lib/workflow/custom";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { phaseState } from "@/lib/studio/selectors";
import { addDays, daysBetween } from "@/lib/studio/timeline";
import { toDay } from "@/lib/studio/tasks";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";
import type { Project } from "@/lib/studio/types";

/** A compact select or date box beside chips. */
const SMALL_CONTROL: React.CSSProperties = { width: "auto", maxWidth: "100%", height: 34, padding: "0 2rem 0 0.75rem", fontSize: "0.85rem", lineHeight: "34px" };

type Tab = "details" | "workflow" | "rules";
const TABS = ["details", "workflow", "rules"] as const;
const isTab = oneOf(TABS);

export function ProjectSettingsView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  return (
    <main className="page">
      <WhenReady ready={ready}>{project ? <ProjectSettings project={project} /> : <MissingProject />}</WhenReady>
    </main>
  );
}

function ProjectSettings({ project }: { project: Project }) {
  const params = useSearchParams();
  const { viewer } = useStudio();
  const showRules =
    usesModule(project, "layout_generator") && viewer.features?.layout !== false && viewer.features?.floor_plan !== false;
  // The tab last used is remembered; a link can ask for one, which then becomes the remembered one.
  const [tab, setTab] = useViewSetting<Tab>("projectSettings.tab", "details", isTab);
  const asked = params.get("tab");
  const [picked, setPicked] = useState(false);
  const current: Tab = !picked && isTab(asked) ? asked : tab;
  useEffect(() => {
    if (isTab(asked)) setTab(asked);
  }, [asked, setTab]);
  const shown: Tab = current === "rules" && !showRules ? "details" : current;

  // A link to one phase (#phase-key) scrolls to it once the workflow tab is showing.
  useEffect(() => {
    if (shown !== "workflow" || !window.location.hash) return;
    const el = document.getElementById(window.location.hash.slice(1));
    el?.scrollIntoView({ block: "start" });
  }, [shown]);

  if (viewer.workspaceRole === "collaborator" || viewer.workspaceRole === "client") {
    return (
      <div>
        <Link href={`/projects/${project.id}`} className="back-link rise" style={{ marginBottom: "2rem" }}>
          <ArrowLeft size={15} /> {project.name}
        </Link>
        <p className="muted">Only the studio&apos;s own people can change this project&apos;s settings.</p>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "workflow", label: "Phases and steps" },
    ...(showRules ? [{ key: "rules" as Tab, label: "Layout rules" }] : []),
  ];

  return (
    <div style={swatchVar(project.swatch)}>
      <Link href={`/projects/${project.id}`} className="back-link rise" style={{ marginBottom: "2rem" }}>
        <ArrowLeft size={15} /> {project.name}
      </Link>
      <header className="rise" style={{ ["--i" as string]: 1, marginBottom: "1.75rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Project settings</p>
        <h1 className="display-l">{project.name}</h1>
      </header>
      <div className="segmented rise" role="group" aria-label="Project settings" style={{ marginBottom: "2rem" }}>
        {tabs.map((t) => (
          <button key={t.key} type="button" aria-pressed={shown === t.key} onClick={() => {
            setPicked(true);
            setTab(t.key);
          }}>
            {t.label}
          </button>
        ))}
      </div>
      {shown === "details" && <DetailsTab project={project} />}
      {shown === "workflow" && <WorkflowTab project={project} />}
      {shown === "rules" && <RulesView embedded />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

/** A text box that saves when it loses focus or Enter is pressed, and only when the text changed. */
function SaveOnBlur({
  value,
  onSave,
  className = "input",
  placeholder,
  ariaLabel,
  multiline,
  allowEmpty,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  multiline?: boolean;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value);
  const [was, setWas] = useState(value);
  // A change saved elsewhere replaces what is shown.
  if (value !== was) {
    setWas(value);
    setText(value);
  }
  const commit = () => {
    const t = text.trim();
    if (t === value.trim()) return;
    if (!t && !allowEmpty) {
      setText(value);
      return;
    }
    onSave(t);
  };
  const common = {
    className,
    value: text,
    placeholder,
    "aria-label": ariaLabel,
    onBlur: commit,
  };
  return multiline ? (
    <textarea {...common} rows={2} onChange={(e) => setText(e.target.value)} />
  ) : (
    <input
      {...common}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function DetailsTab({ project }: { project: Project }) {
  const { updateDetails, setStatus, deleteProject, toast, viewer } = useStudio();
  // Holding and deleting a project are the owner's (the same as archiving on the server).
  const isOwner = !viewer.workspaceRole || viewer.workspaceRole === "owner";
  const router = useRouter();
  const workflow = baseWorkflow(project);
  const [confirm, setConfirm] = useState("");
  const save = (patch: Parameters<typeof updateDetails>[1]) => {
    updateDetails(project.id, patch).then((ok) => ok && toast("Saved"));
  };

  return (
    <div className="stack rise" style={{ gap: "2rem", maxWidth: 640 }}>
      <div className="card stack" style={{ padding: "1.5rem", gap: "1.25rem" }}>
        <label className="field">
          <span className="field-label">Project name</span>
          <SaveOnBlur value={project.name} onSave={(name) => save({ name })} />
        </label>
        <label className="field">
          <span className="field-label">Client</span>
          <SaveOnBlur value={project.client} onSave={(client) => save({ client })} />
        </label>
        <label className="field" style={{ maxWidth: 260 }}>
          <span className="field-label">Start date</span>
          <input
            className="input"
            type="date"
            value={toDay(project.startDate)}
            onChange={(e) => e.target.value && save({ startDate: new Date(`${e.target.value}T00:00:00`).toISOString() })}
          />
          <span className="tiny muted">Step due dates count from this day.</span>
        </label>
        <div className="field">
          <span className="field-label">Colour</span>
          <div className="swatch-pick" role="radiogroup" aria-label="Colour">
            {SWATCHES.map((s) => (
              <button key={s.key} type="button" aria-pressed={project.swatch === s.key} onClick={() => save({ swatch: s.key })}>
                <Swatch swatch={s.key} size="lg" />
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card stack" style={{ padding: "1.5rem", gap: "1rem" }}>
        <div className="row-between wrap" style={{ gap: "1rem" }}>
          <div className="stack" style={{ gap: "0.2rem" }}>
            <span className="small strong">Process</span>
            <span className="tiny muted">
              {workflow.name}, version {workflow.version}. Change its phases and steps under Phases and steps.
            </span>
          </div>
        </div>
        {isOwner && project.status !== "complete" && (
          <div className="row-between wrap" style={{ gap: "1rem" }}>
            <div className="stack" style={{ gap: "0.2rem" }}>
              <span className="small strong">On hold</span>
              <span className="tiny muted">A project on hold leaves the Today screen and the due list until it resumes.</span>
            </div>
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={project.status === "on_hold"}
              aria-label="On hold"
              onClick={() => setStatus(project.id, project.status === "on_hold" ? "active" : "on_hold")}
            />
          </div>
        )}
      </div>

      {isOwner && (
      <div className="card stack" style={{ padding: "1.5rem", gap: "0.85rem", borderColor: "var(--bad)" }}>
        <span className="small strong">Delete this project</span>
        <span className="tiny muted">
          Deletes the project with its documents, tasks, plans and AI history. This can&apos;t be undone here. Type the project&apos;s name to confirm.
        </span>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          <input
            className="input grow"
            style={{ minWidth: 200 }}
            placeholder={project.name}
            aria-label="Project name to confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={confirm.trim() !== project.name.trim()}
            onClick={async () => {
              const name = project.name;
              router.push("/projects");
              if (await deleteProject(project.id)) toast(`${name} was deleted`);
            }}
          >
            <Trash2 size={15} /> Delete project
          </button>
        </div>
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phases and steps
// ---------------------------------------------------------------------------

/** Modules a phase or step can take, with "structured_form" offered once per form of the workflow. */
function moduleChoices(project: Project): { ref: string; name: string; planned: boolean }[] {
  const forms = baseWorkflow(project).forms;
  const out: { ref: string; name: string; planned: boolean }[] = [];
  for (const mod of Object.values(MODULE_REGISTRY)) {
    if (mod.type === "platform" || mod.key === "search" || mod.key === "ai_chat") continue;
    if (mod.key === "structured_form") {
      for (const f of forms) out.push({ ref: `structured_form:${f.key}`, name: moduleTarget(project, `structured_form:${f.key}`).title, planned: false });
      continue;
    }
    out.push({ ref: mod.key, name: mod.name, planned: mod.status === "planned" });
  }
  return out;
}

function WorkflowTab({ project }: { project: Project }) {
  const { customizeWorkflow, toast } = useStudio();
  const base = baseWorkflow(project);
  const outline = useMemo(() => workflowOutline(base, project.workflowCustom), [base, project.workflowCustom]);
  const running = getWorkflow(project).phases.map((p) => p.key);
  const lockedUntil = running.indexOf(project.currentPhase);
  const locked = (key: string) => {
    const i = running.indexOf(key);
    return project.status === "complete" || (i >= 0 && i <= lockedUntil);
  };
  const choices = useMemo(() => moduleChoices(project), [project]);

  const change = (c: WorkflowChange, done?: string) =>
    customizeWorkflow(project.id, c).then((err) => {
      if (err) toast(err);
      else if (done) toast(done);
      return !err;
    });

  return (
    <div className="stack rise" style={{ gap: "1.25rem" }}>
      <p className="muted" style={{ maxWidth: 680 }}>
        The phases and steps that come with {base.name} can be switched off and renamed, not removed. Phases and steps you add are
        yours to change or remove. Each phase shows its steps when it has the Steps module; without it, it shows tool cards only.
        Phases that are open or complete keep their place.
      </p>
      {outline.map((p, i) => (
        <PhaseCard
          key={p.phase.key}
          project={project}
          entry={p}
          index={i}
          count={outline.length}
          previousKey={i > 1 ? outline[i - 2].phase.key : null}
          nextKey={outline[i + 1]?.phase.key}
          locked={locked(p.phase.key)}
          aboveLocked={!!outline[i - 1] && locked(outline[i - 1].phase.key)}
          choices={choices}
          change={change}
        />
      ))}
      <AddPhase outline={outline} change={change} />
    </div>
  );
}

function PhaseCard({
  project,
  entry,
  index,
  count,
  previousKey,
  nextKey,
  locked,
  aboveLocked,
  choices,
  change,
}: {
  project: Project;
  entry: OutlinePhase;
  index: number;
  count: number;
  /** The phase two up, which this one follows after moving up (null: it becomes first). */
  previousKey: string | null;
  nextKey?: string;
  locked: boolean;
  /** The phase above is open or complete, so this one can't move above it. */
  aboveLocked: boolean;
  choices: { ref: string; name: string; planned: boolean }[];
  change: (c: WorkflowChange, done?: string) => Promise<boolean>;
}) {
  const { phase, fromDefinition, enabled, steps } = entry;
  const state = enabled ? phaseState(project, phase.key) : null;
  const [newStep, setNewStep] = useState("");
  const hasSteps = phase.modules.includes("checklist");
  const unused = choices.filter((c) => !phase.modules.includes(c.ref));

  const addStep = async () => {
    const text = newStep.trim();
    if (!text) return;
    if (await change({ type: "addStep", id: newStepId(), phaseKey: phase.key, text })) setNewStep("");
  };

  return (
    <section id={`phase-${phase.key}`} className="card" style={{ padding: "1.25rem 1.25rem 1rem", opacity: enabled ? 1 : 0.62, scrollMarginTop: "5rem" }}>
      <div className="row" style={{ gap: "0.75rem", alignItems: "flex-start" }}>
        <span className="journey-marker" style={{ flexShrink: 0 }}>{index + 1}</span>
        <div className="stack grow" style={{ gap: "0.5rem", minWidth: 0 }}>
          <div className="row wrap" style={{ gap: "0.5rem" }}>
            <SaveOnBlur
              className="input strong grow"
              ariaLabel="Phase name"
              value={phase.name}
              onSave={(name) => change({ type: "updatePhase", phaseKey: phase.key, name })}
            />
          </div>
          <span className="tiny muted row wrap" style={{ gap: "0.4rem" }}>
            {fromDefinition ? "Comes with the process" : "Added for this project"}
            {state === "complete" && <span className="tag tag-good" style={{ height: 20 }}>Complete</span>}
            {state === "current" && <span className="tag tag-me" style={{ height: 20 }}>In progress</span>}
            {!enabled && <span className="tag" style={{ height: 20 }}>Switched off</span>}
            {locked && <span className="row" style={{ gap: "0.2rem" }}><Lock size={11} /> keeps its place</span>}
          </span>
        </div>
        <div className="row" style={{ gap: "0.15rem", flexShrink: 0 }}>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Move ${phase.name} up`}
            title="Move up"
            disabled={index === 0 || locked || aboveLocked}
            onClick={() => change({ type: "movePhase", phaseKey: phase.key, after: previousKey })}
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Move ${phase.name} down`}
            title="Move down"
            disabled={index === count - 1 || locked || !nextKey}
            onClick={() => nextKey && change({ type: "movePhase", phaseKey: phase.key, after: nextKey })}
          >
            <ArrowDown size={16} />
          </button>
          {fromDefinition ? (
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={enabled}
              aria-label={`${phase.name} switched ${enabled ? "on" : "off"}`}
              title={locked ? "Open and complete phases stay on" : enabled ? "Switch off" : "Switch on"}
              disabled={locked && enabled}
              style={{ marginLeft: "0.35rem", alignSelf: "center" }}
              onClick={() => change({ type: "setPhaseEnabled", phaseKey: phase.key, enabled: !enabled })}
            />
          ) : (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${phase.name}`}
              title={locked ? "Open and complete phases can't be removed" : "Remove phase"}
              disabled={locked}
              onClick={() => {
                if (window.confirm(`Remove "${phase.name}" and its steps?`)) {
                  void change({ type: "removePhase", phaseKey: phase.key }, `${phase.name} removed`);
                }
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {enabled && (
        <div className="stack" style={{ gap: "1rem", marginTop: "1rem", paddingLeft: "clamp(0px, 3vw, calc(32px + 0.75rem))" }}>
          <SaveOnBlur
            multiline
            allowEmpty
            className="textarea small"
            ariaLabel="Phase description"
            placeholder="What happens in this phase"
            value={phase.description}
            onSave={(description) => change({ type: "updatePhase", phaseKey: phase.key, description })}
          />

          <div className="stack" style={{ gap: "0.45rem" }}>
            <span className="field-label">Modules</span>
            <div className="row wrap" style={{ gap: "0.4rem" }}>
              {phase.modules.map((ref) => (
                <span key={ref} className="chip" style={{ gap: "0.35rem" }}>
                  {moduleTarget(project, ref).title}
                  <button
                    type="button"
                    aria-label={`Take ${moduleTarget(project, ref).title} off ${phase.name}`}
                    disabled={phase.modules.length === 1}
                    onClick={() => change({ type: "updatePhase", phaseKey: phase.key, modules: phase.modules.filter((m) => m !== ref) })}
                    style={{ display: "inline-flex", opacity: phase.modules.length === 1 ? 0.3 : 0.7 }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {unused.length > 0 && (
                <select
                  className="input"
                  style={SMALL_CONTROL}
                  aria-label={`Add a module to ${phase.name}`}
                  value=""
                  onChange={(e) =>
                    e.target.value && change({ type: "updatePhase", phaseKey: phase.key, modules: [...phase.modules, e.target.value] })
                  }
                >
                  <option value="">Add a module…</option>
                  {unused.map((c) => (
                    <option key={c.ref} value={c.ref}>
                      {c.name}{c.planned ? " (coming later)" : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {(hasSteps || steps.length > 0) && (
            <div className="stack" style={{ gap: "0.45rem" }}>
              <span className="field-label">
                Steps{!hasSteps && " (hidden until the Steps module is added)"}
              </span>
              <div className="card checklist" role="list" style={{ boxShadow: "none" }}>
                {steps.map((s, i) => (
                  <StepEditor
                    key={s.item.id}
                    project={project}
                    step={s}
                    previousId={i > 1 ? steps[i - 2].item.id : null}
                    nextId={steps[i + 1]?.item.id}
                    first={i === 0}
                    choices={choices}
                    change={change}
                  />
                ))}
                <div className="row" style={{ gap: "0.5rem", padding: "0.65rem 0.85rem" }}>
                  <Plus size={15} color="var(--ink-3)" />
                  <input
                    className="input grow"
                    style={{ border: "none", background: "transparent", paddingLeft: 0 }}
                    placeholder="Add a step"
                    aria-label={`Add a step to ${phase.name}`}
                    value={newStep}
                    onChange={(e) => setNewStep(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void addStep();
                      }
                    }}
                  />
                  {newStep.trim() && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void addStep()}>
                      Add
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StepEditor({
  project,
  step,
  previousId,
  nextId,
  first,
  choices,
  change,
}: {
  project: Project;
  step: OutlineStep;
  previousId: string | null;
  nextId?: string;
  first: boolean;
  choices: { ref: string; name: string; planned: boolean }[];
  change: (c: WorkflowChange, done?: string) => Promise<boolean>;
}) {
  const { item, fromDefinition, enabled } = step;
  const start = toDay(project.startDate);
  const due = item.relativeDaysDue != null ? addDays(start, item.relativeDaysDue) : "";
  const stepModules = item.modules ?? [];
  const unused = choices.filter((c) => c.ref !== "checklist" && !stepModules.includes(c.ref));

  return (
    <div role="listitem" className="stack" style={{ gap: "0.5rem", padding: "0.75rem 0.85rem", borderBottom: "1px solid var(--line)", opacity: enabled ? 1 : 0.55 }}>
      <SaveOnBlur
        className="input"
        ariaLabel="Step"
        value={item.text}
        onSave={(text) => change({ type: "updateStep", itemId: item.id, text })}
      />
      <div className="row wrap" style={{ gap: "0.5rem" }}>
        {enabled && (
        <>
          <button
            type="button"
            className="chip"
            aria-pressed={item.essential}
            title="Essential steps must be ticked before the phase can be completed"
            onClick={() => change({ type: "updateStep", itemId: item.id, essential: !item.essential })}
          >
            {item.essential ? "Essential" : "Optional"}
          </button>
          <input
            className="input"
            type="date"
            style={SMALL_CONTROL}
            aria-label={`Due date for "${item.text}"`}
            min={start}
            value={due}
            onChange={(e) =>
              change({
                type: "updateStep",
                itemId: item.id,
                relativeDaysDue: e.target.value ? Math.max(0, daysBetween(start, e.target.value)) : null,
              })
            }
          />
          {stepModules.map((ref) => (
            <span key={ref} className="chip" style={{ gap: "0.35rem" }}>
              {moduleTarget(project, ref).title}
              <button
                type="button"
                aria-label={`Take ${moduleTarget(project, ref).title} off this step`}
                onClick={() => change({ type: "updateStep", itemId: item.id, modules: stepModules.filter((m) => m !== ref) })}
                style={{ display: "inline-flex", opacity: 0.7 }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {unused.length > 0 && (
            <select
              className="input"
              style={SMALL_CONTROL}
              aria-label={`Link a module to "${item.text}"`}
              value=""
              onChange={(e) => e.target.value && change({ type: "updateStep", itemId: item.id, modules: [...stepModules, e.target.value] })}
            >
              <option value="">Link a module…</option>
              {unused.map((c) => (
                <option key={c.ref} value={c.ref}>
                  {c.name}{c.planned ? " (coming later)" : ""}
                </option>
              ))}
            </select>
          )}
        </>
        )}
        <span className="row" style={{ gap: "0.15rem", marginLeft: "auto" }}>
        <button
            type="button"
            className="icon-btn"
            aria-label={`Move "${item.text}" up`}
            disabled={first}
            onClick={() => change({ type: "moveStep", itemId: item.id, after: previousId })}
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Move "${item.text}" down`}
            disabled={!nextId}
            onClick={() => nextId && change({ type: "moveStep", itemId: item.id, after: nextId })}
          >
            <ArrowDown size={15} />
          </button>
          {fromDefinition ? (
            <button
              type="button"
              className="switch"
              role="switch"
              aria-checked={enabled}
              aria-label={`"${item.text}" switched ${enabled ? "on" : "off"}`}
              onClick={() => change({ type: "setStepEnabled", itemId: item.id, enabled: !enabled })}
            />
          ) : (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove "${item.text}"`}
              onClick={() => change({ type: "removeStep", itemId: item.id })}
            >
              <Trash2 size={15} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function AddPhase({ outline, change }: { outline: OutlinePhase[]; change: (c: WorkflowChange, done?: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"steps" | "tools">("steps");
  const [after, setAfter] = useState<string>("");
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const ok = await change(
      {
        type: "addPhase",
        key: newPhaseKey(),
        name: n,
        modules: kind === "steps" ? ["checklist"] : ["documents"],
        ...(after ? { after } : {}),
      },
      `${n} added`
    );
    if (ok) setName("");
  };
  return (
    <section className="card stack" style={{ padding: "1.25rem", gap: "0.85rem", borderStyle: "dashed" }}>
      <span className="small strong">Add a phase</span>
      <div className="row wrap" style={{ gap: "0.6rem" }}>
        <input
          className="input grow"
          style={{ minWidth: 200 }}
          placeholder="Phase name, e.g. Site measure"
          aria-label="New phase name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void add()}
        />
        <div className="segmented" role="group" aria-label="What the phase holds">
          <button type="button" aria-pressed={kind === "steps"} onClick={() => setKind("steps")}>Steps</button>
          <button type="button" aria-pressed={kind === "tools"} onClick={() => setKind("tools")}>Tools only</button>
        </div>
        <select className="input" style={{ width: "auto" }} aria-label="Where it goes" value={after} onChange={(e) => setAfter(e.target.value)}>
          <option value="">At the end</option>
          {outline.map((p) => (
            <option key={p.phase.key} value={p.phase.key}>After {p.phase.name}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void add()}>
          <Plus size={16} /> Add phase
        </button>
      </div>
      <span className="tiny muted">
        A steps phase starts with a checklist you fill in. A tools-only phase is a set of tool cards, for work that is done with tools
        rather than ticked off. Either can take any module afterwards.
      </span>
    </section>
  );
}
