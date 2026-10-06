import { getWorkflow, getPhase } from "@/lib/workflow";
import type { ChecklistItem } from "@/lib/workflow/schema";
import type { Project } from "./types";

const DAY = 86_400_000;

export type PhaseState = "complete" | "current" | "upcoming";

export function phaseState(project: Project, phaseKey: string): PhaseState {
  if (project.completedPhases.includes(phaseKey)) return "complete";
  if (project.currentPhase === phaseKey) return "current";
  return "upcoming";
}

export function phaseProgress(project: Project, phaseKey: string) {
  const items = getPhase(project, phaseKey)?.checklist ?? [];
  const essentials = items.filter((i) => i.essential);
  const essentialDone = essentials.filter((i) => project.checks[i.id]).length;
  const done = items.filter((i) => project.checks[i.id]).length;
  return {
    items,
    done,
    total: items.length,
    essentialDone,
    essentialTotal: essentials.length,
    // A phase with no essential steps can be completed straight away.
    ready: essentialDone === essentials.length,
  };
}

/** 0..1 across the whole workflow, counting partial progress in the current phase. */
export function overallProgress(project: Project): number {
  const phases = getWorkflow(project).phases;
  if (project.status === "complete") return 1;
  const current = phaseProgress(project, project.currentPhase);
  const partial = current.total ? current.done / current.total : 0;
  return (project.completedPhases.length + partial) / phases.length;
}

export function phaseIndex(project: Project, phaseKey = project.currentPhase): number {
  return getWorkflow(project).phases.findIndex((p) => p.key === phaseKey);
}

export function dueDate(project: Project, item: ChecklistItem): Date | null {
  if (item.relativeDaysDue == null) return null;
  return new Date(new Date(project.startDate).getTime() + item.relativeDaysDue * DAY);
}

export interface NextStep {
  kind: "item" | "complete_phase" | "done";
  item?: ChecklistItem;
  due?: Date | null;
}

/** The single most useful thing to do next on a project. */
export function nextStep(project: Project): NextStep {
  if (project.status === "complete") return { kind: "done" };
  const { items, ready } = phaseProgress(project, project.currentPhase);
  const open = items.filter((i) => !project.checks[i.id]);
  const essential = open.find((i) => i.essential);
  if (essential) return { kind: "item", item: essential, due: dueDate(project, essential) };
  if (ready) return { kind: "complete_phase" };
  if (open[0]) return { kind: "item", item: open[0], due: dueDate(project, open[0]) };
  return { kind: "complete_phase" };
}

/** Order projects so the one that most needs attention comes first. */
export function byAttention(a: Project, b: Project): number {
  const rank = (p: Project) => (p.status !== "active" ? 2 : p.waitingOn === "me" ? 0 : 1);
  const diff = rank(a) - rank(b);
  if (diff) return diff;
  const da = nextStep(a).due?.getTime() ?? Infinity;
  const db = nextStep(b).due?.getTime() ?? Infinity;
  return da - db;
}
