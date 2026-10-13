"use client";
import { uploadToProject } from "@/lib/studio/uploads";
import {
  ASSISTANT_KEY,
  ASSISTANT_NAME,
  EMPTY_ROOM,
  findMentions,
  parseTranscript,
  quickNotes,
  type Attachment,
  type Channel,
  type ChannelChange,
  type CommsPerson,
  type JoinInfo,
  type Meeting,
  type MeetingChange,
  type NewChannel,
  type NewMeeting,
  type Peer,
  type Post,
  type ReactionEmoji,
  type RoomAction,
  type RoomSnapshot,
  type TranscriptLine,
} from "./types";
import type { Project } from "@/lib/studio/types";

/**
 * Meetings and conversations as the browser reaches them: the server for a
 * signed-in studio (or an invited client, through their page's link), or this
 * browser's own storage in the open demo, where there is one person and calls
 * are a test of the camera and microphone.
 */

export interface ChannelList {
  channels: Channel[];
  people: { key: string; name: string }[];
  me: CommsPerson;
  canManage: boolean;
}

export interface Recording {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  durationSec: number;
  status: "saved" | "transcribing" | "transcribed" | "failed";
  error: string | null;
  createdAt: string;
  /** Demo only: the recording itself, for as long as the page is open. */
  url?: string;
}

export interface MeetingDetail {
  meeting: Meeting;
  transcript: TranscriptLine[];
  recordings: Recording[];
}

export type JoinResult = { meeting: Meeting; peer: Peer; join: JoinInfo };

export interface CommsBackend {
  mode: "server" | "demo";
  /** "team" for the studio, "client" on an invited client's page. */
  audience: "team" | "client";
  channels(): Promise<ChannelList>;
  createChannel(input: NewChannel): Promise<Channel>;
  updateChannel(id: string, change: ChannelChange): Promise<Channel>;
  posts(channelId: string, before?: string): Promise<Post[]>;
  post(channelId: string, input: { body: string; parentId?: string | null; files?: File[] }, onProgress?: (f: number) => void): Promise<{ post: Post; assistantAnswering: boolean }>;
  thread(postId: string): Promise<{ post: Post; replies: Post[] }>;
  editPost(postId: string, body: string): Promise<Post>;
  /** Adds or takes back this person's emoji on a post. */
  react(postId: string, emoji: ReactionEmoji, on: boolean): Promise<Post>;
  deletePost(postId: string): Promise<void>;
  fileUrl(post: Post, file: Attachment, view?: boolean): string;
  meetings(range?: { from?: string; to?: string }): Promise<Meeting[]>;
  meeting(id: string): Promise<MeetingDetail>;
  createMeeting(input: NewMeeting): Promise<Meeting>;
  updateMeeting(id: string, change: MeetingChange): Promise<Meeting>;
  uploadTranscript(id: string, text: string): Promise<TranscriptLine[]>;
  takeNotes(id: string): Promise<Meeting>;
  /** Server only: makes action items into tasks and returns the project as it is now. */
  makeTasks(id: string, itemIds?: string[]): Promise<{ meeting: Meeting; project?: Project }>;
  join(id: string, peerId: string, state: Peer["state"]): Promise<JoinResult>;
  room(id: string, action: Exclude<RoomAction, { action: "join" }>): Promise<RoomSnapshot & { ok?: boolean; ended?: boolean }>;
  saveRecording(id: string, file: Blob, durationSec: number): Promise<Recording>;
  retryTranscription(id: string, recordingId: string): Promise<void>;
  recordingUrl(meetingId: string, recording: Recording, view?: boolean): string;
  transcriptUrl(meetingId: string): string | null;
}

export async function commsRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || "That didn't work. Please retry."), { status: res.status });
  return body as T;
}

