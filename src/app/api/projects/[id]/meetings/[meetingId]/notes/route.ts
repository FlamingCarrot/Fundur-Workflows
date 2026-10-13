import { NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson } from "@/lib/comms/http";
import { takeNotes } from "@/lib/comms/notes";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; meetingId: string }> };

/** Takes notes from the transcript now: with the AI, or the quick pass when no model is set up. Replaces hand-written notes. */
export async function POST(_req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id, "project:edit");
  if (s instanceof NextResponse) return s;
  if (!z.uuid().safeParse(meetingId).success) return commsJson({ error: "Meeting not found" }, 404);
  try {
    const done = await takeNotes(s, meetingId, { force: true });
    if (!done) return commsJson({ error: "There is no transcript to take notes from yet" }, 400);
    return commsJson(done);
  } catch (e) {
    return commsFailure(e);
  }
}
