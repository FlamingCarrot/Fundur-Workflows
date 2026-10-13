import { z } from "zod";

/**
 * Meetings and conversations, as every part of the app sees them: channels
 * with threaded posts, mentions and files; video calls that can be recorded
 * and transcribed; and the notes taken from a call (summary, decisions and
 * action items that become tasks).
 *
 * People are teammates (keyed by their user id) or invited clients (keyed
 * "client:<email>"). Clients only ever see channels and meetings the studio
 * opened to them.
 */

export type PersonKind = "team" | "client";

export interface CommsPerson {
  /** A teammate's user id, or "client:<email>" for an invited client. */
  key: string;
  name: string;
  kind: PersonKind;
}

export const clientKey = (email: string) => `client:${email.trim().toLowerCase()}`;

// ---------------------------------------------------------------------------
// Channels and posts
// ---------------------------------------------------------------------------

export const CHANNEL_VISIBILITY = ["team", "client"] as const;
export type ChannelVisibility = (typeof CHANNEL_VISIBILITY)[number];

export interface Channel {
  id: string;
  name: string;
  description: string;
  /** "client": invited clients see it and can post in it too. */
  visibility: ChannelVisibility;
  /** Who is in it; empty means everyone on the project. */
  memberIds: string[];
  isDefault: boolean;
  createdBy: string;
  createdAt: string;
  lastMessageAt: string | null;
  /** Posts and replies since this person last opened it. */
  unread: number;
  /** This person muted it: no count on it and no news of posts or replies, only of mentions of them by name. */
  muted: boolean;
}

/** Who else is in a channel right now: where each has read up to, and who is typing. */
export interface ChannelPresence {
  seen: { key: string; name: string; readAt: string }[];
  typing: { key: string; name: string }[];
}

/** A person telling a channel they are typing, or muting or unmuting it for themselves. */
export const channelMineSchema = z.union([z.object({ typing: z.literal(true) }), z.object({ muted: z.boolean() })]);
export type ChannelMine = z.infer<typeof channelMineSchema>;

export interface Attachment {
  id: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  /** Demo only: the file itself, kept in this browser. */
  dataUrl?: string;
}

export type AuthorKind = "team" | "client" | "assistant" | "system";

export interface Post {
  id: string;
  channelId: string;
  /** The post this replies to; null for a post that starts a thread. */
  parentId: string | null;
  authorKey: string;
  authorName: string;
  authorKind: AuthorKind;
  body: string;
  attachments: Attachment[];
  /** Keys of the people mentioned, and "assistant" when the assistant was asked. */
  mentions: string[];
  meetingId: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  createdAt: string;
  editedAt: string | null;
  /** Emoji reactions, in the order they were first used. */
  reactions: Reaction[];
  /** When it was pinned to the top of its channel. */
  pinnedAt: string | null;
}

/** The reactions on offer: few enough to pick with a thumb, enough to say yes, thanks, done or wow. */
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "😮"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];
export interface Reaction {
  emoji: string;
  people: { key: string; name: string }[];
}

/** Reactions as stored ({ emoji: people }) to the list shown, dropping emptied ones. */
export function readReactions(raw: unknown): Reaction[] {
  const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, { key: string; name: string }[]> | null;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([emoji, people]) => (REACTIONS as readonly string[]).includes(emoji) && Array.isArray(people) && people.length > 0)
    .map(([emoji, people]) => ({ emoji, people: people.map((p) => ({ key: String(p.key), name: String(p.name) })) }));
}

export const postChangeSchema = z.union([
  z.object({ body: z.string().trim().max(5000) }).strict(),
  z.object({ react: z.enum(REACTIONS), on: z.boolean() }).strict(),
  z.object({ pin: z.boolean() }).strict(),
]);
export type PostChange = z.infer<typeof postChangeSchema>;

export const newChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    visibility: z.enum(CHANNEL_VISIBILITY).optional(),
    /** Empty or left out: everyone on the project. */
    memberIds: z.array(z.string().min(1).max(255)).max(100).optional(),
  })
  .strict();
export type NewChannel = z.infer<typeof newChannelSchema>;

export const channelChangeSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    visibility: z.enum(CHANNEL_VISIBILITY).optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type ChannelChange = z.infer<typeof channelChangeSchema>;

