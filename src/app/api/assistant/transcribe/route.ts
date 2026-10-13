import { NextRequest, NextResponse } from "next/server";
import { readCallSettings, transcribeRecording, TranscriptionUnavailableError, TRANSCRIPTION_USD_PER_MINUTE } from "@/lib/comms/calls";
import { requireFeature, requirePermission, requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Speech to text for the assistant's voice mode where the browser has no
 * speech recognition of its own (e.g. Firefox). The audio goes to OpenAI with
 * the key saved for AI models, is turned into text and is not kept here.
 */

/** A spoken message is short; this is a few minutes of compressed audio. */
const MAX_BYTES = 10 * 1024 * 1024;

async function context() {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  return requirePermission(ws, "ai:use") ?? requireFeature(ws, "ai") ?? ws;
}

/** Whether speech can be turned into text here: transcription is on and an OpenAI key is saved. */
export async function GET() {
  const ws = await context();
  if (ws instanceof NextResponse) return ws;
  const settings = await readCallSettings(ws.db);
  return NextResponse.json({ available: settings.transcription.enabled && settings.transcription.keySaved });
}

export async function POST(req: NextRequest) {
  const ws = await context();
  if (ws instanceof NextResponse) return ws;
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || !audio.size) return NextResponse.json({ error: "No audio was sent" }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: "That was too long to turn into text. Try a shorter message." }, { status: 413 });
  const type = audio.type || "audio/webm";
  const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const { segments, durationSec } = await transcribeRecording(ws.db, { bytes, name: `message.${ext}`, contentType: type });
    const usd = (Math.max(durationSec, 1) / 60) * TRANSCRIPTION_USD_PER_MINUTE;
    await ws.db.query(
      `INSERT INTO ai_runs (workspace_id, project_id, user_id, task_name, model_name, provider, prompt_tokens, completion_tokens, cost_usd, cost_zar, outcome, role)
       VALUES ($1, NULL, $2, 'chat_dictation', 'speech-to-text', 'openai', 0, 0, $3, $4, 'success', 'worker')`,
      [ws.workspaceId, ws.user.id, Math.round(usd * 1e6) / 1e6, Math.round(usd * 18 * 1e4) / 1e4]
    );
    return NextResponse.json({ text: segments.map((s) => s.text).join(" ").trim() });
  } catch (err) {
    if (err instanceof TranscriptionUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("Dictation failed", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Could not turn that into text. Try again." }, { status: 502 });
  }
}
