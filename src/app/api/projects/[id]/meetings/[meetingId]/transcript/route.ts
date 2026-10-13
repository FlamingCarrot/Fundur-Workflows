import { NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { getMeeting, getTranscript, uploadTranscript } from "@/lib/comms/store";
import { parseTranscript, transcriptText } from "@/lib/comms/types";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; meetingId: string }> };
const meetingIdSchema = z.uuid();

/** The transcript as text (?format=txt downloads it). */
export async function GET(req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  if (!meetingIdSchema.safeParse(meetingId).success) return commsJson({ error: "Meeting not found" }, 404);
  try {
    const meeting = await getMeeting(s, meetingId);
    const lines = await getTranscript(s, meetingId);
    if (new URL(req.url).searchParams.get("format") !== "txt") return commsJson({ lines });
    const name = `${meeting.title.replace(/[^\w .-]+/g, "_").slice(0, 80) || "meeting"} transcript.txt`;
    return new Response(`${meeting.title}\n${meeting.startsAt}\n\n${transcriptText(lines)}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${name}"` },
    });
  } catch (e) {
    return commsFailure(e);
  }
}

/** Replaces the uploaded transcript with a file's text: WebVTT, SRT or "Name: words" lines. */
export async function POST(req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id, "project:edit");
  if (s instanceof NextResponse) return s;
  const input = z.object({ text: z.string().min(1).max(2_000_000) }).strict().safeParse(await readBody(req));
  if (!input.success || !meetingIdSchema.safeParse(meetingId).success) return commsJson({ error: "Add the transcript's text" }, 400);
  const lines = parseTranscript(input.data.text);
  if (!lines.length) return commsJson({ error: "No words were found in that transcript" }, 400);
  try {
    const added = await uploadTranscript(s, meetingId, lines);
    return commsJson({ added, lines: await getTranscript(s, meetingId) });
  } catch (e) {
    return commsFailure(e);
  }
}
