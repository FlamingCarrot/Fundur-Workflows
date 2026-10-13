import { z } from "zod";
import type { AssistantAction } from "@/lib/ai/actions";
import type { ProjectMutation } from "@/lib/projects/mutations";
import { phaseProgress } from "@/lib/studio/selectors";
import { projectTasks, toDay } from "@/lib/studio/tasks";
import type { Project } from "@/lib/studio/types";
import { getForm, getPhase, getWorkflow, label, phaseWithForm } from "@/lib/workflow";
import type { MoneyFacts } from "@/lib/business/overview";

/**
 * The autopilot drives a project through its workflow: it works out what is
 * next, does what it can with the assistant's tools, and asks the designer
 * only for what it cannot know or decide. This file is the part that needs no
 * database or model: how much it may do where, which of its changes apply at
 * once, and what is on its agenda.
 */

/**
 * How much the autopilot does, for the project, a phase or a step:
 * - auto: it does the work; small changes that can be undone apply at once.
 * - review: it does the work, and every change waits for her.
 * - ask: it does no work there, only asks or reminds.
 * - off: it leaves it alone.
 */
export const LEVELS = ["auto", "review", "ask", "off"] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, { name: string; hint: string }> = {
  auto: { name: "Do it", hint: "Does the work; small changes apply at once with Undo" },
  review: { name: "Do it, I review", hint: "Does the work; every change waits for you" },
  ask: { name: "Ask me", hint: "Only asks or reminds you" },
  off: { name: "Leave to me", hint: "Doesn't touch it" },
};

export const CADENCES = ["twice_daily", "daily", "weekly", "manual"] as const;
export type Cadence = (typeof CADENCES)[number];

export const CADENCE_LABELS: Record<Cadence, string> = {
  twice_daily: "Twice a day",
  daily: "Every day",
  weekly: "Every week",
  manual: "Only when I press Run",
};

/** Hours between scheduled looks; null for manual. */
export function cadenceHours(cadence: Cadence): number | null {
  return cadence === "twice_daily" ? 12 : cadence === "daily" ? 24 : cadence === "weekly" ? 168 : null;
}

const level = z.enum(LEVELS);

export const autopilotLevels = z.object({
  /** The level for anything not set more closely. */
  project: level.default("auto"),
  phases: z.record(z.string().max(100), level).default({}),
  steps: z.record(z.string().max(100), level).default({}),
  /** Draft a short update for the client each week, for her to send. */
  clientUpdates: z.boolean().default(true),
  /** The business side: proposals, invoices, payment reminders and supplier orders (always drafts she sends). */
  money: level.default("auto"),
});
export type AutopilotLevels = z.infer<typeof autopilotLevels>;

export const DEFAULT_LEVELS: AutopilotLevels = { project: "auto", phases: {}, steps: {}, clientUpdates: true, money: "auto" };

/** Scheduled and visit runs per project per day; Run now is not counted. */
export const MAX_RUNS_PER_DAY = 4;

/** The level for a phase: its own, else the project's. */
export function phaseLevel(levels: AutopilotLevels, phaseKey: string): Level {
  return levels.phases[phaseKey] ?? levels.project;
}

/** The phase a workflow step belongs to; undefined for an id that is not a step. */
export function stepPhase(project: Project, itemId: string): string | undefined {
  return getWorkflow(project).phases.find((p) => p.checklist.some((i) => i.id === itemId))?.key;
}

/** The level for a step: its own, else its phase's, else the project's. */
export function stepLevel(levels: AutopilotLevels, project: Project, itemId: string): Level {
  if (levels.steps[itemId]) return levels.steps[itemId];
  const phase = stepPhase(project, itemId);
  return phase ? phaseLevel(levels, phase) : levels.project;
}

const RANK: Record<Level, number> = { auto: 0, review: 1, ask: 2, off: 3 };
const strictest = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b);

export type Decision = { decision: "apply" | "review" } | { decision: "refuse"; reason: string };

function isEssential(project: Project, itemId: string): boolean {
  return getWorkflow(project).phases.some((p) => p.checklist.some((i) => i.id === itemId && i.essential));
}

