import { createHmac } from "node:crypto";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/server/secrets";
import { readProviderKey } from "@/lib/ai/settings";
import type { JoinInfo, Peer } from "./types";

/**
 * How calls are carried, recorded and transcribed: the Platform Admin's
 * choices, kept with the other AI settings. Secrets are stored encrypted and
 * never leave the server.
 *
 * Call providers sit behind one interface (joinInfo). "builtin" connects the
 * people in a call straight to each other (WebRTC), with the app passing their
 * handshakes along; it needs no account and suits small calls. "livekit" uses
 * a LiveKit server (LiveKit Cloud or self-hosted) for larger, sturdier calls.
 * Transcribing a recording uses the OpenAI key already saved for AI models.
 */

const SETTING = "calls";

export const CALL_PROVIDERS = ["builtin", "livekit"] as const;
export type CallProvider = (typeof CALL_PROVIDERS)[number];

interface StoredCallSettings {
  provider?: CallProvider;
  livekit?: { url: string; apiKey: string; secret: string; hint: string };
  turn?: { urls: string[]; username: string; credential: string };
  transcription?: { enabled: boolean; model: string };
  recording?: { enabled: boolean };
}

/** What the settings page shows: never a secret. */
export interface CallSettingsView {
  provider: CallProvider;
  livekit: { url: string; apiKey: string; hint: string } | null;
  turn: { urls: string[]; username: string } | null;
  transcription: { enabled: boolean; model: string; keySaved: boolean };
  recording: { enabled: boolean };
}

export const TRANSCRIPTION_MODELS = ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"] as const;

