"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Check, GitCompare, LayoutGrid, PenLine, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { ProjectNavigation } from "@/components/projects/ProjectNavigation";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { IssueMarker } from "@/components/ui/IssueMarker";
import { MissingProject } from "@/components/views/MissingProject";
import { usePlanEditor } from "@/components/plan/usePlanEditor";
import { checkLayout, type LayoutReport } from "@/lib/layout/check";
import { generateLayouts } from "@/lib/layout/generate";
import { chooseLayout, layoutItems, removeLayout, saveOptions, updateLayoutNotes, withLayout } from "@/lib/layout/options";
import { parseAdjacencies, parseDepartments, parseHeadcount, type Adjacency, type Department } from "@/lib/layout/rules";
import { sortedLevels } from "@/lib/plan/elements";
import { m2, onLevel, type LayoutOption, type Plan } from "@/lib/plan/geometry";
import { shortDate } from "@/lib/studio/format";
import type { Project } from "@/lib/studio/types";
import { getWorkflow, label } from "@/lib/workflow";
import { IssueList, PlanThumb, ScoreParts, metricRows } from "./LayoutParts";
import { PairsEditor } from "./RulesView";
import { useRuleSets } from "./useRuleSets";
import { isStringOrNull, useViewSetting } from "@/lib/view-settings/client";

/**
 * The layout generator (P4-02 to P4-05): what to lay out, read from the brief
 * and the designer's rules; the options it made, each scored; two or three
 * side by side; and choosing one, with the reasons, for the concept phase.
 * Options are kept in the plan, so they save, undo and keep versions with it.
 */
export function LayoutView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  if (ready && !project) return <main className="page"><MissingProject /></main>;
  return <WhenReady ready={ready}>{project && <LayoutScreen project={project} />}</WhenReady>;
}

function layoutPhase(project: Project) {
  return getWorkflow(project).phases.find((p) => p.modules.some((m) => m.startsWith("layout_generator")));
}

