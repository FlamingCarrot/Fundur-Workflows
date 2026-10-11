import { getForm, getWorkflow, label } from "./index";
import { phaseProgress, phaseState } from "@/lib/studio/selectors";
import type { Project } from "@/lib/studio/types";

/** Saved evidence only. Empty fields are guidance, never additional completion gates. */
export function phaseGuidance(project: Project, phaseKey: string) {
  const workflow = getWorkflow(project);
  const phase = workflow.phases.find((p) => p.key === phaseKey);
  if (!phase) return null;
  const progress = phaseProgress(project, phaseKey);
  const forms = phase.modules.flatMap((ref) => {
    if (!ref.startsWith("structured_form:")) return [];
    const key = ref.slice("structured_form:".length);
    const form = getForm(project, key);
    if (!form) return [];
    const values = key === "brief" ? project.brief : project.formValues?.[key];
    const missing = form.fields.filter((f) => !values?.[f.key]?.trim());
    return [{ key, name: label(project, key, key), total: form.fields.length,
      filled: form.fields.length - missing.length, missing: missing.map((f) => f.label),
      href: `/projects/${project.id}/${key === "brief" ? "brief" : `forms/${key}`}` }];
  });
  const openEssentials = progress.items.filter((i) => i.essential && !project.checks[i.id]);
  return {
    phase, state: phaseState(project, phaseKey), progress, forms, openEssentials,
    documents: project.documents.filter((d) => d.phaseKey === phaseKey),
    incoming: workflow.handoffs.filter((h) => h.to.split(".")[0] === phaseKey),
    outgoing: workflow.handoffs.filter((h) => h.from.split(".")[0] === phaseKey),
    canComplete: project.status === "active" && phaseState(project, phaseKey) === "current" && progress.ready,
    reviewPrompt: `Review phase "${phase.name}" (key: ${phase.key}) using saved project facts, forms, documents and checklists. Identify missing evidence and open essentials. Recommend the next three practical actions, and prepare editable proposals where useful. Do not invent evidence, tick steps, approve compliance or complete the phase.`,
  };
}

export function phaseAssistantSuggestions(project: Project, phaseKey = project.currentPhase) {
  const phase = getWorkflow(project).phases.find((p) => p.key === phaseKey);
  if (!phase) return [];
  return [
    { label: "What should I do next?", prompt: `Read the saved context for phase "${phase.name}" (key: ${phase.key}). Prioritise the next three actions and identify missing evidence.` },
    ...phase.ai_actions.slice(0, 3).map((a) => ({ label: a.name, prompt: `Help with "${a.name}" in phase "${phase.name}" (key: ${phase.key}). ${a.description} Read saved context first, identify unknowns, and prepare editable proposals for my review. Do not assume this action has run or claim changes are saved.` })),
    { label: "Prepare a handoff", prompt: `Draft a handoff for phase "${phase.name}" (key: ${phase.key}) from saved facts. Include confirmed decisions, outputs, open questions and next-phase dependencies. Distinguish missing evidence from completed work. Propose phase notes for my review if this workflow supports them.` },
  ];
}
