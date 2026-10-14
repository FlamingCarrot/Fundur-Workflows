import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addMemory, listMemories, listNotes } from "@/lib/ai/memory";
import { memoryScope } from "./scope";

export const dynamic = "force-dynamic";

/** What the assistant remembers (the studio's, and the project's with ?project=) and its latest task notes. */
export async function GET(req: NextRequest) {
  const s = await memoryScope(req.nextUrl.searchParams.get("project"));
  if (s instanceof NextResponse) return s;
  return NextResponse.json({
    memories: await listMemories(s.db, s.workspaceId, s.projectId),
    notes: await listNotes(s.db, s.workspaceId, s.projectId, s.user.id),
  });
}

const addInput = z.object({ text: z.string().trim().min(2).max(400), scope: z.enum(["project", "studio"]).default("studio") });

/** Something a person wants the assistant to remember. */
export async function POST(req: NextRequest) {
  const s = await memoryScope(req.nextUrl.searchParams.get("project"));
  if (s instanceof NextResponse) return s;
  const parsed = addInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write what to remember" }, { status: 400 });
  if (parsed.data.scope === "project" && !s.projectId) return NextResponse.json({ error: "Open a project to remember something about it" }, { status: 400 });
  const memory = await addMemory(s.db, s.workspaceId, parsed.data.scope === "project" ? s.projectId : null, { text: parsed.data.text, source: "person", createdBy: s.user.id });
  return NextResponse.json({ memory });
}
