"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bot, ChevronDown, Pause, Play, Wrench, X, Zap } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { ProjectNavigation } from "@/components/projects/ProjectNavigation";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "@/components/views/MissingProject";
import { relativeTime } from "@/lib/studio/format";
import { CADENCE_LABELS, CADENCES, LEVEL_LABELS, LEVELS, phaseLevel, type AutopilotLevels, type Cadence, type Level } from "@/lib/autopilot/model";
import type { AutopilotPatch } from "@/lib/autopilot/store";
import type { Project } from "@/lib/studio/types";
import { getWorkflow } from "@/lib/workflow";
import { AskCard } from "./InboxView";
import { runNow, saveAutopilotSettings, useProjectAutopilot, type ProjectAutopilot, type RunEnd, type RunProgress } from "./useAutopilot";
import "./autopilot.css";

/** Run now, shared by the card and the page: streams what it does and refreshes when it ends. */
function useRunNow(project: Project, refresh: () => void) {
  const { receiveProject, toast } = useStudio();
  const [progress, setProgress] = React.useState<RunProgress | null>(null);
  const [end, setEnd] = React.useState<RunEnd | null>(null);
  const start = async () => {
    setEnd(null);
    setProgress({ steps: [], text: "" });
    const result = await runNow(project.id, setProgress, receiveProject);
    setEnd(result);
    setProgress(null);
    if (result.status === "error") toast(result.reason);
    refresh();
  };
  return { progress, end, start, running: !!progress };
}

function stateOf(data: ProjectAutopilot | undefined, running: boolean) {
  if (!data) return { key: "off", text: "Off" };
  if (running || data.state.running) return { key: "running", text: "Working now" };
  if (!data.state.enabled) return { key: "off", text: "Off" };
  if (data.state.paused) return { key: "paused", text: "Paused" };
  return { key: "on", text: "On" };
}