/** The level that governs one change, and whether it must wait for her whatever the level. */
function judge(project: Project, levels: AutopilotLevels, m: ProjectMutation): { level: Level; mustReview: boolean } {
  const current = phaseLevel(levels, project.currentPhase);
  switch (m.type) {
    case "setCheck":
      // Ticking an essential step records her decision, so it always waits for her.
      return { level: stepLevel(levels, project, m.itemId), mustReview: isEssential(project, m.itemId) };
    case "setStepDue":
    case "setStepOutput":
      return { level: stepLevel(levels, project, m.itemId), mustReview: false };
    case "addTask":
      return { level: phaseLevel(levels, m.phaseKey), mustReview: false };
    case "updateTask": {
      const task = project.tasks.find((t) => t.id === m.taskId);
      return { level: task ? phaseLevel(levels, task.phaseKey) : current, mustReview: false };
    }
    case "setPhaseStart":
      return { level: phaseLevel(levels, m.phaseKey), mustReview: false };
    // Anything the client sees, and anything final, is hers to say yes to.
    case "setClientVisible":
    case "completePhase":
    case "deleteTask":
    case "deleteRegulation":
    case "customizeWorkflow":
    case "updateDetails":
    case "restoreBrief":
    case "restoreDocumentVersion":
      return { level: current, mustReview: true };
    case "updateBrief": {
      const phase = phaseWithForm(project, "brief")?.key;
      return { level: phase ? phaseLevel(levels, phase) : current, mustReview: false };
    }
    default:
      return { level: current, mustReview: false };
  }
}

/**
 * Whether one change the autopilot wants to make applies at once, waits for
 * her, or is not its to make. Changes the assistant could not apply directly
 * anyway (big or not undoable) wait for her too; that is decided where they
 * are applied.
 */
export function autopilotDecision(project: Project, levels: AutopilotLevels, action: AssistantAction): Decision {
  if (action.type === "createProject") return { decision: "refuse", reason: "The autopilot does not start projects." };
  if (action.type === "planEdit" || action.type === "boardEdit") return phaseLevel(levels, project.currentPhase) === "auto" ? { decision: "apply" } : { decision: "review" };
  const list = action.type === "batch" ? action.mutations : [action];
  let lvl: Level = "auto";
  let mustReview = false;
  for (const m of list) {
    const j = judge(project, levels, m);
    lvl = strictest(lvl, j.level);
    mustReview ||= j.mustReview;
  }
  if (lvl === "off") return { decision: "refuse", reason: "She asked the autopilot to leave this to her. Do not change it." };
  if (lvl === "ask") return { decision: "refuse", reason: "She asked to be asked about this rather than have it done. Use ask_user instead." };
  return { decision: lvl === "review" || mustReview ? "review" : "apply" };
}

/** Tools the autopilot is never offered: they reach outside the project, or change shared things. */
export const AUTOPILOT_EXCLUDED_TOOLS = new Set([
  "create_project",
  "edit_blueprint",
  "edit_material",
  "blueprint_from_plan",
  "set_member_access",
  "post_team_message",
  "add_team_comment",
]);

/** Tools that draft proposals, invoices and orders; not offered when money is set to Ask me or Leave to me. */
export const AUTOPILOT_MONEY_TOOLS = new Set(["draft_invoice", "draft_proposal", "draft_purchase_orders"]);

/** Tools that change the floor plan as they run, so only offered where she lets it act. */
export const AUTOPILOT_PLAN_TOOLS = new Set(["edit_plan"]);

export interface AnsweredAsk {
  id: string;
  title: string;
  answer: string;
  files: string[];
}

export interface OpenAsk {
  id: string;
  title: string;
}

export type AgendaKind = "answer" | "step" | "brief" | "schedule" | "overdue" | "complete_phase" | "client_update" | "waiting" | "money";

export interface AgendaItem {
  kind: AgendaKind;
  text: string;
  level: Level;
  phaseKey?: string;
  stepItemId?: string;
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY);

/**
 * What the autopilot should look at on this run, most important first: her
 * answers to its questions, then the current phase's open steps (essential and
 * soonest first), the brief, dates, overdue work, a phase ready to complete,
 * and the client. Worked out from the project with no model call, so a run
 * with an empty agenda costs nothing.
 */
