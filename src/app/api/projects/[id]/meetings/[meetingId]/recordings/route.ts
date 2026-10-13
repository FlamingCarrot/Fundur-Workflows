import { after, NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { transcribeAndTakeNotes } from "@/lib/comms/notes";
import { addRecording, listRecordings } from "@/lib/comms/store";
import { isInProject, statFile } from "@/lib/storage/blob";
export const dynamic = "force-dynamic";
// Transcribing runs after the response; a long recording takes a few minutes.
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; meetingId: string }> };

const input = z
  .object({
    storageKey: z.string().min(1).max(1000),
    name: z.string().trim().min(1).max(255),
    contentType: z.string().max(100).optional(),
    durationSec: z.number().int().min(0).max(48 * 3600),
  })
  .strict();

export async function GET(_req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  if (!z.uuid().safeParse(meetingId).success) return commsJson({ error: "Meeting not found" }, 404);
  try {
    return commsJson({ recordings: await listRecordings(s, meetingId) });
  } catch (e) {
    return commsFailure(e);
  }
}

/** Keeps a recording uploaded from the call, then transcribes it and takes notes. */
export async function POST(req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id, "document:upload");
  if (s instanceof NextResponse) return s;
  const parsed = input.safeParse(await readBody(req));
  if (!parsed.success || !z.uuid().safeParse(meetingId).success) return commsJson({ error: "The recording did not arrive" }, 400);
  if (!isInProject(parsed.data.storageKey, s.workspaceId, s.projectId)) return commsJson({ error: "That file belongs to another project" }, 400);
  const stored = await statFile(parsed.data.storageKey);
  if (!stored) return commsJson({ error: "The recording did not finish uploading" }, 400);
  try {
    const recording = await addRecording(s, meetingId, {
      storageKey: parsed.data.storageKey,
      name: parsed.data.name,
      contentType: parsed.data.contentType || stored.contentType || "audio/webm",
      sizeBytes: stored.size,
      durationSec: parsed.data.durationSec,
    });
    after(() => transcribeAndTakeNotes(s, meetingId, recording.id));
    return commsJson({ recording }, 201);
  } catch (e) {
    return commsFailure(e);
  }
}