export const callSettingsInput = z
  .object({
    provider: z.enum(CALL_PROVIDERS).optional(),
    livekit: z
      .object({
        url: z.string().trim().regex(/^wss:\/\/[^\s/]+(\/[^\s]*)?$/, "The LiveKit address starts with wss://"),
        apiKey: z.string().trim().min(4).max(200),
        /** Left out keeps the saved secret. */
        secret: z.string().trim().min(8).max(500).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    turn: z
      .object({
        urls: z.array(z.string().trim().regex(/^turns?:[^\s]+$/, "Relay addresses start with turn: or turns:")).min(1).max(5),
        username: z.string().trim().max(200),
        credential: z.string().trim().max(500).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    transcription: z.object({ enabled: z.boolean(), model: z.enum(TRANSCRIPTION_MODELS) }).strict().optional(),
    recording: z.object({ enabled: z.boolean() }).strict().optional(),
  })
  .strict();
export type CallSettingsInput = z.infer<typeof callSettingsInput>;

async function readStored(db: Db): Promise<StoredCallSettings> {
  const [row] = await db.query<{ value: unknown }>("SELECT value FROM ai_platform_settings WHERE key=$1", [SETTING]);
  if (!row) return {};
  const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return (value ?? {}) as StoredCallSettings;
}

export async function readCallSettings(db: Db): Promise<CallSettingsView> {
  const s = await readStored(db);
  const livekit = s.livekit ? { url: s.livekit.url, apiKey: s.livekit.apiKey, hint: s.livekit.hint } : null;
  return {
    provider: s.provider === "livekit" && livekit ? "livekit" : "builtin",
    livekit,
    turn: s.turn ? { urls: s.turn.urls, username: s.turn.username } : null,
    transcription: { enabled: s.transcription?.enabled !== false, model: s.transcription?.model ?? "whisper-1", keySaved: !!(await readProviderKey(db, "openai")) },
    recording: { enabled: s.recording?.enabled !== false },
  };
}

export async function saveCallSettings(db: Db, input: CallSettingsInput, userId: string): Promise<CallSettingsView> {
  const s = await readStored(db);
  const next: StoredCallSettings = { ...s };
  if (input.livekit === null) delete next.livekit;
  else if (input.livekit) {
    const secret = input.livekit.secret ? encryptSecret(input.livekit.secret) : s.livekit?.secret;
    if (!secret) throw new Error("Paste the LiveKit API secret");
    next.livekit = { url: input.livekit.url, apiKey: input.livekit.apiKey, secret, hint: input.livekit.secret ? keyHint(input.livekit.secret) : s.livekit!.hint };
  }
  if (input.turn === null) delete next.turn;
  else if (input.turn) {
    const credential = input.turn.credential ? encryptSecret(input.turn.credential) : s.turn?.credential ?? "";
    next.turn = { urls: input.turn.urls, username: input.turn.username, credential };
  }
  if (input.provider) next.provider = input.provider;
  if (next.provider === "livekit" && !next.livekit) throw new Error("Add the LiveKit details first");
  if (input.transcription) next.transcription = input.transcription;
  if (input.recording) next.recording = input.recording;
  await db.query(
    `INSERT INTO ai_platform_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [SETTING, JSON.stringify(next), userId],
  );
  return readCallSettings(db);
}

/** Public STUN servers find each browser's address; a relay (TURN) gets through strict networks. */
const STUN = { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

/** The provider a new meeting uses. */
export async function currentProvider(db: Db): Promise<CallProvider> {
  return (await readCallSettings(db)).provider;
}

export async function recordingAllowed(db: Db): Promise<boolean> {
  return (await readCallSettings(db)).recording.enabled;
}

/**
 * How one person's browser joins a meeting's call. A meeting keeps the
 * provider it was started on; if LiveKit was switched off since, it falls back
 * to the built-in service.
 */
export async function joinInfo(db: Db, meeting: { room: string; provider: string }, peer: Pick<Peer, "id" | "name" | "personKey" | "kind">, now = Date.now()): Promise<JoinInfo> {
  const s = await readStored(db);
  if (meeting.provider === "livekit" && s.livekit) {
    const token = liveKitToken(
      { apiKey: s.livekit.apiKey, secret: decryptSecret(s.livekit.secret) },
      { room: meeting.room, identity: peer.id, name: peer.name, metadata: JSON.stringify({ personKey: peer.personKey, kind: peer.kind }) },
      now,
    );
    return { provider: "livekit", url: s.livekit.url, token };
  }
  const iceServers: { urls: string | string[]; username?: string; credential?: string }[] = [STUN];
  if (s.turn) {
    let credential = "";
    try {
      credential = s.turn.credential ? decryptSecret(s.turn.credential) : "";
    } catch {
      // A credential sealed with an older key is skipped; calls still try without the relay.
    }
    iceServers.push({ urls: s.turn.urls, username: s.turn.username, credential });
  }
  return { provider: "builtin", iceServers };
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** A LiveKit access token (a JWT signed with the API secret) for one person in one room, valid for six hours. */
export function liveKitToken(
  creds: { apiKey: string; secret: string },
  grant: { room: string; identity: string; name: string; metadata?: string },
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: creds.apiKey,
    sub: grant.identity,
    name: grant.name,
    nbf: iat - 10,
    iat,
    exp: iat + 6 * 3600,
    jti: grant.identity,
    ...(grant.metadata ? { metadata: grant.metadata } : {}),
    video: { room: grant.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${b64url(createHmac("sha256", creds.secret).update(body).digest())}`;
}

// ---------------------------------------------------------------------------
// Transcribing a recording
// ---------------------------------------------------------------------------

export class TranscriptionUnavailableError extends Error {}

/** OpenAI bills transcription by the minute. */
export const TRANSCRIPTION_USD_PER_MINUTE = 0.006;
/** The largest file OpenAI takes for transcription. */
export const TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;

export interface TranscribedSegment {
  atMs: number;
  text: string;
  speaker?: string;
}

/**
 * Turns a recording into timed text with OpenAI's speech-to-text, using the
 * OpenAI key saved for AI models. Throws TranscriptionUnavailableError when
 * that key or transcription is switched off.
 */
export async function transcribeRecording(
  db: Db,
  file: { bytes: Uint8Array; name: string; contentType: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ segments: TranscribedSegment[]; durationSec: number }> {
  const settings = await readCallSettings(db);
  if (!settings.transcription.enabled) throw new TranscriptionUnavailableError("Transcription is switched off in Admin settings");
  const key = await readProviderKey(db, "openai");
  if (!key) throw new TranscriptionUnavailableError("Transcribing recordings needs an OpenAI key in Admin settings");
  if (file.bytes.byteLength > TRANSCRIPTION_MAX_BYTES) throw new TranscriptionUnavailableError("This recording is over 25 MB, the most that can be transcribed at once");
  const model = settings.transcription.model;
  const form = new FormData();
  form.append("file", new Blob([file.bytes as BlobPart], { type: file.contentType }), file.name);
  form.append("model", model);
  form.append("response_format", model === "whisper-1" ? "verbose_json" : "json");
  if (model === "whisper-1") form.append("timestamp_granularities[]", "segment");
  const res = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(280_000),
  });
  if (res.status === 401 || res.status === 403) throw new TranscriptionUnavailableError("OpenAI did not accept the saved key");
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  const body = (await res.json()) as { text?: string; duration?: number; segments?: { start: number; text: string }[] };
  const segments = body.segments?.length
    ? body.segments.map((s) => ({ atMs: Math.round(s.start * 1000), text: s.text.trim() })).filter((s) => s.text)
    : body.text?.trim()
      ? [{ atMs: 0, text: body.text.trim() }]
      : [];
  return { segments, durationSec: Math.round(body.duration ?? 0) };
}
