import { NextResponse } from "next/server";
import { z } from "zod";
import { commsFailure, commsJson, readBody, teamScope } from "@/lib/comms/http";
import { postToTask } from "@/lib/comms/notes";
import { getProject } from "@/lib/projects/store";
export const dynamic = "force-dynamic";

const input = z
  .object({
    title: z.string().trim().min(1).max(500),
    due: z.iso.date().optional(),
    phaseKey: z.string().max(100).optional(),
  })
  .strict();

/** Makes the post into a task on the project, noted in its thread. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const s = await teamScope(id, "phase:work");
  if (s instanceof NextResponse) return s;
  const parsed = input.safeParse(await readBody(req));
  if (!parsed.success || !z.uuid().safeParse(postId).success) return commsJson({ error: "Give the task a title" }, 400);
  try {
    const task = await postToTask(s, postId, parsed.data);
    return commsJson({ ...task, project: await getProject(s.db, s.workspaceId, id) }, 201);
  } catch (e) {
    return commsFailure(e);
  }
}
