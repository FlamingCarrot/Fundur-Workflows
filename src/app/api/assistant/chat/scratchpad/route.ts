import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateLatestScratchpad } from "@/lib/ai/chat-store";
import { requireFeature, requirePermission, requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const scratchpadInput = z.object({
  scratchpad: z
    .object({
      title: z.string().min(1).max(200),
      tasks: z.array(
        z.object({
          id: z.string().max(100),
          text: z.string().max(300),
          status: z.enum(["pending", "in_progress", "completed", "failed"]),
          note: z.string().max(300).optional(),
        })
      ),
    })
    .nullable(),
});

export async function POST(req: NextRequest) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const authed = requirePermission(ws, "ai:use") ?? requireFeature(ws, "ai") ?? ws;
  if (authed instanceof NextResponse) return authed;

  const parsed = scratchpadInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid scratchpad" }, { status: 400 });

  await updateLatestScratchpad(ws.db, ws.workspaceId, null, ws.user.id, parsed.data.scratchpad);
  return NextResponse.json({ ok: true });
}
