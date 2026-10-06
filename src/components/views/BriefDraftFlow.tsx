"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, FileText, UploadCloud, Wand2, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { ProgressRing, WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "./MissingProject";
import { briefFields } from "./BriefView";
import { fileSize, zar } from "@/lib/studio/format";
import { uploadToProject } from "@/lib/studio/uploads";
import { label, phaseWithForm } from "@/lib/workflow";
import type { FormField } from "@/lib/workflow/schema";
import type { Brief, BriefField, Project } from "@/lib/studio/types";

type Stage = "add" | "drafting" | "review";

/** What the simulated demo draft adds to the project's AI spend. */
const DEMO_DRAFT_COST_ZAR = 0.04;

/** Progress lines shown while drafting, named after the form's own fields. */
function draftingStages(fields: FormField[]): string[] {
  const named = fields.filter((f) => f.key !== "clientName").slice(0, 3);
  return ["Reading your notes", ...named.map((f) => `Finding ${f.label.toLowerCase()}`), "Matching the fields"];
}

// Simulated extraction for the open demo, which has no server: picks obvious
// figures out of pasted text and fills the rest with a plausible draft. Only
// fields the workflow's form defines are returned.
function draftFrom(text: string, project: Project, fields: FormField[]): Brief {
  const head = text.match(/(\d{2,4})\s*(people|staff|employees|heads|desks)/i)?.[1];
  const budget = text.match(/R\s?\d[\d\s,.]*(?:\s?(?:m|million|k))?/i)?.[0];
  const area = text.match(/\d[\d,.]*\s?(?:m²|m2|sqm|square metres)/i)?.[0];
  const sample: Brief = {
    clientName: project.client,
    headcount: head ?? "120",
    departments: "Leadership (8), Client services (40), Operations (36), Shared support (36)",
    adjacencies: "Client services beside reception; operations grouped near the print and storage core",
    targetBudget: budget?.trim() ?? "R 3,600,000",
    spaceRequirements: area ? `${area}, details to confirm on site` : "1,800 m² on one floor, ceiling height to confirm",
    notes: "Calm, daylight-led spaces with acoustic control in open areas; client asked for local materials.",
  };
  return Object.fromEntries(fields.map((f) => [f.key, sample[f.key] ?? "To confirm from the notes"]));
}

/** Picks what the notes filled where the brief is empty or still holds an untouched AI draft. */
function initialPicks(result: Brief, fields: FormField[], project: Project): Record<BriefField, boolean> {
  return Object.fromEntries(
    fields.map((f) => [
      f.key,
      !!result[f.key]?.trim() && (!project.brief[f.key]?.trim() || project.briefAiFields.includes(f.key)),
    ])
  ) as Record<BriefField, boolean>;
}

