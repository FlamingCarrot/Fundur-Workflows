import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addEntry, listTime, runningTimer, startTimer, stopTimer } from "@/lib/business/store";
import { handled, projectIdOf, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

/** Time worked: her own (the owner can ask for everyone's, or one project's), and her running timer. */
export async function GET(req: NextRequest) {
  const ws = await requireBusiness(false);
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const all = req.nextUrl.searchParams.get("all") === "1" && ws.workspaceRole === "owner";
    const projectId = await projectIdOf(ws, req.nextUrl.searchParams.get("project"));
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    return NextResponse.json({
      entries: await listTime(ws.db, ws.workspaceId, { userId: all ? undefined : ws.user.id, projectId: projectId ?? undefined, since: projectId ? undefined : since }),
      running: await runningTimer(ws.db, ws.workspaceId, ws.user.id),
    });
  });
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), project: z.string().max(100).nullable().default(null), phaseKey: z.string().max(100).nullable().optional(), note: z.string().max(500).optional(), billable: z.boolean().optional() }),
  z.object({ action: z.literal("stop") }),
  z.object({
    action: z.literal("add"),
    project: z.string().max(100).nullable().default(null),
    phaseKey: z.string().max(100).nullable().optional(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    minutes: z.number().int().min(1).max(1440),
    note: z.string().max(500).optional(),
    billable: z.boolean().optional(),
  }),
]);

/** Starts or stops her timer, or logs time after the fact. */
export async function POST(req: NextRequest) {
  const ws = await requireBusiness(false);
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const input = body.parse(await req.json().catch(() => null));
    if (input.action === "stop") return NextResponse.json({ entry: await stopTimer(ws.db, ws.workspaceId, ws.user.id) });
    const projectId = await projectIdOf(ws, input.project);
    if (input.action === "start") return NextResponse.json({ entry: await startTimer(ws.db, ws.workspaceId, ws.user.id, { projectId, phaseKey: input.phaseKey, note: input.note, billable: input.billable }) });
    return NextResponse.json({ entry: await addEntry(ws.db, ws.workspaceId, ws.user.id, { projectId, phaseKey: input.phaseKey, day: input.day, minutes: input.minutes, note: input.note, billable: input.billable }) });
  });
}