/** An attachment as it is sent with a post: the file is already in the project's storage. */
export const attachmentInputSchema = z
  .object({
    storageKey: z.string().min(1).max(1000),
    name: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().min(0).max(200 * 1024 * 1024),
    contentType: z.string().max(100).optional(),
  })
  .strict();
export type AttachmentInput = z.infer<typeof attachmentInputSchema>;

export const newPostSchema = z
  .object({
    body: z.string().trim().max(5000),
    parentId: z.uuid().nullable().optional(),
    attachments: z.array(attachmentInputSchema).max(10).optional(),
  })
  .strict()
  .refine((p) => p.body.length > 0 || (p.attachments?.length ?? 0) > 0, { message: "Write a message or add a file" });
export type NewPost = z.infer<typeof newPostSchema>;

export const ASSISTANT_KEY = "assistant";
export const ASSISTANT_NAME = "Assistant";

/**
 * The people a post mentions as "@Name": the longest name wins, so "@Ann Lee"
 * is Ann Lee and not Ann. "@Assistant" asks the assistant; "@everyone" and
 * "@channel" stand for everyone in the channel.
 */
export function findMentions(body: string, people: { key: string; name: string }[]): string[] {
  const found = new Set<string>();
  const lower = body.toLowerCase();
  const candidates = [
    ...people.filter((p) => p.name.trim()).map((p) => ({ key: p.key, name: p.name.trim().toLowerCase() })),
    { key: ASSISTANT_KEY, name: "assistant" },
    { key: "everyone", name: "everyone" },
    { key: "everyone", name: "channel" },
  ].sort((a, b) => b.name.length - a.name.length);
  for (let i = lower.indexOf("@"); i >= 0; i = lower.indexOf("@", i + 1)) {
    // An @ inside a word (an email address) is not a mention.
    if (i > 0 && /[\p{L}\p{N}._-]/u.test(lower[i - 1])) continue;
    const rest = lower.slice(i + 1);
    const hit = candidates.find((c) => rest.startsWith(c.name) && !/[\p{L}\p{N}]/u.test(rest[c.name.length] ?? ""));
    if (hit) found.add(hit.key);
  }
  return [...found];
}

/** A short line for a post in lists and notifications. */
export function postPreview(body: string, attachments: { name: string }[] = [], max = 140): string {
  const text = body.replace(/\s+/g, " ").trim();
  const line = text || (attachments.length ? `Shared ${attachments.map((a) => a.name).join(", ")}` : "");
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const MEETING_STATUS = ["scheduled", "live", "ended", "cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUS)[number];

export const ACTION_ITEM = z
  .object({
    id: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(500),
    owner: z.string().trim().max(120).optional(),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** The task it became, once created. */
    taskId: z.string().max(64).optional(),
  })
  .strict();
export type ActionItem = z.infer<typeof ACTION_ITEM>;

export const meetingNotesSchema = z
  .object({
    summary: z.string().max(6000),
    decisions: z.array(z.string().trim().min(1).max(500)).max(50),
    actionItems: z.array(ACTION_ITEM).max(50),
  })
  .strict();
export type MeetingNotes = z.infer<typeof meetingNotesSchema>;
/** Where the notes came from: the AI, the quick rule-based pass, or a person. */
export type NotesSource = "ai" | "quick" | "manual";

export interface Meeting {
  id: string;
  /** The project's slug. */
  projectId: string;
  title: string;
  agenda: string;
  startsAt: string;
  durationMin: number;
  status: MeetingStatus;
  provider: string;
  /** Invited clients can see it and join. */
  clientVisible: boolean;
  /** Clients wait to be let in by someone in the studio. */
  waitingRoom: boolean;
  channelId: string | null;
  postId: string | null;
  recording: "off" | "on";
  recordingBy: string | null;
  captions: boolean;
  notes: MeetingNotes | null;
  notesSource: NotesSource | null;
  notesAt: string | null;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** How many people are in the call now. */
  inCall: number;
  hasTranscript: boolean;
  recordings: number;
}

const isoInstant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Pick a date and time");

export const newMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    agenda: z.string().trim().max(5000).optional(),
    startsAt: isoInstant,
    durationMin: z.number().int().min(5).max(600).optional(),
    clientVisible: z.boolean().optional(),
    /** The channel its chat goes in; the default channel when left out. */
    channelId: z.uuid().optional(),
  })
  .strict();
