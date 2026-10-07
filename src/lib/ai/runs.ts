import { assertAiAllowance } from "@/lib/billing/guard";
import type { Db } from "@/lib/db";
import { assertWithinBudget, checkBudget, type BudgetAlert } from "./budget";
import { chat as streamChat, type ChatFn, type ChatRequest, type ChatResult } from "./chat-stream";
import { complete, ProviderError, ProviderKeyError, ProviderRefusalError, type Completion, type CompletionRequest } from "./providers";
import { modelsForTier, readTaskRoute, type ModelChoice, type Tier } from "./routing";
import { readProviderKey } from "./settings";

/**
 * Every AI call goes through here. The task type picks the tier (top model or
 * worker, P4-13); if the tier's model fails, its fallback answers instead
 * (P4-09). Each attempt is logged with its model, tokens, cost, phase and task
 * whether it worked or not, and costs shown in the app are sums of this log
 * (P4-15). After each call the project's budget is checked (P4-16).
 */

/** No model or key has been set up on the settings page yet. */
export class AiNotConfiguredError extends Error {}

export type RunRole = "orchestrator" | "worker" | "reviewer";

export interface RunContext {
  workspaceId: string;
  /** The project's database id (not its slug). */
  projectId: string;
  userId: string;
  /** The task type, e.g. "brief_draft"; it decides the tier. */
  task: string;
  /** The phase the work belongs to; the project's current phase when left out. */
  phaseKey?: string;
  /** The task the work was asked from, if any: a step's checklist item id or her own task's id. */
  taskId?: string;
  /** The chat message the work answers, so a reply's cost is the sum of its calls. */
  chatMessageId?: string;
  /** What the call does: the orchestrator's own turn, a worker's task, or a review. */
  role?: RunRole;
  /** The review gate's attempt number, from 1. */
  attempt?: number;
  /** Run on this tier regardless of the task type's route (the review gate uses "top"). */
  tier?: Tier;
  /** Told about budget alerts as they fire. */
  onAlert?: (alert: BudgetAlert) => void;
}

export interface AiRunResult extends Completion {
  costUsd: number;
  costZar: number;
  model: string;
  provider: string;
  /** True when the tier's fallback model answered. */
  fallback: boolean;
}

export function costOf(
  usage: { inputTokens: number; outputTokens: number; reportedCostUsd?: number },
  prices: { inputUsdPerMTok: number; outputUsdPerMTok: number }
): number {
  if (usage.reportedCostUsd != null) return usage.reportedCostUsd;
  return (usage.inputTokens * prices.inputUsdPerMTok + usage.outputTokens * prices.outputUsdPerMTok) / 1_000_000;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** Errors that mean the model, its provider or its key failed, so the fallback should try. Refusals do not count. */
const isModelFailure = (err: unknown) =>
  err instanceof ProviderKeyError || (err instanceof ProviderError && !(err instanceof ProviderRefusalError));

async function logRun(
  db: Db,
  ctx: RunContext,
  choice: ModelChoice,
  fallback: boolean,
  outcome: "success" | "failed",
  usage: Partial<Completion>,
  error?: string
) {
  const usd = costOf(
    { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, reportedCostUsd: usage.reportedCostUsd },
    choice
  );
  const zar = usd * choice.zarPerUsd;
  await db.query(
    `INSERT INTO ai_runs (workspace_id, project_id, user_id, task_name, model_name, provider,
       prompt_tokens, completion_tokens, cost_usd, cost_zar, outcome, error,
       phase_key, task_ref, chat_message_id, role, attempt, fallback)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       COALESCE($13, (SELECT current_phase_key FROM projects WHERE id = $2)), $14, $15, $16, $17, $18)`,
    [ctx.workspaceId, ctx.projectId, ctx.userId, ctx.task, choice.model, choice.provider,
      usage.inputTokens ?? 0, usage.outputTokens ?? 0, round(usd, 6), round(zar, 4), outcome, error ?? null,
      ctx.phaseKey ?? null, ctx.taskId ?? null, ctx.chatMessageId ?? null, ctx.role ?? "orchestrator", ctx.attempt ?? 1, fallback]
  );
  if (usd > 0) for (const alert of await checkBudget(db, ctx.workspaceId, ctx.projectId)) ctx.onAlert?.(alert);
  return { usd, zar };
}

/**
 * Runs `call` on the tier's model and, when that model fails, on its
 * fallback. `canFallback` lets a streamed call refuse to switch models once
 * words have reached the designer.
 */
async function withModels<T extends Completion>(
  db: Db,
  ctx: RunContext,
  call: (choice: ModelChoice, key: string) => Promise<T>,
  canFallback: () => boolean = () => true
): Promise<T & AiRunResult> {
  await assertWithinBudget(db, ctx.workspaceId, ctx.projectId);
  await assertAiAllowance(db, ctx.workspaceId, ctx.userId);
  const tier = ctx.tier ?? (await readTaskRoute(db, ctx.task)).tier;
  const choices = await modelsForTier(db, tier);
  let lastError: unknown = null;
  let tried = 0;
  for (const [i, choice] of choices.entries()) {
    const key = await readProviderKey(db, choice.provider);
    if (!key) continue;
    if (tried > 0 && !canFallback()) break;
    tried++;
    const fallback = i > 0;
    let result: T;
    try {
      result = await call(choice, key);
    } catch (err) {
      // A refused or cut-off answer still used (and billed) tokens.
      const usage = err as Partial<Completion>;
      await logRun(db, ctx, choice, fallback, "failed", { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, (err as Error).message.slice(0, 1000));
      lastError = err;
      if (isModelFailure(err)) continue;
      throw err;
    }
    const { usd, zar } = await logRun(db, ctx, choice, fallback, "success", result);
    return { ...result, costUsd: usd, costZar: zar, model: choice.model, provider: choice.provider, fallback };
  }
  if (lastError) throw lastError;
  throw new AiNotConfiguredError(tier === "top" ? "No AI model is set up yet" : "No worker model is set up yet");
}

/** One request and its answer, on the model the task type is routed to. */
export async function runAi(
  db: Db,
  ctx: RunContext,
  req: Omit<CompletionRequest, "model">,
  fetchImpl?: typeof fetch
): Promise<AiRunResult> {
  return withModels(db, ctx, (choice, key) => complete(choice.provider, key, { ...req, model: choice.model }, fetchImpl));
}

/**
 * One streamed chat turn on the top model. The fallback answers only if the
 * first model failed before writing anything, so the designer never sees two
 * half answers run together.
 */
export async function runChat(
  db: Db,
  ctx: RunContext,
  req: Omit<ChatRequest, "model">,
  onText: (delta: string) => void,
  deps: { chat?: ChatFn; fetchImpl?: typeof fetch } = {}
): Promise<ChatResult & AiRunResult> {
  let wrote = false;
  const chatFn = deps.chat ?? streamChat;
  return withModels(
    db,
    { ...ctx, tier: "top", role: ctx.role ?? "orchestrator" },
    (choice, key) =>
      chatFn(
        choice.provider,
        key,
        { ...req, model: choice.model },
        (delta) => {
          wrote = true;
          onText(delta);
        },
        deps.fetchImpl
      ),
    () => !wrote
  );
}
