import { after, NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson, fileResponse } from "@/lib/comms/http";
import { transcribeAndTakeNotes } from "@/lib/comms/notes";
import { recordingFile } from "@/lib/comms/store";
import { openFile } from "@/lib/storage/blob";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; meetingId: string; recordingId: string }> };

/** Plays or downloads a recording (?view=1 plays it in the page). */
export async function GET(req: Request, { params }: Context) {
  const { id, meetingId, recordingId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  if (!z.uuid().safeParse(meetingId).success || !z.uuid().safeParse(recordingId).success) return commsJson({ error: "Recording not found" }, 404);
  try {
    const file = await recordingFile(s, meetingId, recordingId);
    const stored = file && (await openFile(file.storageKey));
    if (!file || !stored) return commsJson({ error: "Recording not found" }, 404);
    return fileResponse(stored, file.name, file.contentType, new URL(req.url).searchParams.get("view") === "1");
  } catch (e) {
    return commsFailure(e);
  }
}

/** Transcribes the recording again (after a failure, or once an OpenAI key was added). */
export async function POST(_req: Request, { params }: Context) {
  const { id, meetingId, recordingId } = await params;
  const s = await teamScope(id, "project:edit");
  if (s instanceof NextResponse) return s;
  if (!z.uuid().safeParse(meetingId).success || !z.uuid().safeParse(recordingId).success) return commsJson({ error: "Recording not found" }, 404);
  try {
    if (!(await recordingFile(s, meetingId, recordingId))) return commsJson({ error: "Recording not found" }, 404);
    after(() => transcribeAndTakeNotes(s, meetingId, recordingId));
    return commsJson({ ok: true }, 202);
  } catch (e) {
    return commsFailure(e);
  }
}
