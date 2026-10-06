import type { Db } from "@/lib/db";
import { AiBudgetError, assertWithinBudget } from "./budget";
import type { CompletionRequest } from "./providers";
import { readTaskRoute } from "./routing";
import { runAi, type RunContext } from "./runs";

/**
 * The review gate (P4-14). Work routed to a worker model is checked by the top
 * model before it is used. A failing answer goes back to the worker with the
 * reviewer's feedback, up to the task type's retry cap; after that the last
 * answer comes back flagged, so it reaches the designer marked as unchecked
 * rather than passed off as good. Work routed to the top model is not
 * reviewed again.
 */

export interface ReviewedResult {
  text: string;
  /** False when the answer still failed review at the cap. */
  passed: boolean;
  /** Whether the review gate ran at all (only for worker output). */
  reviewed: boolean;
  attempts: number;
  /** The reviewer's last feedback on a failing answer. */
  feedback?: string;
  costZar: number;
  model: string;
}

export interface ReviewVerdict {
  pass: boolean;
  feedback: string;
}

export const REVIEW_SCHEMA = {
  type: "object",
  properties: { pass: { type: "boolean" }, feedback: { type: "string" } },
  required: ["pass", "feedback"],
  additionalProperties: false,
};

export function reviewPrompt(task: string, req: { system: string; prompt: string }, answer: string): { system: string; prompt: string } {
  return {
    system: [
      "You review work a cheaper model did before it reaches an interior designer.",
      "Pass it only if it does what the instructions ask, invents nothing that is not in the input, and is ready to use as is.",
      "Small matters of taste are not reasons to fail. When it fails, say exactly what to fix, in one or two sentences.",
      'Answer with JSON only: {"pass": true|false, "feedback": "..."}',
    ].join("\n"),
    prompt: [
      `<task type="${task}">`,
      `<instructions>\n${req.system}\n</instructions>`,
      `<input>\n${req.prompt}\n</input>`,
      "</task>",
      `<answer>\n${answer}\n</answer>`,
    ].join("\n"),
  };
}

export function parseVerdict(text: string): ReviewVerdict {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as Partial<ReviewVerdict>;
    if (typeof v.pass === "boolean") return { pass: v.pass, feedback: typeof v.feedback === "string" ? v.feedback.trim() : "" };
  } catch {
    // fall through
  }
  // An unreadable verdict is a failed review: nothing unchecked passes.
  return { pass: false, feedback: "The review could not be read." };
}

function retryPrompt(prompt: string, previous: string, feedback: string): string {
  return [
    prompt,
    `<previous_answer>\n${previous}\n</previous_answer>`,
    `<reviewer_feedback>\n${feedback}\n</reviewer_feedback>`,
    "Your previous answer did not pass review. Answer again, fixing what the reviewer said.",
  ].join("\n\n");
}

/** Runs a task on its routed tier and, for worker output, through the review gate. */
export async function runReviewed(
  db: Db,
  ctx: RunContext,
  req: Omit<CompletionRequest, "model">,
  fetchImpl?: typeof fetch
): Promise<ReviewedResult> {
  const route = await readTaskRoute(db, ctx.task);
  if (route.tier === "top") {
    const run = await runAi(db, { ...ctx, role: ctx.role ?? "orchestrator" }, req, fetchImpl);
    return { text: run.text, passed: true, reviewed: false, attempts: 1, costZar: run.costZar, model: run.model };
  }

  let costZar = 0;
  let prompt = req.prompt;
  let last = { text: "", model: "" };
  let feedback = "";
  const tries = route.maxRetries + 1;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const work = await runAi(db, { ...ctx, role: "worker", attempt }, { ...req, prompt }, fetchImpl);
    costZar += work.costZar;
    last = { text: work.text, model: work.model };

    const review = await runAi(
      db,
      { ...ctx, role: "reviewer", attempt, tier: "top" },
      { ...reviewPrompt(ctx.task, req, work.text), schema: REVIEW_SCHEMA, maxTokens: 1_000 },
      fetchImpl
    );
    costZar += review.costZar;
    const verdict = parseVerdict(review.text);
    if (verdict.pass) return { text: work.text, passed: true, reviewed: true, attempts: attempt, costZar, model: work.model };
    feedback = verdict.feedback;
    if (attempt < tries) {
      prompt = retryPrompt(req.prompt, work.text, feedback);
      // A used-up budget stops the loop here rather than at the next call.
      try {
        await assertWithinBudget(db, ctx.workspaceId, ctx.projectId);
      } catch (err) {
        if (err instanceof AiBudgetError) return { text: last.text, passed: false, reviewed: true, attempts: attempt, feedback, costZar, model: last.model };
        throw err;
      }
    }
  }
  return { text: last.text, passed: false, reviewed: true, attempts: tries, feedback, costZar, model: last.model };
}
