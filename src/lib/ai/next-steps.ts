import type { Plan } from "@/lib/plan/geometry";
import { phaseProgress } from "@/lib/studio/selectors";
import { projectTasks, toDay } from "@/lib/studio/tasks";
import type { Project } from "@/lib/studio/types";
import { getForm, getPhase, getWorkflow } from "@/lib/workflow";
import { selectionSummary, type AssistantContext } from "./context";

/**
 * The most relevant next things to ask the assistant, shown under the chat at
 * all times: worked out from the project, the page she is on, what she has
 * selected and what was just done. No model call, so they cost nothing and
 * appear at once.
 */

export const MAX_SUGGESTIONS = 4;

interface Recent {
  /** The assistant just drew on the plan. */
  drewOnPlan?: boolean;
  /** Kinds of change it just made or proposed. */
  changed?: string[];
}

export function nextSteps(project: Project, plan: Plan | null, context?: AssistantContext, recent: Recent = {}, today = toDay(new Date())): string[] {
  const out: string[] = [];
  const add = (s: string | false | null | undefined) => {
    if (s && !out.includes(s)) out.push(s);
  };
  const page = context?.page ?? "other";
  const phase = getPhase(project, project.currentPhase);
  const progress = phaseProgress(project, project.currentPhase);
  const tasks = projectTasks(project);
  const open = tasks.filter((t) => !t.done && t.phaseKey === project.currentPhase);
  const overdue = tasks.filter((t) => !t.done && t.due && t.due < today);
  const levelId = context?.levelId ?? plan?.levels[0]?.id;
  const on = <T extends { levelId?: string }>(list: T[]) => list.filter((x) => x.levelId === levelId);

  // What she is pointing at comes first.
  if (plan && context?.selection.length) {
    const what = selectionSummary(plan, context.selection) || "the selection";
    const kinds = new Set(context.selection.map((s) => s.kind));
    if (kinds.has("item") || kinds.has("column")) add(`Make 3 copies of ${what} in a row, 1 m apart`);
    if (kinds.has("room")) add(`Furnish ${what}`);
    if (kinds.has("wall")) add(`Add a door in the middle of ${what}`);
    add(`What could be better about ${what}?`);
  }

  // What was just done suggests the follow-up.
  if (recent.drewOnPlan) {
    add("Check the plan for problems");
    add("Add dimensions to what you drew");
  }

  // The page she is on.
  if (page === "plan" || page === "layout") {
    if (!plan || !on(plan.walls).length) add("Draw an 8 × 6 m office shell with a door and two windows");
    else if (!on(plan.rooms).length) add("Mark the rooms on this floor");
    else if (!on(plan.items).length) {
      const biggest = [...on(plan.rooms)].sort((a, b) => b.points.length - a.points.length)[0];
      add(`Furnish ${biggest?.name ?? "the rooms"}`);
    } else add("How many more desks would fit?");
    if (page === "layout" && plan && !plan.layouts.length) add("Try layouts for the brief's headcount");
  }
  if (page === "timeline") {
    add("Push the schedule back a week");
    add("What's at risk of running late?");
  }
  if (page === "brief") {
    const empty = (getForm(project, "brief")?.fields ?? []).filter((f) => !project.brief[f.key]?.trim());
    add(empty.length ? `What's missing from the brief? (${empty.length} empty)` : "Summarise the brief for the client");
  }
  if (page === "documents") add("Which documents should the client see?");

  // The project itself.
  if (overdue.length) add(`Move my ${overdue.length} overdue task${overdue.length === 1 ? "" : "s"} to next week`);
  const essential = open.find((t) => t.essential && t.source === "step");
  if (essential) add(`Help me with "${essential.title}"`);
  if (phase && progress.ready && project.status === "active" && progress.total > 0 && progress.done === progress.total) add(`Complete ${phase.name}`);
  if (open.length && !open.some((t) => t.due)) add("Plan due dates for this phase");
  if (!out.length || page === "project" || page === "phase") add(phase ? `What's left in ${phase.name}?` : "What's left to do?");
  const next = getWorkflow(project).phases[getWorkflow(project).phases.findIndex((p) => p.key === project.currentPhase) + 1];
  if (next) add(`What should I prepare for ${next.name}?`);
  add("What should I do next?");
  return out.slice(0, MAX_SUGGESTIONS);
}