export type NewMeeting = z.infer<typeof newMeetingSchema>;

export const meetingChangeSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    agenda: z.string().trim().max(5000).optional(),
    startsAt: isoInstant.optional(),
    durationMin: z.number().int().min(5).max(600).optional(),
    clientVisible: z.boolean().optional(),
    waitingRoom: z.boolean().optional(),
    status: z.enum(["scheduled", "cancelled"]).optional(),
    notes: meetingNotesSchema.optional(),
  })
  .strict();
export type MeetingChange = z.infer<typeof meetingChangeSchema>;

/** When a meeting can be joined: from 15 minutes before it starts until it ends, or while anyone is in it. */
export function joinable(m: Pick<Meeting, "status" | "startsAt" | "durationMin">, now = Date.now()): boolean {
  if (m.status === "cancelled") return false;
  if (m.status === "live") return true;
  const start = Date.parse(m.startsAt);
  return now >= start - 15 * 60_000 && now <= start + (m.durationMin + 120) * 60_000;
}

export interface TranscriptLine {
  id: string;
  speaker: string;
  atMs: number;
  text: string;
  source: "live" | "recording" | "upload";
}

export const transcriptLineInput = z
  .object({ speaker: z.string().trim().min(1).max(255), atMs: z.number().int().min(0).max(48 * 3600_000), text: z.string().trim().min(1).max(5000) })
  .strict();

/** The transcript as plain text, "[mm:ss] Name: words" a line. */
export function transcriptText(lines: Pick<TranscriptLine, "speaker" | "atMs" | "text">[]): string {
  return lines.map((l) => `[${clock(l.atMs)}] ${l.speaker}: ${l.text}`).join("\n");
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const stamp = (t: string): number | null => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(t.trim());
  if (!m) return null;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number((m[4] ?? "0").padEnd(3, "0"));
};

/**
 * Reads a transcript file: WebVTT (Teams, Zoom and Meet exports, with
 * "<v Name>" voices), SRT, or plain text with "Name: words" lines. Lines
 * without a speaker are put down to "Speaker".
 */
export function parseTranscript(raw: string): { speaker: string; atMs: number; text: string }[] {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const out: { speaker: string; atMs: number; text: string }[] = [];
  const push = (speaker: string, atMs: number, words: string) => {
    const clean = words.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!clean) return;
    const last = out[out.length - 1];
    // Caption files cut one person's sentence into many cues; join them back up.
    if (last && last.speaker === speaker && atMs - last.atMs < 30_000 && last.text.length + clean.length < 1200) last.text += ` ${clean}`;
    else out.push({ speaker: speaker.slice(0, 255), atMs, text: clean.slice(0, 5000) });
  };
  const timed = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/.test(text);
  if (timed) {
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      const at = lines.findIndex((l) => l.includes("-->"));
      if (at < 0) continue;
      const start = stamp(lines[at].split("-->")[0]) ?? 0;
      for (const line of lines.slice(at + 1)) {
        const voice = /^<v(?:\.[^ >]*)?\s+([^>]+)>(.*?)(?:<\/v>)?$/.exec(line);
        if (voice) push(voice[1].trim(), start, voice[2]);
        else {
          const named = /^([^:]{1,60}):\s+(.+)$/.exec(line);
          if (named && !/^\d+$/.test(named[1])) push(named[1].trim(), start, named[2]);
          else push(out.length && out[out.length - 1].atMs >= start - 5000 ? out[out.length - 1].speaker : "Speaker", start, line);
        }
      }
    }
    return out;
  }
  let at = 0;
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    // "[00:12] Name: words", "00:12 Name: words" or "Name: words".
    const m = /^\[?((?:\d+:)?\d{1,2}:\d{2})\]?\s+(.*)$/.exec(line);
    const rest = m ? m[2] : line;
    if (m) at = stamp(m[1]) ?? at;
    const named = /^([^:]{1,60}):\s+(.+)$/.exec(rest);
    if (named) push(named[1].trim(), at, named[2]);
    else push(out.length ? out[out.length - 1].speaker : "Speaker", at, rest);
  }
  return out;
}