export function BriefDraftFlow({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  if (ready && !project) return <main className="page"><MissingProject /></main>;
  return <WhenReady ready={ready}>{project && <DraftFlow project={project} />}</WhenReady>;
}

function DraftFlow({ project }: { project: Project }) {
  const router = useRouter();
  const { updateBrief, addAiSpend, addDocuments, toast, persistence, receiveProject, viewer, fileStorage } = useStudio();
  const live = persistence === "server";
  const [stage, setStage] = useState<Stage>("add");
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [over, setOver] = useState(false);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<Brief | null>(null);
  const [picked, setPicked] = useState<Record<BriefField, boolean>>({} as Record<BriefField, boolean>);
  const [cost, setCost] = useState(DEMO_DRAFT_COST_ZAR);
  const [error, setError] = useState<{ message: string; setup?: boolean } | null>(null);
  const briefPhase = phaseWithForm(project, "brief");
  const fields = briefFields(project);
  const stages = draftingStages(fields);
  const briefHref = `/projects/${project.id}/brief`;
  const briefLabel = label(project, "brief", "Brief");
  const hasInput = files.length > 0 || pasted.trim().length > 20;

  const review = (result: Brief) => {
    setDraft(result);
    setPicked(initialPicks(result, fields, project));
    setStage("review");
  };

  // The progress lines step through while drafting; with a real model the last one waits for the answer.
  useEffect(() => {
    if (stage !== "drafting") return;
    if (live && tick + 1 >= stages.length) return;
    const t = setTimeout(() => {
      if (tick + 1 < stages.length) {
        setTick(tick + 1);
        return;
      }
      const result = draftFrom(pasted, project, fields);
      setDraft(result);
      setPicked(initialPicks(result, fields, project));
      setStage("review");
    }, live ? 1400 : 700);
    return () => clearTimeout(t);
  }, [stage, tick, live, pasted, project, fields, stages.length]);

  const start = async () => {
    setError(null);
    setTick(0);
    setStage("drafting");
    if (!live) return;
    const body = new FormData();
    files.forEach((f) => body.append("files", f));
    body.append("text", pasted);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}/brief/draft`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (data.project) receiveProject(data.project);
      if (!res.ok) {
        setError({ message: data.error || "The draft didn't work. Try again.", setup: data.code === "not_configured" });
        setStage("add");
        return;
      }
      setCost(data.costZar ?? 0);
      review(data.draft as Brief);
    } catch {
      setError({ message: "Couldn't reach Fundur. Check your connection and try again." });
      setStage("add");
    }
  };

  const apply = () => {
    if (!draft) return;
    const patch: Brief = Object.fromEntries(fields.filter((f) => picked[f.key]).map((f) => [f.key, draft[f.key]]));
    updateBrief(project.id, patch, true);
    // On the server the call is already logged with its cost; the demo adds its pretend cost here.
    addAiSpend(project.id, DEMO_DRAFT_COST_ZAR);
    if (files.length && briefPhase) {
      const doc = (f: File, storageKey?: string) => ({
        id: crypto.randomUUID(),
        name: f.name,
        sizeBytes: f.size,
        phaseKey: briefPhase.key,
        uploadedAt: new Date().toISOString(),
        clientVisible: false,
        ...(storageKey ? { storageKey, stored: true, version: 1 } : {}),
      });
      if (fileStorage) {
        // The notes are kept with the project's documents; they upload while the brief opens.
        for (const f of files) {
          uploadToProject(project.id, f).then(
            (storageKey) => addDocuments(project.id, [doc(f, storageKey)]),
            () => toast(`${f.name} couldn't be saved to documents`)
          );
        }
      } else {
        addDocuments(project.id, files.map((f) => doc(f)));
      }
    }
    toast(`Draft added to the ${briefLabel.toLowerCase()}`);
    router.push(briefHref);
  };

  const pickedCount = Object.values(picked).filter(Boolean).length;

  return (
    <div style={swatchVar(project.swatch)}>
      <FocusFrame
        exitHref={briefHref}
        exitLabel={`Back to ${briefLabel}`}
        title={`Draft the ${briefLabel.toLowerCase()}`}
        progress={stage === "add" ? 1 / 3 : stage === "drafting" ? 2 / 3 : 1}
        footer={
          stage === "add" ? (
            <>
              <span className="tiny muted">
                {live ? "You'll see the cost with the draft" : `About ${zar(DEMO_DRAFT_COST_ZAR)}`} · nothing is saved until you approve it
              </span>
              <button type="button" className="btn btn-accent btn-lg" disabled={!hasInput} onClick={() => void start()}>
                <Wand2 size={17} /> Draft it
              </button>
            </>
          ) : stage === "review" ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setStage("add")}>Start over</button>
              <button type="button" className="btn btn-accent btn-lg" disabled={!pickedCount} onClick={apply}>
                Add {pickedCount} to {briefLabel.toLowerCase()} <ArrowRight size={17} />
              </button>
            </>
          ) : undefined
        }
      >
        {stage === "add" && (
          <div className="rise">
            <p className="eyebrow" style={{ marginBottom: "1rem" }}>{project.name}</p>
            <h1 className="display-l" style={{ marginBottom: "0.75rem" }}>Drop in your meeting notes.</h1>
            <p className="muted" style={{ marginBottom: "2.25rem" }}>
              Word (.docx), PDF or text. You&apos;ll review every field before anything reaches the {briefLabel.toLowerCase()}.
            </p>

            {error && (
              <div className="card" role="alert" style={{ padding: "1rem 1.2rem", marginBottom: "1rem", borderColor: "var(--bad)" }}>
                <span className="small strong" style={{ color: "var(--bad)" }}>{error.message}</span>
                {error.setup && (
                  <p className="small muted" style={{ marginTop: "0.3rem" }}>
                    {viewer.isAdmin ? (
                      <>Choose a model and paste its key in <Link href="/settings" style={{ textDecoration: "underline" }}>Settings</Link>.</>
                    ) : (
                      "Ask your Admin to choose a model in Settings."
                    )}
                  </p>
                )}
              </div>
            )}

            <label
              className="dropzone"
              data-over={over}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]);
              }}
            >
              <input
                type="file"
                multiple
                accept=".txt,.md,.pdf,.docx"
                aria-label="Add meeting notes"
                onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])}
              />
              <span className="dropzone-icon"><UploadCloud size={24} /></span>
              <span style={{ fontWeight: 600 }}>Drop notes here, or browse</span>
              <span className="small muted">Several files are fine</span>
            </label>

            {files.length > 0 && (
              <div className="card" style={{ marginTop: "1rem" }}>
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="file-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
                    <span className="file-icon"><FileText size={16} /></span>
                    <span className="stack" style={{ minWidth: 0 }}>
                      <span className="small strong truncate">{f.name}</span>
                      <span className="tiny muted">{fileSize(f.size)}</span>
                    </span>
                    <button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ margin: "1.75rem 0 1rem", gap: "1rem" }}>
              <hr className="divider grow" />
              <span className="tiny muted">or paste them</span>
              <hr className="divider grow" />
            </div>
            <textarea
              className="textarea"
              rows={6}
              placeholder="Met the facilities manager on site. 140 people, budget about R 4.8m, two floors of 1,100 m² each…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
          </div>
        )}

        {stage === "drafting" && (
          <div className="rise" style={{ textAlign: "center", paddingTop: "2rem" }}>
            <div style={{ display: "grid", placeItems: "center", marginBottom: "2rem" }}>
              <ProgressRing
                value={tick / stages.length}
                size={96}
                stroke={5}
                color="var(--accent)"
                label={<Wand2 size={26} color="var(--accent)" />}
              />
            </div>
            <h1 className="display-m" style={{ marginBottom: "2rem" }}>Drafting your {briefLabel.toLowerCase()}…</h1>
            <ol className="stack" style={{ gap: "0.85rem", listStyle: "none", maxWidth: 340, margin: "0 auto", textAlign: "left" }}>
              {stages.map((s, i) => (
                <li key={s} className="row" style={{ gap: "0.75rem", opacity: i <= tick ? 1 : 0.35, transition: "opacity 300ms" }}>
                  <span
                    className="check-box"
                    style={
                      i < tick
                        ? { background: "var(--accent-fill)", borderColor: "var(--accent-fill)", color: "var(--accent-fill-ink)", width: 22, height: 22 }
                        : { width: 22, height: 22 }
                    }
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                  <span className="small" style={{ fontWeight: i === tick ? 600 : 500 }}>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {stage === "review" && draft && (
          <div className="rise">
            <p className="eyebrow" style={{ marginBottom: "1rem" }}>Draft ready · cost {zar(cost)}</p>
            <h1 className="display-l" style={{ marginBottom: "0.75rem" }}>Here&apos;s what I found.</h1>
            <p className="muted" style={{ marginBottom: "2rem" }}>
              Untick anything you don&apos;t want. Fields you already wrote are left alone unless you pick them.
            </p>
            <div className="card checklist">
              {fields.map((f) => {
                const on = !!picked[f.key];
                const existing = project.brief[f.key]?.trim();
                return (
                  <button
                    key={f.key}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className="check-row"
                    style={{ alignItems: "flex-start" }}
                    onClick={() => setPicked((p) => ({ ...p, [f.key]: !on }))}
                  >
                    <span className="check-box" style={on ? { background: "var(--ink)", borderColor: "var(--ink)", color: "var(--paper)" } : undefined}>
                      <Check size={15} strokeWidth={3} />
                    </span>
                    <span className="stack" style={{ minWidth: 0, gap: "0.2rem" }}>
                      <span className="eyebrow">{f.label}</span>
                      <span style={{ fontWeight: 500, color: on ? "var(--ink)" : "var(--ink-3)" }}>
                        {draft[f.key]?.trim() || <em className="muted">Not in the notes</em>}
                      </span>
                      {existing && existing !== draft[f.key] && (
                        <span className="tiny muted">{on ? "Replaces" : "Keeps"}: {existing}</span>
                      )}
                    </span>
                    <span />
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </FocusFrame>
    </div>
  );
}
