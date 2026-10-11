"use client";
import Link from "next/link";
import { ArrowRight, Sparkles, CheckCircle2, FileText } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { phaseGuidance } from "@/lib/workflow/guidance";
import type { Project } from "@/lib/studio/types";

export function PhaseGuide({ project, phaseKey }: { project: Project; phaseKey: string }) {
  const { viewer, askAssistant } = useStudio();
  const guide = phaseGuidance(project, phaseKey);
  if (!guide) return null;
  const ai = viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";
  return (
    <section className="card phase-guide" aria-label="Phase guide">
      <div className="row-between wrap" style={{ gap: "1rem" }}>
        <div className="stack" style={{ gap: "0.4rem" }}>
          <p className="eyebrow">Your next move</p>
          <h2 className="display-s">{project.status === "on_hold" ? "This project is on hold" : guide.state === "complete" ? "Keep the reviewed work together" : guide.state === "upcoming" ? "Prepare for this phase" : guide.openEssentials[0]?.text ?? "Review your work and complete the phase"}</h2>
          <p className="small muted">{guide.progress.essentialDone} of {guide.progress.essentialTotal} essentials complete · {guide.documents.length} document{guide.documents.length === 1 ? "" : "s"} in this phase</p>
        </div>
        {ai && <button type="button" className="btn btn-secondary" onClick={() => askAssistant({ projectId: project.id, phaseKey, prompt: guide.reviewPrompt })}><Sparkles size={16} /> Review with AI</button>}
      </div>
      {guide.forms.length > 0 && <div className="phase-guide-forms">{guide.forms.map((form) => <Link key={form.key} href={form.href} className="phase-guide-form"><FileText size={16} /><span className="grow"><strong className="small">{form.name}</strong><span className="tiny muted" style={{ display: "block" }}>{form.filled}/{form.total} fields filled{form.missing.length > 0 ? ` · Start with ${form.missing[0]}` : " · Ready to review"}</span></span><ArrowRight size={16} /></Link>)}</div>}
      {guide.openEssentials.length > 0 && <details className="phase-guide-details"><summary>{guide.openEssentials.length} essentials to verify before completion</summary><ul>{guide.openEssentials.map((item) => <li key={item.id}>{item.text}</li>)}</ul></details>}
      {(guide.incoming.length > 0 || guide.outgoing.length > 0) && <details className="phase-guide-details"><summary>What carries between phases</summary>{guide.incoming.map((h, i) => <p key={`in-${i}`} className="small"><strong>Inputs: </strong>{h.description || `${h.from} → ${h.to}`}</p>)}{guide.outgoing.map((h, i) => <p key={`out-${i}`} className="small"><strong>Handoff: </strong>{h.description || `${h.from} → ${h.to}`}</p>)}</details>}
      {guide.canComplete && <Link href={`/projects/${project.id}/phases/${phaseKey}/complete`} className="btn btn-accent"><CheckCircle2 size={16} /> Review and complete phase</Link>}
      <p className="tiny muted">Saved fields help you prepare. Completion depends on verified essentials. AI requests are editable before sending; you approve proposed changes.</p>
    </section>
  );
}