const ACTION_CUES =
  /\b(?:[Aa]ction(?: [Ii]tem)?|[Tt]o ?[Dd]o|[Ff]ollow[- ][Uu]p|[Nn]ext [Ss]tep)s?\s*[:-]\s*(.+)|\b(?:[Ii]|[Ww]e|[Yy]ou|[Tt]hey|[Hh]e|[Ss]he|[A-Z][a-z]+)(?:\s+(?:will|need to|needs to|must|should|are going to|is going to)|['’]ll)\s+(.+)/;
const DECISION_CUES = /\b(?:decided|decision|agreed|we(?:'| wi)ll go with|going with|approved|signed off|confirmed)\b/i;

/**
 * Notes taken without a model: the decisions and action items people said out
 * loud ("we agreed…", "Thandi will…", "action: …"), and the first things said
 * as a summary. Used when no AI model is set up, and in the open demo.
 */
export function quickNotes(lines: Pick<TranscriptLine, "speaker" | "text">[], today = new Date()): MeetingNotes {
  const decisions: string[] = [];
  const actionItems: ActionItem[] = [];
  const sentences = lines.flatMap((l) =>
    l.text
      .split(/(?<=[.!?])\s+/)
      .map((s) => ({ speaker: l.speaker, text: s.trim() }))
      .filter((s) => s.text.length > 3),
  );
  for (const s of sentences) {
    if (DECISION_CUES.test(s.text) && decisions.length < 20) decisions.push(`${s.text.replace(/[.!]+$/, "")} (${s.speaker})`);
    const act = ACTION_CUES.exec(s.text);
    if (act && actionItems.length < 30) {
      const what = (act[1] ?? act[2] ?? "").replace(/[.!]+$/, "").trim();
      if (what.length < 4 || /\?$/.test(s.text)) continue;
      const subject = /^(i|we)\b/i.test(s.text.slice(act.index)) ? s.speaker : /^([A-Z][a-z]+)[\s'’]/.exec(s.text.slice(act.index))?.[1];
      // "It will", "That will" and the like are not someone taking something on.
      if (subject && /^(it|this|that|there|these|those|the|what|which|who|everything|nothing|something)$/i.test(subject)) continue;
      const owner = subject && !/^(you|they|he|she|action|todo|follow|next)$/i.test(subject) ? subject : undefined;
      const due = dueFrom(s.text, today);
      actionItems.push({
        id: `q${actionItems.length + 1}`,
        title: what.charAt(0).toUpperCase() + what.slice(1, 500),
        ...(owner ? { owner } : {}),
        ...(due ? { due } : {}),
      });
    }
  }
  const words = lines.map((l) => `${l.speaker}: ${l.text}`).join(" ");
  const speakers = [...new Set(lines.map((l) => l.speaker))];
  const summary = lines.length
    ? `${speakers.length} ${speakers.length === 1 ? "person" : "people"} spoke (${speakers.slice(0, 8).join(", ")}). ${decisions.length} decision${decisions.length === 1 ? "" : "s"} and ${actionItems.length} action item${actionItems.length === 1 ? "" : "s"} were picked out of what was said. It opened with: ${words.slice(0, 400)}${words.length > 400 ? "…" : ""}`
    : "Nothing was transcribed.";
  return { summary, decisions, actionItems };
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function dueFrom(text: string, today: Date): string | undefined {
  const t = text.toLowerCase();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const plus = (n: number) => day(new Date(base.getTime() + n * 86_400_000));
  if (/\btoday\b/.test(t)) return plus(0);
  if (/\btomorrow\b/.test(t)) return plus(1);
  if (/\bnext week\b/.test(t)) return plus(7);
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso) return iso[1];
  const named = WEEKDAY_NAMES.findIndex((w) => new RegExp(`\\b(?:by|on|before)?\\s*${w}\\b`).test(t));
  if (named >= 0) return plus(((named - base.getUTCDay() + 7) % 7) || 7);
  return undefined;
}

// ---------------------------------------------------------------------------
// The call room
// ---------------------------------------------------------------------------

/** Reactions in a call, as in Zoom and Teams. */
export const CALL_REACTIONS = ["👍", "👏", "❤️", "😂", "🎉", "😮"] as const;

export interface PeerState {
  mic: boolean;
  cam: boolean;
  screen: boolean;
  hand: boolean;
  /** A quick reaction in the call, shown to everyone for a few seconds. */
  reaction?: { emoji: (typeof CALL_REACTIONS)[number]; at: number };
}

export interface Peer {
  id: string;
  personKey: string;
  name: string;
  kind: PersonKind;
  state: PeerState;
  joinedAt: string;
  /** False while a client waits to be let in. */
  admitted: boolean;
}

export interface Consent {
  personKey: string;
  name: string;
  decision: "given" | "declined";
  decidedAt: string;
}

export type SignalPayload =
  | { kind: "description"; description: { type: "offer" | "answer" | "pranswer" | "rollback"; sdp?: string } }
  | { kind: "candidate"; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null }
  | { kind: "hello" };

export const signalPayloadSchema: z.ZodType<SignalPayload> = z.union([
  z.object({
    kind: z.literal("description"),
    description: z.object({ type: z.enum(["offer", "answer", "pranswer", "rollback"]), sdp: z.string().max(100_000).optional() }).strict(),
  }).strict(),
  z.object({
    kind: z.literal("candidate"),
    candidate: z
      .object({
        candidate: z.string().max(2000),
        sdpMid: z.string().max(100).nullable().optional(),
        sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(),
        usernameFragment: z.string().max(200).nullable().optional(),
      })
      .strict()
      .nullable(),
  }).strict(),
  z.object({ kind: z.literal("hello") }).strict(),
]);

export interface Signal {
  id: number;
  from: string;
  payload: SignalPayload;
}

/** How the browser connects to the call: the built-in service with its relays, or LiveKit with a token. */
export type JoinInfo =
  | { provider: "builtin"; iceServers: { urls: string | string[]; username?: string; credential?: string }[] }
  | { provider: "livekit"; url: string; token: string };

export interface RoomSnapshot {
  meeting: Meeting;
  peers: Peer[];
  signals: Signal[];
  consents: Consent[];
  lines: TranscriptLine[];
  /** For the studio: clients waiting to be let in. */
  waiting?: { id: string; name: string }[];
  /** This browser: let in yet, and when someone in the studio last muted it. */
  you?: { admitted: boolean; mutedAt: string | null };
}

export const HOST_ACTIONS = ["admit", "decline", "mute", "remove", "mute-all"] as const;
export type HostAction = (typeof HOST_ACTIONS)[number];

export const peerStateSchema = z
  .object({
    mic: z.boolean(),
    cam: z.boolean(),
    screen: z.boolean(),
    hand: z.boolean(),
    reaction: z.object({ emoji: z.enum(CALL_REACTIONS), at: z.number().int().min(0) }).strict().optional(),
  })
  .strict();

export const roomActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join"), peerId: z.uuid(), state: peerStateSchema }).strict(),
  z.object({ action: z.literal("poll"), peerId: z.uuid(), state: peerStateSchema.optional(), afterSignal: z.number().int().min(0), afterLine: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal("signal"), peerId: z.uuid(), to: z.uuid(), payloads: z.array(signalPayloadSchema).min(1).max(50) }).strict(),
  z.object({ action: z.literal("leave"), peerId: z.uuid() }).strict(),
  z.object({ action: z.literal("record"), peerId: z.uuid(), on: z.boolean(), captions: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("consent"), decision: z.enum(["given", "declined"]) }).strict(),
  z.object({ action: z.literal("caption"), peerId: z.uuid(), lines: z.array(transcriptLineInput.omit({ speaker: true })).min(1).max(20) }).strict(),
  z.object({ action: z.literal("end"), peerId: z.uuid() }).strict(),
  z.object({ action: z.literal("host"), peerId: z.uuid(), what: z.enum(HOST_ACTIONS), target: z.uuid().optional() }).strict(),
]);
export type RoomAction = z.infer<typeof roomActionSchema>;

/** A peer that has not been heard from for this long has left. */
export const PEER_TIMEOUT_MS = 20_000;
/** Largest call on the built-in service; every person sends to every other, so more gets slow. */
export const BUILTIN_MAX_PEERS = 6;

/** A room with nobody in it, for screens that have not heard from the call yet. */
export const EMPTY_ROOM: Omit<RoomSnapshot, "meeting"> = { peers: [], signals: [], consents: [], lines: [] };