function nextLook(data: ProjectAutopilot): string | null {
  const s = data.state;
  if (!s.enabled || s.paused) return null;
  if (!s.nextRunAt) return s.cadence === "manual" ? "Runs when you press Run now or answer a question" : null;
  const when = new Date(s.nextRunAt).getTime() <= Date.now() ? "any moment" : new Date(s.nextRunAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `Next look ${when}${s.nextReason ? `: ${s.nextReason}` : ""}`;
}

function Progress({ progress }: { progress: RunProgress }) {
  return (
    <div className="stack" style={{ gap: "0.4rem" }}>
      <div className="pilot-steps">
        {progress.steps.length ? (
          progress.steps.map((s) => (
            <span key={s.id} className="chat-tool" data-status={s.status}>
              {s.status === "failed" ? <X size={12} /> : <Wrench size={11} />} {s.label}
            </span>
          ))
        ) : (
          <span className="tiny muted">Looking at the project…</span>
        )}
      </div>
      {progress.text && <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>{progress.text.slice(-600)}</p>}
    </div>
  );
}

function EndNote({ end }: { end: RunEnd }) {
  if ("summary" in end)
    return (
      <div className="stack" style={{ gap: "0.3rem" }}>
        <p className="small" style={{ whiteSpace: "pre-wrap" }}>{end.summary}</p>
        <span className="tiny muted">
          {end.applied} done · {end.review} waiting for your OK · {end.asked} question{end.asked === 1 ? "" : "s"} for you
        </span>
      </div>
    );
  return <p className="small muted">{end.reason}</p>;
}

/** The autopilot on the project overview: whether it is on, what is next, and Run now. */
export function AutopilotCard({ project }: { project: Project }) {
  const { persistence } = useStudio();
  const { data, mutate } = useProjectAutopilot(project.id);
  const run = useRunNow(project, () => mutate());
  if (persistence !== "server" || !data) return null;
  const state = stateOf(data, run.running);
  const open = data.asks.filter((a) => a.status === "open").length;
  const turnOn = async () => {
    await saveAutopilotSettings(project.id, { enabled: true, paused: false });
    mutate();
  };
  return (
    <section className="card pilot-card rise" style={{ ["--i" as string]: 2 }}>
      <div className="row-between wrap" style={{ gap: "0.5rem" }}>
        <span className="row" style={{ gap: "0.5rem" }}>
          <Bot size={18} />
          <strong>Autopilot</strong>
          <span className="pilot-state tiny muted">
            <span className="pilot-dot" data-state={state.key} /> {state.text}
          </span>
        </span>
        <Link href={`/projects/${project.id}/autopilot`} className="tiny muted row" style={{ gap: "0.2rem" }}>
          Settings <ArrowRight size={12} />
        </Link>
      </div>
      {run.progress ? (
        <Progress progress={run.progress} />
      ) : run.end ? (
        <EndNote end={run.end} />
      ) : !data.state.enabled ? (
        <p className="small muted">Let the AI drive this project: it works out the next step, does what it can, and asks you only for what it needs.</p>
      ) : (
        <p className="small muted">
          {data.runs[0]?.summary ? data.runs[0].summary.slice(0, 280) : "It hasn't run yet."}
          {nextLook(data) ? ` ${nextLook(data)}.` : ""}
        </p>
      )}
      <div className="row wrap" style={{ gap: "0.4rem" }}>
        {!data.state.enabled && data.canEdit && (
          <button type="button" className="btn btn-primary btn-sm" onClick={turnOn}>
            <Zap size={14} /> Turn on
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" disabled={run.running || data.state.running} onClick={run.start}>
          <Play size={14} /> {run.running ? "Working…" : "Run now"}
        </button>
        {open > 0 && (
          <Link href="/inbox" className="btn btn-ghost btn-sm">
            {open} question{open === 1 ? "" : "s"} for you
          </Link>
        )}
      </div>
    </section>
  );
}

export function AutopilotView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  return (
    <main className="page">
      <WhenReady ready={ready}>{project ? <AutopilotPage project={project} /> : <MissingProject />}</WhenReady>
    </main>
  );
}

function AutopilotPage({ project }: { project: Project }) {
  const { persistence, toast } = useStudio();
  const { data, mutate, error } = useProjectAutopilot(project.id);
  const run = useRunNow(project, () => mutate());
  const [saving, setSaving] = React.useState(false);
  const save = async (patch: AutopilotPatch) => {
    setSaving(true);
    try {
      const state = await saveAutopilotSettings(project.id, patch);
      mutate((d) => (d ? { ...d, state } : d), { revalidate: true });
    } catch (err) {
      toast((err as Error).message);
    }
    setSaving(false);
  };
  const setLevels = (levels: AutopilotLevels) => save({ levels });

  return (
    <div style={swatchVar(project.swatch)}>
      <ProjectNavigation project={project} />
      <header className="rise" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.6rem" }}>Autopilot</p>
        <h1 className="display-l">Let the AI drive {project.name}.</h1>
        <p className="muted small" style={{ marginTop: "0.5rem", maxWidth: "60ch" }}>
          It works out the next step from the workflow, does what it can (drafts, tasks, dates, client updates, quote requests, layouts), and asks you only for what it can&apos;t know or decide. Every change it makes has an Undo. Ticking essential steps, completing a phase and anything the client sees always wait for you.
        </p>
      </header>

      {persistence !== "server" ? (
        <p className="card small muted" style={{ padding: "1.25rem" }}>The autopilot works once projects are saved on the server. In this demo everything stays in your browser.</p>
      ) : error ? (
        <p className="small" style={{ color: "var(--bad)" }}>{error.message}</p>
      ) : !data ? (
        <p className="small muted">Loading…</p>
      ) : (
        <div className="split">
          <div className="stack" style={{ gap: "1.5rem" }}>
            <section className="card pilot-card">
              <div className="row-between wrap" style={{ gap: "0.75rem" }}>
                <label className="row" style={{ gap: "0.6rem", cursor: "pointer" }}>
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={data.state.enabled}
                    aria-label="Autopilot on"
                    disabled={saving || !data.canEdit}
                    onClick={() => save({ enabled: !data.state.enabled, paused: false })}
                  />
                  <span className="strong">{data.state.enabled ? "On" : "Off"}</span>
                  <span className="pilot-state tiny muted">
                    <span className="pilot-dot" data-state={stateOf(data, run.running).key} /> {stateOf(data, run.running).text}
                  </span>
                </label>
                <div className="row wrap" style={{ gap: "0.4rem" }}>
                  {data.state.enabled && data.canEdit && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => save({ paused: !data.state.paused })}>
                      {data.state.paused ? <Play size={14} /> : <Pause size={14} />} {data.state.paused ? "Resume" : "Pause"}
                    </button>
                  )}
                  <button type="button" className="btn btn-primary btn-sm" disabled={run.running || data.state.running} onClick={run.start}>
                    <Play size={14} /> {run.running ? "Working…" : "Run now"}
                  </button>
                </div>
              </div>
              {nextLook(data) && <span className="tiny muted">{nextLook(data)}</span>}
              {data.state.enabled && (
                <label className="row-between wrap tiny" style={{ gap: "0.5rem" }}>
                  <span className="muted">How often it looks</span>
                  <select
                    className="input"
                    style={{ width: "auto", padding: "0.4rem 0.6rem" }}
                    value={data.state.cadence}
                    disabled={saving || !data.canEdit}
                    onChange={(e) => save({ cadence: e.target.value as Cadence })}
                  >
                    {CADENCES.map((c) => (
                      <option key={c} value={c}>
                        {CADENCE_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {run.progress && <Progress progress={run.progress} />}
              {run.end && !run.progress && <EndNote end={run.end} />}
            </section>

            {data.asks.some((a) => a.status === "open") && (
              <section className="stack" style={{ gap: "0.75rem" }}>
                <h2 className="eyebrow">Waiting for you</h2>
                {data.asks
                  .filter((a) => a.status === "open")
                  .map((a) => (
                    <AskCard key={a.id} ask={a} project={{ id: a.projectId, slug: project.id, name: project.name, client: project.client, swatch: project.swatch, autopilot: { enabled: data.state.enabled, paused: data.state.paused, nextRunAt: data.state.nextRunAt, nextReason: data.state.nextReason, running: data.state.running } }} onDone={() => mutate()} />
                  ))}
              </section>
            )}

            <section className="card pilot-card">
              <h2 className="eyebrow">What it would look at now</h2>
              {data.agenda.length ? (
                <ol className="pilot-agenda small">
                  {data.agenda.map((a, i) => (
                    <li key={i}>
                      {a.text} <span className="tiny muted">· {LEVEL_LABELS[a.level].name}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="small muted">Nothing needs doing right now, so a run costs nothing.</p>
              )}
            </section>

            <section className="card pilot-card">
              <h2 className="eyebrow">What it did</h2>
              {data.runs.length ? (
                data.runs.map((r) => (
                  <div key={r.id} className="pilot-run">
                    <span className="tiny muted">
                      {relativeTime(r.startedAt)} · {r.trigger === "manual" ? "Run now" : r.trigger === "answer" ? "After your answer" : "On its own"}
                      {r.status === "done" ? ` · ${r.applied} done, ${r.review} to review, ${r.asked} asked` : r.status === "idle" ? " · nothing to do" : r.status === "failed" ? " · stopped with a problem" : " · working"}
                    </span>
                    {r.summary && r.status !== "idle" && <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: "0.25rem" }}>{r.summary}</p>}
                  </div>
                ))
              ) : (
                <p className="small muted">No runs yet. Its work also shows in the assistant chat, each change with an Undo.</p>
              )}
            </section>
          </div>

          <aside>
            <Levels project={project} levels={data.state.levels} disabled={saving || !data.canEdit} onChange={setLevels} />
          </aside>
        </div>
      )}
    </div>
  );
}

function LevelSelect({ value, onChange, disabled, label, inherit }: { value: Level | undefined; onChange: (l: Level | undefined) => void; disabled?: boolean; label: string; inherit?: Level }) {
  return (
    <select aria-label={label} value={value ?? ""} disabled={disabled} onChange={(e) => onChange((e.target.value || undefined) as Level | undefined)}>
      {inherit && <option value="">As the phase ({LEVEL_LABELS[inherit].name})</option>}
      {LEVELS.map((l) => (
        <option key={l} value={l}>
          {LEVEL_LABELS[l].name}
        </option>
      ))}
    </select>
  );
}

/** How much it does: for the whole project, then per phase, then per step. */
function Levels({ project, levels, disabled, onChange }: { project: Project; levels: AutopilotLevels; disabled: boolean; onChange: (l: AutopilotLevels) => void }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const phases = getWorkflow(project).phases;
  const setPhase = (key: string, l: Level | undefined) => {
    const next = { ...levels.phases };
    if (l && l !== levels.project) next[key] = l;
    else delete next[key];
    onChange({ ...levels, phases: next });
  };
  const setStep = (id: string, l: Level | undefined) => {
    const next = { ...levels.steps };
    if (l) next[id] = l;
    else delete next[id];
    onChange({ ...levels, steps: next });
  };
  return (
    <section className="card pilot-card">
      <h2 className="eyebrow">How much it does</h2>
      <div className="stack" style={{ gap: "0.35rem" }}>
        {LEVELS.map((l) => (
          <label key={l} className="row" style={{ gap: "0.5rem", alignItems: "flex-start", cursor: "pointer" }}>
            <input type="radio" name="project-level" checked={levels.project === l} disabled={disabled} onChange={() => onChange({ ...levels, project: l })} style={{ marginTop: 4 }} />
            <span className="stack">
              <span className="small strong">{LEVEL_LABELS[l].name}</span>
              <span className="tiny muted">{LEVEL_LABELS[l].hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="pilot-levels">
        <span className="tiny muted" style={{ marginTop: "0.5rem" }}>By phase and step</span>
        {phases.map((p) => {
          const own = levels.phases[p.key];
          const effective = phaseLevel(levels, p.key);
          return (
            <div key={p.key}>
              <div className="pilot-level-row">
                <button type="button" className="row small strong" style={{ gap: "0.3rem" }} onClick={() => setOpen(open === p.key ? null : p.key)} aria-expanded={open === p.key}>
                  <ChevronDown size={14} style={{ transform: open === p.key ? "rotate(180deg)" : undefined }} /> {p.name}
                </button>
                <LevelSelect label={`${p.name} level`} value={own ?? levels.project} disabled={disabled} onChange={(l) => setPhase(p.key, l)} />
              </div>
              {open === p.key && (
                <div className="pilot-steps-list">
                  {p.checklist.map((item) => (
                    <div key={item.id} className="pilot-level-row">
                      <span className="small" style={{ flex: "1 1 200px" }}>
                        {item.text}
                        {item.essential && <span className="tiny muted"> · essential</span>}
                      </span>
                      <LevelSelect label={`${item.text} level`} value={levels.steps[item.id]} inherit={effective} disabled={disabled} onChange={(l) => setStep(item.id, l)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="pilot-level-row" style={{ marginTop: "0.5rem" }}>
        <span className="stack" style={{ flex: "1 1 200px" }}>
          <span className="small strong">Money</span>
          <span className="tiny muted">Drafts proposals, invoices, payment reminders and supplier orders. You always check and send them.</span>
        </span>
        <LevelSelect label="Money level" value={levels.money} disabled={disabled} onChange={(l) => onChange({ ...levels, money: l ?? "auto" })} />
      </div>
      <label className="row-between" style={{ gap: "0.75rem", marginTop: "0.5rem", cursor: "pointer" }}>
        <span className="stack">
          <span className="small strong">Weekly client update</span>
          <span className="tiny muted">It drafts one each week for you to check and send</span>
        </span>
        <button type="button" role="switch" className="switch" aria-checked={levels.clientUpdates} disabled={disabled} onClick={() => onChange({ ...levels, clientUpdates: !levels.clientUpdates })} aria-label="Weekly client update" />
      </label>
    </section>
  );
}