const extensionFor = (type: string) => (type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm");

/** The server: /api/projects/<slug> for the studio, /api/client/<token> for an invited client. */
export function serverComms(base: string, audience: "team" | "client", projectId: string): CommsBackend {
  const send = <T,>(path: string, method: string, body?: unknown) =>
    commsRequest<T>(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const roomPath = (id: string) => `/meetings/${id}/room`;
  return {
    mode: "server",
    audience,
    channels: () => commsRequest<ChannelList>(`${base}/conversations`),
    createChannel: async (input) => (await send<{ channel: Channel }>("/conversations", "POST", input)).channel,
    updateChannel: async (id, change) => (await send<{ channel: Channel }>(`/conversations/${id}`, "PATCH", change)).channel,
    posts: async (channelId, before) =>
      (await commsRequest<{ posts: Post[] }>(`${base}/conversations/${channelId}/posts${before ? `?before=${encodeURIComponent(before)}` : ""}`)).posts,
    post: async (channelId, input, onProgress) => {
      const attachments = [];
      for (const [i, f] of (input.files ?? []).entries()) {
        const storageKey = await uploadToProject(projectId, f, (p) => onProgress?.((i + p) / (input.files!.length || 1)));
        attachments.push({ storageKey, name: f.name, sizeBytes: f.size, contentType: f.type || undefined });
      }
      return send(`/conversations/${channelId}/posts`, "POST", { body: input.body, parentId: input.parentId ?? null, ...(attachments.length ? { attachments } : {}) });
    },
    thread: (postId) => commsRequest(`${base}/conversations/posts/${postId}`),
    editPost: async (postId, body) => (await send<{ post: Post }>(`/conversations/posts/${postId}`, "PATCH", { body })).post,
    react: async (postId, emoji, on) => (await send<{ post: Post }>(`/conversations/posts/${postId}`, "PATCH", { react: emoji, on })).post,
    deletePost: async (postId) => void (await send(`/conversations/posts/${postId}`, "DELETE")),
    fileUrl: (post, file, view) => `${base}/conversations/posts/${post.id}/files/${file.id}${view ? "?view=1" : ""}`,
    meetings: async (range) => {
      const q = new URLSearchParams();
      if (range?.from) q.set("from", range.from);
      if (range?.to) q.set("to", range.to);
      return (await commsRequest<{ meetings: Meeting[] }>(`${base}/meetings${q.size ? `?${q}` : ""}`)).meetings;
    },
    meeting: (id) => commsRequest(`${base}/meetings/${id}`),
    createMeeting: async (input) => (await send<{ meeting: Meeting }>("/meetings", "POST", input)).meeting,
    updateMeeting: async (id, change) => (await send<{ meeting: Meeting }>(`/meetings/${id}`, "PATCH", change)).meeting,
    uploadTranscript: async (id, text) => (await send<{ lines: TranscriptLine[] }>(`/meetings/${id}/transcript`, "POST", { text })).lines,
    takeNotes: async (id) => (await send<{ meeting: Meeting }>(`/meetings/${id}/notes`, "POST")).meeting,
    makeTasks: (id, itemIds) => send(`/meetings/${id}/tasks`, "POST", itemIds ? { itemIds } : {}),
    join: (id, peerId, state) => send(roomPath(id), "POST", { action: "join", peerId, state }),
    room: (id, action) => send(roomPath(id), "POST", action),
    saveRecording: async (id, file, durationSec) => {
      const name = `Meeting recording ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "h")}.${extensionFor(file.type)}`;
      const storageKey = await uploadToProject(projectId, new File([file], name, { type: file.type }));
      return (await send<{ recording: Recording }>(`/meetings/${id}/recordings`, "POST", { storageKey, name, contentType: file.type || undefined, durationSec })).recording;
    },
    retryTranscription: async (id, recordingId) => void (await send(`/meetings/${id}/recordings/${recordingId}`, "POST")),
    recordingUrl: (meetingId, r, view) => `${base}/meetings/${meetingId}/recordings/${r.id}${view ? "?view=1" : ""}`,
    transcriptUrl: (meetingId) => `${base}/meetings/${meetingId}/transcript?format=txt`,
  };
}

// ---------------------------------------------------------------------------
// The open demo: everything in this browser
// ---------------------------------------------------------------------------

interface DemoComms {
  channels: Channel[];
  posts: (Post & { files?: Record<string, string> })[];
  meetings: Meeting[];
  lines: (TranscriptLine & { meetingId: string })[];
  nextLine: number;
}

/** Files shared in the demo are kept in this browser, so they are kept small. */
export const DEMO_FILE_BYTES = 2 * 1024 * 1024;
const recordings = new Map<string, Recording[]>();

const readAsDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`${f.name} could not be read`));
    r.readAsDataURL(f);
  });

