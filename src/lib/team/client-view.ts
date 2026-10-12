import { z } from "zod";
import { getWorkflow } from "@/lib/workflow";
import { overallProgress, phaseState, type PhaseState } from "@/lib/studio/selectors";
import { phaseSpans } from "@/lib/studio/timeline";
import { stepDueDay } from "@/lib/studio/tasks";
import type { Project } from "@/lib/studio/types";

/**
 * The client's progress page: how far the project is, its timeline and the
 * steps the owner chose to show. Only the invited email address can open it.
 */
export const clientViewSettingsSchema = z
  .object({
    /** Phases the client sees; empty shows none. */
    phases: z.array(z.string().min(1).max(100)).max(100),
    /** Steps hidden inside the phases they see. */
    hiddenSteps: z.array(z.string().min(1).max(100)).max(1000),
    showTimeline: z.boolean(),
    showDocuments: z.boolean(),
    /** A short note from the studio at the top of the page. */
    note: z.string().max(2000),
  })
  .strict();
export type ClientViewSettings = z.infer<typeof clientViewSettingsSchema>;

export const newClientInviteSchema = z
  .object({
    email: z.email().max(255),
    settings: clientViewSettingsSchema,
  })
  .strict();

export interface ClientInvite {
  id: string;
  email: string;
  settings: ClientViewSettings;
  createdAt: string;
  revokedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
}

export function defaultClientSettings(project: Project): ClientViewSettings {
  return {
    phases: getWorkflow(project).phases.map((p) => p.key),
    hiddenSteps: [],
    showTimeline: true,
    showDocuments: true,
    note: "",
  };
}

export interface ClientPage {
  projectName: string;
  client: string;
  studio: string;
  note: string;
  status: "active" | "on_hold" | "complete";
  waitingOnClient: boolean;
  /** 0..100 across the whole workflow. */
  progress: number;
  currentPhase: string | null;
  phases: {
    key: string;
    name: string;
    state: PhaseState;
    start: string | null;
    end: string | null;
    steps: { id: string; text: string; done: boolean; due: string | null }[];
  }[];
  documents: { id: string; name: string; phaseKey: string; sizeBytes: number; downloadable: boolean }[];
}

/** What the client sees, from the project and the owner's choices. Pure, so the owner's preview matches. */
export function clientPage(project: Project, settings: ClientViewSettings, studio: string): ClientPage {
  const workflow = getWorkflow(project);
  const shown = new Set(settings.phases);
  const spans = new Map(phaseSpans(project).map((s) => [s.key, s]));
  const phases = workflow.phases
    .filter((p) => shown.has(p.key))
    .map((p) => {
      const span = spans.get(p.key);
      return {
        key: p.key,
        name: p.name,
        state: phaseState(project, p.key),
        start: settings.showTimeline ? (span?.start ?? null) : null,
        end: settings.showTimeline ? (span?.end ?? null) : null,
        steps: p.checklist
          .filter((i) => !settings.hiddenSteps.includes(i.id))
          .map((i) => ({
            id: i.id,
            text: i.text,
            done: !!project.checks[i.id],
            due: settings.showTimeline ? (stepDueDay(project, i, p.key) ?? null) : null,
          })),
      };
    });
  const current = workflow.phases.find((p) => p.key === project.currentPhase);
  return {
    projectName: project.name,
    client: project.client,
    studio,
    note: settings.note,
    status: project.status,
    waitingOnClient: project.waitingOn === "client" && project.status === "active",
    progress: Math.round(overallProgress(project) * 100),
    currentPhase: current && shown.has(current.key) ? current.name : null,
    phases,
    documents: settings.showDocuments
      ? project.documents
          .filter((d) => d.clientVisible && shown.has(d.phaseKey))
          .map((d) => ({
            id: d.id,
            name: d.name,
            phaseKey: d.phaseKey,
            sizeBytes: d.sizeBytes,
            downloadable: !!d.stored,
          }))
      : [],
  };
}

/** Settings are trimmed to the project's current phases and steps. */
export function tidyClientSettings(project: Project, settings: ClientViewSettings): ClientViewSettings {
  const phases = getWorkflow(project).phases;
  const keys = new Set(phases.map((p) => p.key));
  const steps = new Set(phases.flatMap((p) => p.checklist.map((i) => i.id)));
  return {
    ...settings,
    phases: [...new Set(settings.phases.filter((k) => keys.has(k)))],
    hiddenSteps: [...new Set(settings.hiddenSteps.filter((k) => steps.has(k)))],
    note: settings.note.trim(),
  };
}

/** Email addresses are compared the way they are stored: trimmed and lower case. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}
