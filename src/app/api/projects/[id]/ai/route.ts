import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import "@/lib/ai/tools";
import { openAlerts, readBudget, saveBudget } from "@/lib/ai/budget";
import { projectAiCosts, withoutMoney } from "@/lib/ai/costs";
import { getTool } from "@/lib/ai/tools";
import { getProject, projectDbId } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import type { Project } from "@/lib/studio/types";
import { projectTasks } from "@/lib/studio/tasks";
import { getPhase } from "@/lib/workflow";

export const dynamic = "force-dynamic";

function taskName(project: Project, id: string): string {
  return projectTasks(project).find((t) => t.id === id)?.title ?? "A removed task";
}

/**
 * The Admin sees money, tokens and tool use; everyone else sees usage in
 * tokens and how much of the budget is used, with the money taken out.
 */
async function summary(ws: Exclude<Awaited<ReturnType<typeof requireWorkspace>>, NextResponse>, project: Project, projectId: string) {
  const isAdmin = ws.user.platformRole === "admin";
  const costs = await projectAiCosts(ws.db, ws.workspaceId, projectId, {
    phase: (key) => getPhase(project, key)?.name ?? key,
    task: (id) => taskName(project, id),
    tool: (name) => getTool(name)?.label ?? name,
  });
  const budget = await readBudget(ws.db, ws.workspaceId, projectId);
  const usedShare = budget.budgetZar ? budget.spentZar / budget.budgetZar : null;
  const alerts = await openAlerts(ws.db, ws.workspaceId, projectId);
  return {
    costs: isAdmin ? costs : withoutMoney(costs),
    budget: isAdmin ? { ...budget, usedShare } : { ...budget, budgetZar: null, spentZar: 0, usedShare },
    alerts: isAdmin ? alerts : alerts.map((a) => ({ ...a, spendZar: 0, budgetZar: 0 })),
    canSetBudget: isAdmin,
    showMoney: isAdmin,
  };
}

/** AI spend on the project by phase, task, kind of work and model (P4-15), with its budget and alerts. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const slug = (await ctx.params).id;
  const project = await getProject(ws.db, ws.workspaceId, slug);
  const projectId = project && (await projectDbId(ws.db, ws.workspaceId, slug));
  if (!project || !projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(await summary(ws, project, projectId));
}

const budgetInput = z.object({
  budgetZar: z.number().positive().max(10_000_000).nullable(),
  alertPercent: z.number().int().min(1).max(100).default(80),
  pauseAtLimit: z.boolean().default(true),
});

/** Sets or removes the project's AI budget (P4-16). Admin only. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  if (ws.user.platformRole !== "admin") return NextResponse.json({ error: "Only the platform Admin can set budgets" }, { status: 403 });
  const parsed = budgetInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const slug = (await ctx.params).id;
  const project = await getProject(ws.db, ws.workspaceId, slug);
  const projectId = project && (await projectDbId(ws.db, ws.workspaceId, slug));
  if (!project || !projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  await saveBudget(ws.db, ws.workspaceId, projectId, parsed.data, ws.user.id);
  return NextResponse.json(await summary(ws, project, projectId));
}
