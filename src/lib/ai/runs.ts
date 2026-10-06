import type { Db } from "@/lib/db";
import { complete, type Completion, type CompletionRequest } from "./providers";
import { readDefaultModel, readProviderKey } from "./settings";

/**
 * Every AI call goes through runAi: it uses the Admin's default model and key,
 * and logs the call with its model, tokens and cost whether it worked or not.
 * Costs shown in the app are sums of this log.
 */

/** No model or key has been set up on the settings page yet. */
export class AiNotConfiguredError extends Error {}

export interface RunContext {
  workspaceId: string;
  /** The project's database id (not its slug). */
  projectId: string;
  userId: string;
  /** What the call was for, e.g. "brief_draft". */
  task: string;
}

export interface AiRunResult extends Completion {
  costUsd: number;
  costZar: number;
  model: string;
}

export function costOf(
  usage: { inputTokens: number; outputTokens: number; reportedCostUsd?: number },
  prices: { inputUsdPerMTok: number; outputUsdPerMTok: number }
): number {
  if (usage.reportedCostUsd != null) return usage.reportedCostUsd;
  return (usage.inputTokens * prices.inputUsdPerMTok + usage.outputTokens * prices.outputUsdPerMTok) / 1_000_000;
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

export async function runAi(
  db: Db,
  ctx: RunContext,
  req: Omit<CompletionRequest, "model">,
  fetchImpl?: typeof fetch
): Promise<AiRunResult> {
  const setting = await readDefaultModel(db);
  const key = setting && (await readProviderKey(db, setting.provider));
  if (!setting || !key) throw new AiNotConfiguredError("No AI model is set up yet");

  const log = async (outcome: "success" | "failed", usage: Partial<Completion>, error?: string) => {
    const usd = costOf({ inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, reportedCostUsd: usage.reportedCostUsd }, setting);
    const zar = usd * setting.zarPerUsd;
    await db.query(
      `INSERT INTO ai_runs (workspace_id, project_id, user_id, task_name, model_name, provider,
         prompt_tokens, completion_tokens, cost_usd, cost_zar, outcome, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [ctx.workspaceId, ctx.projectId, ctx.userId, ctx.task, setting.model, setting.provider,
        usage.inputTokens ?? 0, usage.outputTokens ?? 0, round(usd, 6), round(zar, 4), outcome, error ?? null]
    );
    return { usd, zar };
  };

  let result: Completion;
  try {
    result = await complete(setting.provider, key, { ...req, model: setting.model }, fetchImpl);
  } catch (err) {
    // A refused or cut-off answer still used (and billed) tokens.
    const usage = err as Partial<Completion>;
    await log("failed", { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, (err as Error).message.slice(0, 1000));
    throw err;
  }
  const { usd, zar } = await log("success", result);
  return { ...result, costUsd: usd, costZar: zar, model: setting.model };
}
