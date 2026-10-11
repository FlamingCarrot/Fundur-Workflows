import { NextResponse } from "next/server";
import { AiBudgetError } from "@/lib/ai/budget";
import type { Db } from "@/lib/db";
import { hasFeature, moduleAccess, moduleCap, moduleAllows, workflowAccess, type EffectivePlan } from "./plans";
import { planFor, planForUser, readUsage } from "./store";

/**
 * Plan checks on the server. Routes call these before doing the work, and
 * answer a PlanLimitError with limitResponse: a 402 whose message says what
 * the plan allows, which the screens show as is.
 */
export class PlanLimitError extends Error {
  constructor(message: string, readonly feature: string) {
    super(message);
  }
}

/** The AI allowance for the month is used up. A budget error, so every AI screen already shows it. */
export class AiAllowanceError extends AiBudgetError {}

export function limitResponse(err: PlanLimitError): NextResponse {
  return NextResponse.json({ error: err.message, code: "plan_limit", feature: err.feature }, { status: 402 });
}

/** Runs `fn`, turning a PlanLimitError into its 402. */
export async function withPlanLimits(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PlanLimitError) return limitResponse(err);
    throw err;
  }
}

interface Who {
  db: Db;
  workspaceId: string;
  user: { platformRole: string };
}

export function planOf(ctx: Who): Promise<EffectivePlan> {
  return planFor(ctx.db, ctx.workspaceId, { admin: ctx.user.platformRole === "admin" });
}

const s = (n: number) => (n === 1 ? "" : "s");

/** Starting one more project on this workflow. */
export async function assertCanCreateProject(ctx: Who, workflowId: string): Promise<void> {
  const plan = await planOf(ctx);
  if (workflowAccess(plan.limits, workflowId) === "none") {
    throw new PlanLimitError(`This workflow is on the Paid plan.`, `workflow:${workflowId}`);
  }
  const cap = plan.limits.openProjects;
  if (cap == null) return;
  const { openProjects } = await readUsage(ctx.db, ctx.workspaceId);
  if (openProjects >= cap) {
    throw new PlanLimitError(
      `The ${plan.label} plan runs ${cap} project${s(cap)} at a time. Complete one, or move to Paid for as many as you need.`,
      "open_projects"
    );
  }
}

export async function assertFeature(ctx: Who, feature: string, message: string): Promise<void> {
  const plan = await planOf(ctx);
  if (!hasFeature(plan.limits, feature)) throw new PlanLimitError(message, feature);
}

export async function assertModule(ctx: Who, moduleRef: string, workflowId?: string): Promise<EffectivePlan> {
  const plan = await planOf(ctx);
  if (moduleAccess(plan.limits, moduleRef, workflowId) === "none") {
    throw new PlanLimitError("This part of the workflow is on the Paid plan.", `module:${moduleRef.split(":")[0]}`);
  }
  return plan;
}

/**
 * A count a module caps, e.g. floors on a plan. Only growth is refused: work
 * made on Paid stays usable after a move to Free, it just can't grow further.
 */
export function assertWithinCap(
  plan: EffectivePlan,
  moduleRef: string,
  name: string,
  next: number,
  previous: number,
  what: string,
  workflowId?: string
): void {
  const cap = moduleCap(plan.limits, moduleRef, name, workflowId);
  if (cap == null || next <= previous || next <= cap) return;
  throw new PlanLimitError(`The ${plan.label} plan allows ${cap} ${what}${s(cap)}. Move to Paid for more.`, `${moduleRef}.${name}`);
}

export function assertAllows(plan: EffectivePlan, moduleRef: string, name: string, message: string, workflowId?: string): void {
  if (!moduleAllows(plan.limits, moduleRef, name, workflowId)) throw new PlanLimitError(message, `${moduleRef}.${name}`);
}

/** A file upload that would take the workspace past its storage. */
export async function assertStorageFor(ctx: Who, bytes: number): Promise<void> {
  const plan = await planOf(ctx);
  const capMb = plan.limits.storageMb;
  if (capMb == null) return;
  const { storageBytes } = await readUsage(ctx.db, ctx.workspaceId);
  if (storageBytes + bytes > capMb * 1024 * 1024) {
    const cap = capMb >= 1024 ? `${Math.round(capMb / 1024)} GB` : `${capMb} MB`;
    throw new PlanLimitError(`Your ${cap} of file storage is full. Delete old files or move to Paid for more.`, "storage");
  }
}

/**
 * Called before every AI call. Each plan carries a monthly AI allowance for
 * the whole workspace; the platform Admin has none.
 */
export async function assertAiAllowance(db: Db, workspaceId: string, userId: string): Promise<void> {
  const plan = await planForUser(db, workspaceId, userId);
  const cap = plan.limits.aiUsdPerMonth;
  if (cap == null) return;
  const { aiUsdThisMonth } = await readUsage(db, workspaceId);
  if (aiUsdThisMonth >= cap) {
    throw new AiAllowanceError(
      plan.key === "free"
        ? "This month's AI allowance on the Free plan is used up. It resets on the 1st, or move to Paid for more."
        : "This month's AI allowance is used up. It resets on the 1st; the Admin can help sooner."
    );
  }
}
