import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import "@/lib/ai/tools";
import { openAlerts, readBudget, saveBudget } from "@/lib/ai/budget";
import { projectAiCosts } from "@/lib/ai/costs";
import { getProject, projectDbId } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import type { Project } from "@/lib/studio/types";
import { getPhase, getWorkflow } from "@/lib/workflow";

export const dynamic = "force-dynamic";

function taskName(project: Project, id: string): string {
  const task = project.tasks.find((t) => t.id === id);
  if (!task) return "A removed task";
  if (!task.stepItemId) return task.title;
  return getWorkflow(project).phases.flatMap((p) => p.checklist).find((i) => i.id === task.stepItemId)?.text ?? task.title;
}

async function summary(ws: Exclude<Awaited<ReturnType<typeof requireWorkspace>>, NextResponse>, project: Project, projectId: string) {
  return {
    costs: await projectAiCosts(ws.db, ws.workspaceId, projectId, {
      phase: (key) => getPhase(project, key)?.name ?? key,
      task: (id) => taskName(project, id),
    }),
    budget: await readBudget(ws.db, ws.workspaceId, projectId),
    alerts: await openAlerts(ws.db, ws.workspaceId, projectId),
    canSetBudget: ws.user.platformRole === "admin",
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