export function autopilotAgenda(
  project: Project,
  levels: AutopilotLevels,
  opts: { answered?: AnsweredAsk[]; openAsks?: OpenAsk[]; lastClientUpdate?: string | null; today?: string; money?: MoneyFacts | null } = {}
): AgendaItem[] {
  if (project.status !== "active") return [];
  const today = opts.today ?? toDay(new Date());
  const out: AgendaItem[] = [];
  const phaseKey = project.currentPhase;
  const phase = getPhase(project, phaseKey);
  const pLevel = phaseLevel(levels, phaseKey);

  for (const a of opts.answered ?? []) {
    out.push({
      kind: "answer",
      level: "auto",
      text: `She answered "${a.title}": ${a.answer || "(no words)"}${a.files.length ? ` [files added to the project: ${a.files.join(", ")}]` : ""}`,
    });
  }

  const tasks = projectTasks(project);
  const asked = new Set((opts.openAsks ?? []).map((a) => a.title));
  const open = tasks
    .filter((t) => t.phaseKey === phaseKey && !t.done)
    .sort((a, b) => Number(b.essential) - Number(a.essential) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  for (const t of open.slice(0, 6)) {
    const lvl = t.source === "step" ? stepLevel(levels, project, t.id) : pLevel;
    if (lvl === "off") continue;
    const due = t.due ? (t.due < today ? `overdue since ${t.due}` : `due ${t.due}`) : "no date";
    out.push({
      kind: "step",
      level: lvl,
      phaseKey,
      stepItemId: t.source === "step" ? t.id : undefined,
      text: `${t.source === "step" ? "Step" : "Her task"} "${t.title}" (id ${t.id}${t.essential ? ", essential" : ""}, ${due})`,
    });
  }

  const briefPhase = phaseWithForm(project, "brief")?.key;
  const fields = getForm(project, "brief")?.fields ?? [];
  const empty = fields.filter((f) => !project.brief[f.key]?.trim());
  if (briefPhase === phaseKey && empty.length && pLevel !== "off") {
    out.push({
      kind: "brief",
      level: pLevel,
      phaseKey,
      text: `${label(project, "brief", "Brief")}: ${empty.length} of ${fields.length} fields empty (${empty
        .slice(0, 6)
        .map((f) => f.label)
        .join(", ")}). ${project.documents.length ? "Draft them from the project's documents." : "There are no documents yet to draft from; ask her for meeting notes or a file."}`,
    });
  }

  const undated = open.filter((t) => !t.due);
  if (undated.length >= 2 && pLevel !== "off") {
    out.push({ kind: "schedule", level: pLevel, phaseKey, text: `${undated.length} open items in ${phase?.name ?? phaseKey} have no due date; plan them around the phase's dates.` });
  }

  const overdue = tasks.filter((t) => !t.done && t.due && t.due < today && t.phaseKey !== phaseKey);
  if (overdue.length) {
    out.push({ kind: "overdue", level: pLevel, text: `${overdue.length} items in other phases are overdue (${overdue.slice(0, 3).map((t) => `"${t.title}"`).join(", ")}).` });
  }

  const progress = phaseProgress(project, phaseKey);
  if (progress.ready && progress.total > 0 && !asked.has(`Complete ${phase?.name}?`)) {
    out.push({ kind: "complete_phase", level: "review", phaseKey, text: `Every essential step of ${phase?.name ?? phaseKey} is ticked: check readiness and propose completing the phase (she confirms).` });
  }

  if (project.waitingOn === "client" && days(project.lastActivity, today) >= 3) {
    out.push({ kind: "waiting", level: "ask", text: `The project has waited on the client for ${days(project.lastActivity, today)} days. Draft a friendly nudge for her to send.` });
  }

  if (levels.clientUpdates && pLevel !== "off" && (!opts.lastClientUpdate || days(opts.lastClientUpdate, today) >= 7)) {
    out.push({ kind: "client_update", level: "review", text: "No client update in the last week: draft one from what changed (draft_client_update), for her to send." });
  }

  const m = opts.money;
  if (m && levels.money !== "off") {
    const rand = (c: number) => `R${Math.round(c / 100).toLocaleString("en-ZA")}`;
    const first = getWorkflow(project).phases[0]?.key === phaseKey;
    if (!m.hasProposal && first) out.push({ kind: "money", level: levels.money, text: "There is no fee proposal yet: draft one (draft_proposal) from the brief and the workflow's phases, for her to check and send." });
    if (m.acceptedNotInvoiced && !m.draftInvoices)
      out.push({ kind: "money", level: levels.money, text: `${m.acceptedNotInvoiced.by} accepted "${m.acceptedNotInvoiced.title}": draft the first invoice (draft_invoice, with the deposit or first fee stage the proposal sets as feeLines; read_project_money shows its lines), for her to send.` });
    else if (m.unbilledCents >= 500_000 && !m.draftInvoices)
      out.push({ kind: "money", level: levels.money, text: `${rand(m.unbilledCents)} of design time (${Math.round(m.unbilledMinutes / 6) / 10} h) is not billed: draft an invoice (draft_invoice), adding the fee stage the accepted proposal sets for this phase if there is one.` });
    for (const o of m.overdue.slice(0, 2))
      out.push({ kind: "money", level: levels.money, text: `Invoice ${o.number} (${rand(o.totalCents)}) has been overdue since ${o.dueDate}: draft a polite payment reminder for her to send (draft_client_update).` });
    if (m.itemsToOrder && !m.draftOrders) out.push({ kind: "money", level: levels.money, text: `${m.itemsToOrder} items in the register are priced, have a supplier and are still to order: draft purchase orders (draft_purchase_orders).` });
    if (m.overBudgetCents) out.push({ kind: "money", level: "ask", text: `The items specified are ${rand(m.overBudgetCents)} over the item budget: ask her whether to raise the budget or look for cheaper options.` });
  }

  // Only the client update: nothing really needs doing, so it waits for real work.
  if (out.length === 1 && out[0].kind === "client_update" && !open.length) return [];
  return out;
}

/** The instructions the autopilot works under, added to the assistant's own. */
export function autopilotInstructions(levels: AutopilotLevels, project: Project): string {
  const phases = getWorkflow(project)
    .phases.map((p) => `${p.name}: ${LEVEL_LABELS[phaseLevel(levels, p.key)].name}`)
    .join("; ");
  const steps = Object.entries(levels.steps)
    .map(([id, l]) => `${id}: ${LEVEL_LABELS[l].name}`)
    .join("; ");
  return [
    "",
    "<autopilot>",
    "You are running as the project's autopilot, on your own: nobody is reading along. Your job is to move the project forward through its workflow on her behalf, doing everything you responsibly can and asking her only for what you cannot know or decide.",
    "Work through the agenda in the message, most important first. For each item: do the work with your tools where the level allows (draft the brief from documents, plan dates, add the tasks the step needs, prepare form drafts, draft quote requests, specifications and client messages, try layouts when the plan is ready), then check the result.",
    "Levels she set: \"Do it\" means act; \"Do it, I review\" means act, and your changes wait for her; \"Ask me\" means do not act, use ask_user; \"Leave to me\" means do not touch it. A change the tools refuse is not yours to make: do not retry it another way.",
    "Never invent facts: meeting outcomes, client decisions, measurements, prices, approvals or compliance. When you need any of these, or a file, a choice between options, or her sign-off, call ask_user once per real need, short and specific, with options when there are clear choices. Do not ask what you can find in the project, and do not repeat a question already open.",
    "Ticking essential steps, completing a phase, sharing with the client and anything sent outside the studio always wait for her. Tick a non-essential step only when your own work finished it.",
    "When the project waits on the client or on her answer, call set_next_check with when it is worth looking again.",
    "End with two to four short sentences for her: what you did, what is waiting for her, and what you will do next. No headings.",
    `Levels by phase: ${phases}.${steps ? ` Steps set apart: ${steps}.` : ""} Money (proposals, invoices, reminders, orders): ${LEVEL_LABELS[levels.money].name}. Every proposal, invoice and order you make is a draft she checks and sends; never mark anything sent or paid.`,
    "</autopilot>",
  ].join("\n");
}

/** The message a run starts from: today's agenda for the project. */
export function agendaMessage(agenda: AgendaItem[], recent: string[], openAsks: OpenAsk[]): string {
  return [
    "Autopilot run. Today's agenda, most important first:",
    ...agenda.map((a, i) => `${i + 1}. [${LEVEL_LABELS[a.level].name}] ${a.text}`),
    ...(openAsks.length ? ["", "Questions already waiting for her (do not ask again):", ...openAsks.map((a) => `- ${a.title}`)] : []),
    ...(recent.length ? ["", "What your last runs said:", ...recent.map((r) => `- ${r}`)] : []),
  ].join("\n");
}
