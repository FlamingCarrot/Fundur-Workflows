"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { getWorkflow } from "@/lib/workflow";
import { projectSections } from "@/lib/studio/project-navigation";
import { DEMO_VIEWER } from "@/lib/studio/viewer";
import { ACCESS_TEMPLATES, FULL_ACCESS, isFullAccess, toolKey, type ProjectAccess } from "@/lib/team/access";
import { loadTeam, saveAccess, type TeamAccessRow } from "@/lib/team/client";
import type { Project } from "@/lib/studio/types";
import "./team.css";

const ROLE: Record<string, string> = { owner: "Owner", member: "Member", collaborator: "Collaborator" };

/**
 * Project settings > Team access. The owner decides, per teammate, whether they
 * can change things or only view, and which phases, steps and tools they get.
 * Everyone starts with everything; templates are quick starting points.
 */
export function TeamAccessTab({ project }: { project: Project }) {
  const { persistence, viewer } = useStudio();
  const [team, setTeam] = useState<TeamAccessRow[] | null>(null);
  const [problem, setProblem] = useState("");
  const refresh = useCallback(async () => {
    try {
      setTeam(await loadTeam(project.id));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load the team.");
    }
  }, [project.id]);
  useEffect(() => {
    if (persistence !== "server") return;
    let live = true;
    loadTeam(project.id)
      .then((t) => live && setTeam(t))
      .catch((e) => live && setProblem(e instanceof Error ? e.message : "Could not load the team."));
    return () => {
      live = false;
    };
  }, [persistence, project.id]);

  if (persistence !== "server")
    return (
      <p className="muted" style={{ maxWidth: 620 }}>
        Teammates join once Fundur runs with sign-in. Then each one appears here, and you choose what they can see and do on this
        project: view only or full access, and which phases, steps and tools they get.
      </p>
    );
  if (viewer.workspaceRole !== "owner")
    return <p className="muted">Only an owner of the workspace chooses who sees what on a project.</p>;
  const others = (team ?? []).filter((m) => m.role !== "owner");
  return (
    <div className="access-grid" style={{ maxWidth: 760 }}>
      <p className="muted">
        Everyone on the project starts with full access. Narrow it for a teammate here; they can still comment and chat.
      </p>
      {problem && <p className="small" style={{ color: "var(--bad)" }}>{problem}</p>}
      {team && !others.length && (
        <p className="small muted">
          Nobody else is on this project yet. Invite teammates in Settings, Workspace, and give collaborators this project.
        </p>
      )}
      {others.map((m) => (
        <MemberAccess key={m.id} project={project} member={m} onSaved={refresh} />
      ))}
    </div>
  );
}

function MemberAccess({ project, member, onSaved }: { project: Project; member: TeamAccessRow; onSaved: () => Promise<void> }) {
  const [access, setAccess] = useState<ProjectAccess>(member.access ?? FULL_ACCESS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const phases = getWorkflow(project).phases;
  const tools = useMemo(
    () =>
      projectSections({ ...project, myAccess: undefined }, DEMO_VIEWER).flatMap((s) => {
        const key = toolKey(s.href, project.id);
        return key && key !== "settings" ? [{ key, label: s.label }] : [];
      }),
    [project],
  );
  const dirty = JSON.stringify(access) !== JSON.stringify(member.access ?? FULL_ACCESS);
  const toggle = (list: string[], key: string, hide: boolean) => (hide ? [...new Set([...list, key])] : list.filter((k) => k !== key));
  const save = async () => {
    setBusy(true);
    setNote("");
    try {
      await saveAccess(project.id, member.id, isFullAccess(access) ? null : access);
      await onSaved();
      setNote("Saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Not saved. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="access-card" aria-label={member.name}>
      <div className="row-between wrap">
        <div className="stack" style={{ gap: "0.1rem" }}>
          <strong>{member.name}</strong>
          <span className="tiny muted">
            {member.email} · {ROLE[member.role] ?? member.role}
            {!member.active && " · switched off"}
          </span>
        </div>
        <span className="tiny muted">{isFullAccess(access) ? "Full access" : access.level === "view" ? "View only" : "Limited"}</span>
      </div>
      <div className="row wrap" style={{ gap: "0.4rem" }} role="group" aria-label="Templates">
        {ACCESS_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`btn btn-sm ${access.template === t.key ? "btn-primary" : "btn-secondary"}`}
            title={t.description}
            onClick={() => setAccess(t.build(project))}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="Can change things">
        <button type="button" aria-pressed={access.level === "edit"} onClick={() => setAccess({ ...access, level: "edit", template: undefined })}>
          Can edit
        </button>
        <button type="button" aria-pressed={access.level === "view"} onClick={() => setAccess({ ...access, level: "view", template: undefined })}>
          View only
        </button>
      </div>
      <details>
        <summary className="small strong">Phases and steps</summary>
        {phases.map((p) => {
          const shown = !access.hiddenPhases.includes(p.key);
          return (
            <div key={p.key} className="access-phase">
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={(e) => setAccess({ ...access, hiddenPhases: toggle(access.hiddenPhases, p.key, !e.target.checked), template: undefined })}
                />
                {p.name}
              </label>
              {shown && p.checklist.length > 0 && (
                <div className="access-steps">
                  {p.checklist.map((i) => (
                    <label key={i.id} className="check-line">
                      <input
                        type="checkbox"
                        checked={!access.hiddenSteps.includes(i.id)}
                        onChange={(e) => setAccess({ ...access, hiddenSteps: toggle(access.hiddenSteps, i.id, !e.target.checked), template: undefined })}
                      />
                      <span className="small">{i.text}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </details>
      <details>
        <summary className="small strong">Tools</summary>
        <div className="access-steps" style={{ marginLeft: 0, marginTop: "0.6rem" }}>
          {tools.map((t) => (
            <label key={t.key} className="check-line">
              <input
                type="checkbox"
                checked={!access.hiddenTools.includes(t.key)}
                onChange={(e) => setAccess({ ...access, hiddenTools: toggle(access.hiddenTools, t.key, !e.target.checked), template: undefined })}
              />
              {t.label}
            </label>
          ))}
        </div>
      </details>
      <div className="row wrap" style={{ gap: "0.75rem" }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => void save()}>
          Save access
        </button>
        {dirty && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccess(member.access ?? FULL_ACCESS)}>
            Undo changes
          </button>
        )}
        <span className="tiny muted" role="status">
          {note}
        </span>
      </div>
    </section>
  );
}