function LayoutScreen({ project }: { project: Project }) {
  const { toast } = useStudio();
  const editor = usePlanEditor(project.id);
  const plan = editor.plan;
  const phase = layoutPhase(project);
  const exitHref = `/projects/${project.id}/phases/${phase?.key ?? project.currentPhase}`;

  const levels = useMemo(() => (plan ? sortedLevels(plan) : []), [plan]);
  const [levelPick, setLevel] = useViewSetting<string | null>(`layout.${project.id}.level`, null, isStringOrNull);
  // The floor with the most usable rooms, unless one was picked.
  const levelId =
    levels.find((l) => l.id === levelPick)?.id ??
    [...levels].sort((a, b) => countRooms(plan, b.id) - countRooms(plan, a.id))[0]?.id ??
    "";

  const options = useMemo(() => (plan ? plan.layouts.filter((l) => l.levelId === levelId) : []), [plan, levelId]);
  // Each option checked against its own rules, on the plan as it is now.
  const reports = useMemo(() => {
    const out = new Map<string, LayoutReport>();
    if (!plan) return out;
    for (const o of options) {
      out.set(o.id, checkLayout(onLevel(withLayout(plan, o), o.levelId), { rules: o.rules, headcount: o.headcount, adjacencies: o.adjacencies }));
    }
    return out;
  }, [plan, options]);

  const [comparing, setComparing] = useState<string[]>([]);
  const compared = comparing.map((id) => options.find((o) => o.id === id)).filter((o): o is LayoutOption => !!o);
  const [choosing, setChoosing] = useState<LayoutOption | null>(null);

  const status =
    editor.status === "saved" ? "Saved" : editor.status === "saving" || editor.status === "dirty" ? "Saving" : "Not saved";

  return (
    <FocusFrame
      beforeExit={editor.flush}
      exitHref={exitHref}
      title={label(project, "layout_generator", "Layout options")}
      right={<span className="tiny muted" aria-live="polite">{plan ? status : ""}</span>}
      wide
    >
      <div style={swatchVar(project.swatch)} className="layout-page">
        <ProjectNavigation project={project} beforeNavigate={editor.flush} compact />
        {editor.loaded === "loading" && <p className="muted">Loading the plan…</p>}
        {editor.loaded === "failed" && <p className="small" role="alert">The plan could not be loaded. Check your connection and reload the page.</p>}
        {editor.loaded === "ready" && (!plan || !plan.rooms.some((r) => r.usable)) && <NoRooms project={project} />}
        {editor.loaded === "ready" && plan && plan.rooms.some((r) => r.usable) && (
          <>
            <header className="stack rise" style={{ gap: "0.5rem", marginBottom: "1.75rem" }}>
              <p className="eyebrow">{project.name}</p>
              <h1 className="display-m">Layout options</h1>
              <p className="muted" style={{ maxWidth: 640 }}>
                Desks laid out for the brief&apos;s teams following your layout rules, three to five ways, each scored. Open one to
                move things; the rules are checked as you go. Choose one to carry into concept.
              </p>
            </header>

            {editor.conflict && (
              <div className="plan-banner" role="alert" style={{ marginBottom: "1rem" }}>
                <span className="small grow">The plan was changed somewhere else since you opened it. Your latest changes are not saved yet.</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={editor.takeTheirs}>Load theirs</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={editor.keepMine}>Keep mine</button>
              </div>
            )}

            <Inputs
              key={levelId}
              project={project}
              plan={plan}
              levelId={levelId}
              levels={levels.map((l) => ({ id: l.id, name: l.name }))}
              onLevel={setLevel}
              hasOptions={options.length > 0}
              onMade={(made, notes) => {
                const error = editor.apply(saveOptions(plan, levelId, made));
                if (error) toast(error);
                else {
                  setComparing([]);
                  toast(notes.length ? notes.join(" ") : `${made.length} options made. Undo brings back the ones before.`);
                }
              }}
            />

            {options.length > 0 && (
              <section className="rise" style={{ marginTop: "2.25rem", ["--i" as string]: 2 }}>
                <div className="section-title">
                  <h2>
                    Options<span className="count">{options.length}</span>
                  </h2>
                  {comparing.length < 2 && options.length > 1 && <span className="tiny muted">Tick two or three to compare them</span>}
                </div>
                <div className="layout-options">
                  {options.map((o) => (
                    <OptionCard
                      key={o.id}
                      project={project}
                      plan={plan}
                      option={o}
                      report={reports.get(o.id)!}
                      comparing={comparing.includes(o.id)}
                      onCompare={(on) =>
                        setComparing((c) => (on ? [...c.filter((x) => x !== o.id), o.id].slice(-3) : c.filter((x) => x !== o.id)))
                      }
                      onChoose={() => setChoosing(o)}
                      onNotes={(text) => {
                        const error = editor.apply(updateLayoutNotes(plan, o.id, text));
                        if (error) toast(error);
                      }}
                      onRemove={() => {
                        const error = editor.apply(removeLayout(plan, o.id));
                        if (error) toast(error);
                        else toast(`${o.name} removed. Undo brings it back.`);
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {compared.length >= 2 && (
              <Compare plan={plan} options={compared} reports={reports} onClose={() => setComparing([])} />
            )}
          </>
        )}
      </div>
      <IssueMarker moduleKey="layout_generator" projectId={project.id} className="pinned" />

      {choosing && plan && (
        <ChooseSheet
          option={choosing}
          onClose={() => setChoosing(null)}
          onChoose={async (notes) => {
            const option = choosing;
            setChoosing(null);
            try {
              await editor.createVersion(`Before choosing ${option.name}`);
            } catch {
              toast("The plan as it is could not be kept as a version first, so nothing was changed.");
              return;
            }
            const error = editor.apply(chooseLayout(plan, option.id, notes));
            if (error) toast(error);
            else toast(`${option.name} chosen. Its furniture is now on the plan, and the plan before was kept as a version.`);
          }}
        />
      )}
    </FocusFrame>
  );
}

function countRooms(plan: Plan | null, levelId: string): number {
  return plan ? plan.rooms.filter((r) => r.levelId === levelId && r.usable).length : 0;
}

function NoRooms({ project }: { project: Project }) {
  return (
    <div className="stack rise" style={{ gap: "1rem", maxWidth: 560 }}>
      <p className="eyebrow">{project.name}</p>
      <h1 className="display-m">The plan comes first</h1>
      <p className="muted">
        Layouts are made inside the rooms of the floor plan. Draw or import the plan, then mark its rooms with the Room tool: name
        the work areas (an open plan) and the rest (meeting room, kitchen), so desks go in the right places.
      </p>
      <Link href={`/projects/${project.id}/plan`} className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
        <PenLine size={15} /> Open the floor plan
      </Link>
    </div>
  );
}

/** What to lay out: the floor, the rules, and the brief's people, teams and pairs, all editable. */
function Inputs({
  project,
  plan,
  levelId,
  levels,
  onLevel,
  hasOptions,
  onMade,
}: {
  project: Project;
  plan: Plan;
  levelId: string;
  levels: { id: string; name: string }[];
  onLevel: (id: string) => void;
  hasOptions: boolean;
  onMade: (options: LayoutOption[], notes: string[]) => void;
}) {
  const { sets } = useRuleSets();
  const [setPick, setSetPick] = useState<string | null>(null);
  const ruleSet = sets?.find((s) => s.id === setPick) ?? sets?.[0];
  const roomNames = useMemo(() => plan.rooms.filter((r) => r.levelId === levelId).map((r) => r.name), [plan, levelId]);

  // Read from the brief once; changed here, they stay changed until the page is left.
  const [teams, setTeams] = useState<Department[]>(() => parseDepartments(project.brief.departments));
  const [people, setPeople] = useState<string>(() => {
    const n = parseHeadcount(project.brief.headcount);
    return n ? String(n) : "";
  });
  const [pairs, setPairs] = useState<Adjacency[]>(() =>
    parseAdjacencies(project.brief.adjacencies, [...parseDepartments(project.brief.departments).map((d) => d.name), ...roomNames])
  );
  const [teamName, setTeamName] = useState("");
  const [teamCount, setTeamCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamTotal = teams.reduce((s, t) => s + t.headcount, 0);
  const headcount = Number(people) > 0 ? Math.round(Number(people)) : null;
  const allPairs = [...pairs, ...(ruleSet?.rules.adjacencies ?? [])];

  const make = () => {
    if (!ruleSet) return;
    setBusy(true);
    setError(null);
    // A moment for the button to show it is working; laying out takes up to a second on a big floor.
    setTimeout(() => {
      const result = generateLayouts(plan, levelId, {
        rules: ruleSet.rules,
        ruleSetName: ruleSet.name,
        headcount,
        departments: teams,
        adjacencies: allPairs,
      });
      setBusy(false);
      if (!result.ok) setError(result.error);
      else onMade(result.options.map((o) => o.option), result.notes);
    }, 30);
  };

  return (
    <section className="card layout-inputs rise" style={{ ["--i" as string]: 1 }}>
      <div className="layout-inputs-grid">
        {levels.length > 1 && (
          <label className="field">
            <span className="field-label">Floor</span>
            <select className="input" value={levelId} onChange={(e) => onLevel(e.target.value)}>
              {[...levels].reverse().map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Rules</span>
          <span className="row" style={{ gap: "0.5rem" }}>
            <select className="input grow" value={ruleSet?.id ?? ""} onChange={(e) => setSetPick(e.target.value)} disabled={!sets}>
              {sets?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Link href="/rules" className="btn btn-ghost btn-sm">Edit</Link>
          </span>
          {ruleSet && (
            <span className="tiny muted">
              Desks {ruleSet.rules.deskWidth} by {ruleSet.rules.deskDepth}, aisles {ruleSet.rules.aisle}, main route {ruleSet.rules.mainRoute} mm
            </span>
          )}
        </label>
        <label className="field">
          <span className="field-label">People to seat</span>
          <input className="input tabular" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value.replace(/[^\d]/g, ""))} placeholder={teamTotal ? String(teamTotal) : "e.g. 40"} />
          <span className="tiny muted">
            {project.brief.headcount?.trim() ? `From the brief: "${project.brief.headcount.trim().slice(0, 60)}"` : "The brief gives no headcount"}
          </span>
        </label>
      </div>

      <div className="stack" style={{ gap: "0.5rem" }}>
        <span className="field-label">Teams</span>
        {teams.length > 0 ? (
          <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
            {teams.map((t, i) => (
              <span key={`${t.name}-${i}`} className="tag tag-ai">
                {t.name} <span className="tabular">{t.headcount}</span>
                <button type="button" aria-label={`Remove ${t.name}`} onClick={() => setTeams(teams.filter((_, j) => j !== i))} style={{ display: "inline-flex" }}>
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="tiny muted">No teams in the brief, so desks are not labelled by team. Add them to keep each team together.</p>
        )}
        <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          <input className="input" style={{ maxWidth: 200 }} placeholder="Team" value={teamName} onChange={(e) => setTeamName(e.target.value)} aria-label="Team name" />
          <input className="input tabular" style={{ maxWidth: 90 }} placeholder="People" inputMode="numeric" value={teamCount} onChange={(e) => setTeamCount(e.target.value.replace(/[^\d]/g, ""))} aria-label="People in the team" />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!teamName.trim() || !(Number(teamCount) > 0)}
            onClick={() => {
              setTeams([...teams, { name: teamName.trim().slice(0, 120), headcount: Math.min(5_000, Number(teamCount)) }]);
              setTeamName("");
              setTeamCount("");
            }}
          >
            <Plus size={14} /> Add team
          </button>
        </div>
        {teamTotal > 0 && headcount != null && teamTotal !== headcount && (
          <p className="tiny muted">
            The teams add up to {teamTotal}; {teamTotal > headcount ? `${teamTotal} desks are laid out` : `the other ${headcount - teamTotal} desks are spare`}.
          </p>
        )}
      </div>

      <div className="stack" style={{ gap: "0.5rem" }}>
        <span className="field-label">Near and apart</span>
        <PairsEditor pairs={pairs} onChange={setPairs} names={[...teams.map((t) => t.name), ...roomNames]} />
        {(ruleSet?.rules.adjacencies.length ?? 0) > 0 && (
          <p className="tiny muted">Plus {ruleSet!.rules.adjacencies.length} from {ruleSet!.name}.</p>
        )}
      </div>

      <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn-primary" onClick={make} disabled={!ruleSet || busy}>
          <Wand2 size={15} /> {busy ? "Laying out…" : hasOptions ? "Make new options" : "Make options"}
        </button>
        <span className="tiny muted grow">
          Desks and chairs already in the work rooms are laid out afresh; everything else on the floor stays.
          {hasOptions ? " New options replace the ones not chosen." : ""}
        </span>
      </div>
      {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
    </section>
  );
}

function OptionCard({
  project,
  plan,
  option,
  report,
  comparing,
  onCompare,
  onChoose,
  onNotes,
  onRemove,
}: {
  project: Project;
  plan: Plan;
  option: LayoutOption;
  report: LayoutReport;
  comparing: boolean;
  onCompare: (on: boolean) => void;
  onChoose: () => void;
  onNotes: (text: string) => void;
  onRemove: () => void;
}) {
  const level = useMemo(() => onLevel(plan, option.levelId), [plan, option.levelId]);
  const flagged = useMemo(() => new Set(report.issues.flatMap((i) => i.itemIds)), [report]);
  const rows = metricRows(report).filter((r) => ["desks", "perDesk", "circulation", "walk", "near", "issues"].includes(r.key));
  return (
    <article className="card layout-option" data-chosen={option.chosen || undefined}>
      <div className="row-between" style={{ gap: "0.5rem" }}>
        <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
          <h3 className="display-s row" style={{ gap: "0.5rem" }}>
            {option.name}
            {option.chosen && (
              <span className="tag tag-good">
                <Check size={12} /> Chosen
              </span>
            )}
          </h3>
          <span className="tiny muted">{option.ruleSetName}, {shortDate(new Date(option.createdAt))}</span>
        </div>
        <div className="layout-score" aria-label={`Score ${report.metrics.score} out of 100`}>
          <span className="display-m tabular">{report.metrics.score}</span>
          <span className="tiny muted">score</span>
        </div>
      </div>
      <PlanThumb level={level} items={layoutItems(plan, option)} flagged={flagged} label={`${option.name} drawn small`} />
      <p className="small muted">{option.summary}</p>
      <dl className="layout-metrics">
        {rows.map((r) => (
          <div key={r.key}>
            <dt className="tiny muted" title={r.hint}>{r.label}</dt>
            <dd className="small tabular" data-bad={r.key === "issues" && report.issues.length > 0 ? true : undefined}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {report.issues.length > 0 && <IssueList issues={report.issues} limit={3} />}
      {option.chosen && <NotesField key={option.notes ?? ""} notes={option.notes ?? ""} onSave={onNotes} />}
      <div className="row layout-option-actions" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <Link href={`/projects/${project.id}/plan?layout=${option.id}`} className="btn btn-secondary btn-sm">
          <PenLine size={14} /> Open
        </Link>
        {!option.chosen && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onChoose}>
            <Sparkles size={14} /> Choose
          </button>
        )}
        <label className="row tiny strong" style={{ gap: "0.35rem", cursor: "pointer" }}>
          <input type="checkbox" checked={comparing} onChange={(e) => onCompare(e.target.checked)} /> Compare
        </label>
        <span className="grow" />
        {!option.chosen && (
          <button type="button" className="icon-btn" aria-label={`Remove ${option.name}`} title="Remove" onClick={onRemove}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </article>
  );
}

function NotesField({ notes, onSave }: { notes: string; onSave: (text: string) => void }) {
  const [text, setText] = useState(notes);
  return (
    <label className="field">
      <span className="field-label">Why this one</span>
      <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== notes && onSave(text)} placeholder="Reasons the concept phase should know" />
    </label>
  );
}

/** Two or three options side by side, each measure with the best one marked (P4-03). */
function Compare({ plan, options, reports, onClose }: { plan: Plan; options: LayoutOption[]; reports: Map<string, LayoutReport>; onClose: () => void }) {
  const rows = options.map((o) => metricRows(reports.get(o.id)!));
  const best = (i: number): Set<number> => {
    const kind = rows[0][i].better;
    const raws = rows.map((r) => r[i].raw);
    if (!kind || raws.some((v) => v == null)) return new Set();
    const target = kind === 1 ? Math.max(...(raws as number[])) : Math.min(...(raws as number[]));
    if (raws.every((v) => v === target)) return new Set();
    return new Set(raws.flatMap((v, j) => (v === target ? [j] : [])));
  };
  return (
    <section className="layout-compare rise" aria-label="Compare options" style={{ marginTop: "2.25rem" }}>
      <div className="section-title">
        <h2 className="row" style={{ gap: "0.5rem" }}>
          <GitCompare size={18} /> Side by side
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Stop comparing</button>
      </div>
      <div className="layout-compare-grid" style={{ ["--cols" as string]: options.length }}>
        <div />
        {options.map((o) => (
          <div key={o.id} className="stack" style={{ gap: "0.5rem" }}>
            <span className="small strong">{o.name}{o.chosen ? ", chosen" : ""}</span>
            <PlanThumb level={onLevel(plan, o.levelId)} items={layoutItems(plan, o)} label={`${o.name} drawn small`} />
          </div>
        ))}
        {rows[0].map((row, i) => {
          const winners = best(i);
          return (
            <React.Fragment key={row.key}>
              <div className="small muted" title={row.hint}>{row.label}</div>
              {rows.map((r, j) => (
                <div key={j} className="small tabular" data-best={winners.has(j) || undefined}>
                  {r[i].value}
                  {winners.has(j) && <Check size={13} aria-label="best" style={{ marginLeft: "0.3rem", verticalAlign: "-2px" }} />}
                </div>
              ))}
            </React.Fragment>
          );
        })}
        <div className="small muted">Where the score comes from</div>
        {options.map((o) => (
          <ScoreParts key={o.id} report={reports.get(o.id)!} />
        ))}
      </div>
      <p className="tiny muted" style={{ marginTop: "0.75rem" }}>
        Areas are measured from the room outlines on the plan ({m2(rows[0].length ? reports.get(options[0].id)!.metrics.usableArea : 0)} usable on this floor), so
        they can be checked by hand against the same plan.
      </p>
    </section>
  );
}

function ChooseSheet({ option, onClose, onChoose }: { option: LayoutOption; onClose: () => void; onChoose: (notes: string) => void }) {
  const [notes, setNotes] = useState(option.notes ?? "");
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`Choose ${option.name}`}>
        <h2 className="display-s row" style={{ gap: "0.5rem", marginBottom: "0.5rem" }}>
          <LayoutGrid size={18} /> Choose {option.name}?
        </h2>
        <p className="small muted" style={{ marginBottom: "1rem" }}>
          Its furniture goes on the floor plan, so exports and the concept phase use it. The plan as it is now is kept as a version
          first. You can choose another option later.
        </p>
        <label className="field" style={{ marginBottom: "1.25rem" }}>
          <span className="field-label">Why this one (shown in concept)</span>
          <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Finance beside the boardroom, the most daylight at the desks…" autoFocus />
        </label>
        <div className="row" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onChoose(notes)}>
            <Check size={15} /> Choose {option.name}
          </button>
        </div>
      </div>
    </>
  );
}
