import { NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { actionItemsToTasks } from "@/lib/comms/notes";
import { getProject } from "@/lib/projects/store";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; meetingId: string }> };

const input = z.object({ itemIds: z.array(z.string().max(64)).max(50).optional(), phaseKey: z.string().max(100).optional() }).strict();

/** Makes a meeting's action items into tasks on the project. */
export async function POST(req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id, "phase:work");
  if (s instanceof NextResponse) return s;
  const parsed = input.safeParse(await readBody(req));
  if (!parsed.success || !z.uuid().safeParse(meetingId).success) return commsJson({ error: "Pick the action items" }, 400);
  try {
    const result = await actionItemsToTasks(s, meetingId, parsed.data);
    return commsJson({ ...result, project: await getProject(s.db, s.workspaceId, id) });
  } catch (e) {
    return commsFailure(e);
  }
}