export function demoComms(projectId: string, me: CommsPerson): CommsBackend {
  const key = `fundur.comms.demo.${projectId}`;
  const now = () => new Date().toISOString();
  const read = (): DemoComms => {
    let data: DemoComms | null = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw) data = JSON.parse(raw) as DemoComms;
    } catch {
      /* A blocked or broken copy starts empty. */
    }
    data ??= { channels: [], posts: [], meetings: [], lines: [], nextLine: 1 };
    if (!data.channels.some((c) => c.isDefault))
      data.channels.unshift({ id: crypto.randomUUID(), name: "Everyone", description: "", visibility: "team", memberIds: [], isDefault: true, createdBy: me.key, createdAt: now(), lastMessageAt: null, unread: 0 });
    return data;
  };
  const write = (data: DemoComms) => {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      throw new Error("This browser could not keep the change. Free some space (or remove large files) and retry.");
    }
  };
  const change = <T,>(fn: (d: DemoComms) => T): T => {
    const d = read();
    const out = fn(d);
    write(d);
    return out;
  };
  const people = [{ key: me.key, name: me.name }, { key: ASSISTANT_KEY, name: ASSISTANT_NAME }];
  const strip = (p: DemoComms["posts"][number]): Post => {
    const { files: _f, ...post } = p;
    void _f;
    // Posts kept before reactions existed have none.
    return { ...post, reactions: post.reactions ?? [] };
  };
  const meetingOf = (d: DemoComms, id: string) => {
    const m = d.meetings.find((x) => x.id === id);
    if (!m) throw new Error("Meeting not found");
    return m;
  };
  const transcript = (d: DemoComms, id: string) => {
    const all = d.lines.filter((l) => l.meetingId === id);
    for (const source of ["upload", "recording", "live"] as const) {
      const lines = all.filter((l) => l.source === source);
      if (lines.length) return lines.map(({ meetingId: _m, ...l }) => (void _m, l));
    }
    return [];
  };
  const addSystemReply = (d: DemoComms, m: Meeting, body: string, authorName = "Fundur") => {
    if (!m.postId) return;
    const root = d.posts.find((p) => p.id === m.postId);
    if (!root) return;
    d.posts.push({ id: crypto.randomUUID(), channelId: root.channelId, parentId: root.id, authorKey: me.key, authorName, authorKind: "system", body, attachments: [], mentions: [], meetingId: m.id, replyCount: 0, lastReplyAt: null, createdAt: now(), editedAt: null, reactions: [] });
    root.replyCount += 1;
    root.lastReplyAt = now();
  };
  const peer = (peerId: string, state: Peer["state"]): Peer => ({ id: peerId, personKey: me.key, name: me.name, kind: "team", state, joinedAt: now() });
  let roomPeer: Peer | null = null;
  return {
    mode: "demo",
    audience: "team",
    channels: async () => {
      const d = read();
      write(d);
      return { channels: d.channels.filter((c) => !("archived" in c)), people, me, canManage: true };
    },
    createChannel: async (input) =>
      change((d) => {
        const channel: Channel = { id: crypto.randomUUID(), name: input.name, description: input.description ?? "", visibility: input.visibility ?? "team", memberIds: [], isDefault: false, createdBy: me.key, createdAt: now(), lastMessageAt: null, unread: 0 };
        d.channels.push(channel);
        return channel;
      }),
    updateChannel: async (id, ch) =>
      change((d) => {
        const c = d.channels.find((x) => x.id === id);
        if (!c) throw new Error("Channel not found");
        if (c.isDefault && ch.archived) throw new Error("The Everyone channel stays");
        Object.assign(c, { ...(ch.name ? { name: ch.name } : {}), ...(ch.description !== undefined ? { description: ch.description } : {}), ...(ch.visibility ? { visibility: ch.visibility } : {}) });
        if (ch.archived) d.channels = d.channels.filter((x) => x.id !== id);
        return c;
      }),
    posts: async (channelId) => read().posts.filter((p) => p.channelId === channelId && !p.parentId).slice(-200).map(strip),
    post: async (channelId, input) => {
      const files: Record<string, string> = {};
      const attachments: Attachment[] = [];
      for (const f of input.files ?? []) {
        if (f.size > DEMO_FILE_BYTES) throw new Error(`${f.name} is over 2 MB. In the demo, files stay in this browser; sign in to share larger files.`);
        const id = crypto.randomUUID();
        files[id] = await readAsDataUrl(f);
        attachments.push({ id, name: f.name, sizeBytes: f.size, contentType: f.type || "application/octet-stream" });
      }
      const post = change((d) => {
        const parent = input.parentId ? d.posts.find((p) => p.id === input.parentId) : undefined;
        const root = parent?.parentId ? d.posts.find((p) => p.id === parent.parentId) : parent;
        const p: DemoComms["posts"][number] = {
          id: crypto.randomUUID(),
          channelId,
          parentId: root?.id ?? null,
          authorKey: me.key,
          authorName: me.name,
          authorKind: "team",
          body: input.body.trim(),
          attachments,
          mentions: findMentions(input.body, people),
          meetingId: root?.meetingId ?? null,
          replyCount: 0,
          lastReplyAt: null,
          createdAt: now(),
          editedAt: null,
          reactions: [],
          files,
        };
        d.posts.push(p);
        if (root) {
          root.replyCount += 1;
          root.lastReplyAt = p.createdAt;
        }
        const c = d.channels.find((x) => x.id === channelId);
        if (c) c.lastMessageAt = p.createdAt;
        // Keep the demo's storage from filling up.
        if (d.posts.length > 3000) d.posts = d.posts.slice(-3000);
        return p;
      });
      return { post: strip(post), assistantAnswering: false };
    },
    thread: async (postId) => {
      const d = read();
      const p = d.posts.find((x) => x.id === postId);
      if (!p) throw new Error("Post not found");
      const root = p.parentId ? d.posts.find((x) => x.id === p.parentId)! : p;
      return { post: strip(root), replies: d.posts.filter((x) => x.parentId === root.id).map(strip) };
    },
    editPost: async (postId, body) =>
      change((d) => {
        const p = d.posts.find((x) => x.id === postId);
        if (!p) throw new Error("Post not found");
        p.body = body.trim();
        p.editedAt = now();
        p.mentions = findMentions(body, people);
        return strip(p);
      }),
    react: async (postId, emoji, on) =>
      change((d) => {
        const p = d.posts.find((x) => x.id === postId);
        if (!p) throw new Error("Post not found");
        const list = (p.reactions ??= []);
        let r = list.find((x) => x.emoji === emoji);
        if (!r) list.push((r = { emoji, people: [] }));
        r.people = r.people.filter((x) => x.key !== me.key);
        if (on) r.people.push({ key: me.key, name: me.name });
        p.reactions = list.filter((x) => x.people.length);
        return strip(p);
      }),
    deletePost: async (postId) =>
      change((d) => {
        const p = d.posts.find((x) => x.id === postId);
        if (p?.parentId) {
          const root = d.posts.find((x) => x.id === p.parentId);
          if (root) root.replyCount = Math.max(0, root.replyCount - 1);
        }
        d.posts = d.posts.filter((x) => x.id !== postId && x.parentId !== postId);
      }),
    fileUrl: (post, file) => read().posts.find((p) => p.id === post.id)?.files?.[file.id] ?? "#",
    meetings: async (range) =>
      read()
        .meetings.filter((m) => (!range?.from || m.startsAt >= range.from) && (!range?.to || m.startsAt < range.to))
        .map((m) => ({ ...m, hasTranscript: read().lines.some((l) => l.meetingId === m.id), recordings: recordings.get(m.id)?.length ?? 0 }))
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    meeting: async (id) => {
      const d = read();
      const m = meetingOf(d, id);
      return { meeting: { ...m, hasTranscript: transcript(d, id).length > 0, recordings: recordings.get(id)?.length ?? 0 }, transcript: transcript(d, id), recordings: recordings.get(id) ?? [] };
    },
    createMeeting: async (input) =>
      change((d) => {
        let channel = (input.channelId && d.channels.find((c) => c.id === input.channelId)) || d.channels.find((c) => c.isDefault)!;
        if (input.clientVisible && channel.visibility !== "client") {
          channel = d.channels.find((c) => c.visibility === "client") ?? { id: crypto.randomUUID(), name: "Client", description: "Conversations with the client", visibility: "client", memberIds: [], isDefault: false, createdBy: me.key, createdAt: now(), lastMessageAt: null, unread: 0 };
          if (!d.channels.includes(channel)) d.channels.push(channel);
        }
        const id = crypto.randomUUID();
        const post: DemoComms["posts"][number] = {
          id: crypto.randomUUID(),
          channelId: channel.id,
          parentId: null,
          authorKey: me.key,
          authorName: me.name,
          authorKind: "system",
          body: `Meeting: ${input.title} · ${new Date(input.startsAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${input.durationMin ?? 30} min)${input.agenda ? `\n${input.agenda}` : ""}`,
          attachments: [],
          mentions: [],
          meetingId: id,
          replyCount: 0,
          lastReplyAt: null,
          createdAt: now(),
          editedAt: null,
          reactions: [],
        };
        d.posts.push(post);
        const meeting: Meeting = {
          id,
          projectId,
          title: input.title,
          agenda: input.agenda ?? "",
          startsAt: new Date(input.startsAt).toISOString(),
          durationMin: input.durationMin ?? 30,
          status: "scheduled",
          provider: "builtin",
          clientVisible: !!input.clientVisible,
          channelId: channel.id,
          postId: post.id,
          recording: "off",
          recordingBy: null,
          captions: false,
          notes: null,
          notesSource: null,
          notesAt: null,
          createdBy: me.key,
          createdAt: now(),
          startedAt: null,
          endedAt: null,
          inCall: 0,
          hasTranscript: false,
          recordings: 0,
        };
        d.meetings.push(meeting);
        return meeting;
      }),
    updateMeeting: async (id, ch) =>
      change((d) => {
        const m = meetingOf(d, id);
        const { notes, startsAt, ...rest } = ch;
        Object.assign(m, rest, startsAt ? { startsAt: new Date(startsAt).toISOString() } : {});
        // Linking action items to tasks keeps whoever wrote the notes.
        const bare = (n: Meeting["notes"]) => JSON.stringify(n && { ...n, actionItems: n.actionItems.map(({ taskId: _t, ...a }) => (void _t, a)) });
        if (notes && bare(notes) !== bare(m.notes)) Object.assign(m, { notes, notesSource: "manual", notesAt: now() });
        else if (notes) m.notes = notes;
        if (ch.status === "cancelled") addSystemReply(d, m, `${me.name} cancelled this meeting.`);
        return m;
      }),
    uploadTranscript: async (id, text) => {
      const lines = parseTranscript(text);
      if (!lines.length) throw new Error("No words were found in that transcript");
      return change((d) => {
        meetingOf(d, id);
        d.lines = d.lines.filter((l) => !(l.meetingId === id && l.source === "upload"));
        for (const l of lines) d.lines.push({ ...l, id: String(d.nextLine++), source: "upload", meetingId: id });
        return transcript(d, id);
      });
    },
    takeNotes: async (id) =>
      change((d) => {
        const m = meetingOf(d, id);
        const lines = transcript(d, id);
        if (!lines.length) throw new Error("There is no transcript to take notes from yet");
        const notes = quickNotes(lines);
        Object.assign(m, { notes, notesSource: "quick", notesAt: now() });
        addSystemReply(d, m, `Quick meeting notes are ready.\n\n${notes.summary}`, "Meeting notes");
        return m;
      }),
    makeTasks: async () => {
      throw new Error("In the demo, tasks are added from this page");
    },
    join: async (id, peerId, state) =>
      change((d) => {
        const m = meetingOf(d, id);
        if (m.status === "cancelled") throw new Error("This meeting was cancelled");
        if (!m.startedAt) addSystemReply(d, m, `${me.name} started the call.`);
        Object.assign(m, { status: "live", startedAt: m.startedAt ?? now(), endedAt: null });
        roomPeer = peer(peerId, state);
        return { meeting: m, peer: roomPeer, join: { provider: "builtin", iceServers: [] } as JoinInfo };
      }),
    room: async (id, a) =>
      change((d) => {
        const m = meetingOf(d, id);
        if (a.action === "poll" && roomPeer && a.state) roomPeer.state = a.state;
        if (a.action === "record") {
          Object.assign(m, { recording: a.on ? "on" : "off", recordingBy: a.on ? me.key : null, captions: a.on && a.captions !== false });
          addSystemReply(d, m, a.on ? `${me.name} started recording${a.captions !== false ? " and transcribing" : ""}.` : `${me.name} stopped recording.`);
        }
        if (a.action === "caption")
          for (const l of a.lines) d.lines.push({ id: String(d.nextLine++), speaker: me.name, atMs: l.atMs, text: l.text, source: "live", meetingId: id });
        let ended = false;
        if (a.action === "leave" || a.action === "end") {
          roomPeer = null;
          if (m.status === "live") {
            const minutes = m.startedAt ? Math.max(1, Math.round((Date.now() - Date.parse(m.startedAt)) / 60_000)) : 0;
            Object.assign(m, { status: "ended", endedAt: now(), recording: "off", captions: false });
            addSystemReply(d, m, `The call ended${minutes ? ` after ${minutes} min` : ""}.`);
            ended = true;
          }
        }
        const after = a.action === "poll" ? a.afterLine : 0;
        return {
          ...EMPTY_ROOM,
          meeting: m,
          peers: roomPeer ? [roomPeer] : [],
          consents: m.recording === "on" ? [{ personKey: me.key, name: me.name, decision: "given" as const, decidedAt: now() }] : [],
          lines: d.lines.filter((l) => l.meetingId === id && Number(l.id) > after).map(({ meetingId: _m, ...l }) => (void _m, l)),
          ended,
        };
      }),
    saveRecording: async (id, file, durationSec) => {
      const r: Recording = { id: crypto.randomUUID(), name: `Recording.${extensionFor(file.type)}`, contentType: file.type, sizeBytes: file.size, durationSec, status: "saved", error: "Kept in this browser until you leave the page. Sign in to keep recordings and have them transcribed.", createdAt: now(), url: URL.createObjectURL(file) };
      recordings.set(id, [...(recordings.get(id) ?? []), r]);
      return r;
    },
    retryTranscription: async () => {
      throw new Error("Transcribing recordings needs you to be signed in");
    },
    recordingUrl: (_m, r) => r.url ?? "#",
    transcriptUrl: () => null,
  };
}
