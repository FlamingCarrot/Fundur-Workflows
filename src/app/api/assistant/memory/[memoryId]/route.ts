import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { deleteMemory, updateMemory } from "@/lib/ai/memory";
import { assistantScope } from "../../scope";

export const dynamic = "force-dynamic";

const changeInput = z.object({ text: z.string().trim().min(2).max(400).optional(), scope: z.enum(["project", "studio"]).optional() });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ memoryId: string }> }) {
  const s = await assistantScope(req.nextUrl.searchParams.get("project"));
  if (s instanceof NextResponse) return s;
  const { memoryId } = await ctx.params;
  const parsed = changeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(memoryId).success) return NextResponse.json({ error: "Write what to remember" }, { status: 400 });
  if (!(await updateMemory(s.db, s.workspaceId, s.projectId, memoryId, parsed.data))) return NextResponse.json({ error: "That memory is gone" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ memoryId: string }> }) {
  const s = await assistantScope(req.nextUrl.searchParams.get("project"));
  if (s instanceof NextResponse) return s;
  const { memoryId } = await ctx.params;
  if (!z.string().uuid().safeParse(memoryId).success) return NextResponse.json({ error: "That memory is gone" }, { status: 404 });
  if (!(await deleteMemory(s.db, s.workspaceId, s.projectId, memoryId))) return NextResponse.json({ error: "That memory is gone" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
