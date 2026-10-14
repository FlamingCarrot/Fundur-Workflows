import { NextResponse } from "next/server";
import { z } from "zod";
import { commsFailure, commsJson, teamScope } from "@/lib/comms/http";
import { draftAgenda } from "@/lib/comms/write-help";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The assistant prepares the meeting's agenda from the project's open work; nothing is saved. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; meetingId: string }> }) {
  const { id, meetingId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  if (s.ctx.features.ai === false) return commsJson({ error: "The assistant is turned off for this workspace" }, 403);
  if (!z.uuid().safeParse(meetingId).success) return commsJson({ error: "Meeting not found" }, 404);
  try {
    return commsJson({ agenda: await draftAgenda(s, meetingId) });
  } catch (e) {
    return commsFailure(e);
  }
}
