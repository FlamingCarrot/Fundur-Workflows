"use client";
import { uploadThrough } from "@/lib/studio/uploads";
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
  type ChannelMine,
  type ChannelPresence,
  type CommsPerson,
  type JoinInfo,
  type LinkPreview,
  type Meeting,
  type MeetingChange,
  type NewChannel,
  type NewMeeting,
  type Peer,
  type Post,
  type ReactionEmoji,
  type RoomAction,
  type RoomSnapshot,
  type ScheduledPost,
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
  /** A repeating meeting's next occurrence. */
  next?: { id: string; startsAt: string } | null;
}

/** `join` is null while a client waits to be let in; they join again once they are. */
export interface SearchFilters {
  /** Someone's key. */
  from?: string;
  channelId?: string;
  files?: boolean;
}

export type SavedPost = Post & { channelName: string; remindAt: string | null };

export type JoinResult = { meeting: Meeting; peer: Peer; join: JoinInfo | null };

export interface CommsBackend {
  mode: "server" | "demo";
  /** "team" for the studio, "client" on an invited client's page. */
  audience: "team" | "client";
  channels(): Promise<ChannelList>;
  createChannel(input: NewChannel): Promise<Channel>;
  updateChannel(id: string, change: ChannelChange): Promise<Channel>;
  /** Studio only: the direct conversation with a teammate, started when there is none. */
  openDirect(personKey: string): Promise<Channel>;
  /** A channel's posts (the latest, or those before a time) and, for the latest, what is pinned and who else is reading or typing. */
  posts(channelId: string, before?: string, peek?: boolean): Promise<{ posts: Post[]; pinned: Post[]; presence: ChannelPresence; readBefore?: string | null }>;
  /** Every post and reply in a channel with files, newest first. */
  files(channelId: string): Promise<Post[]>;
  /** Tells the channel this person is typing, or mutes or unmutes it for them. */
  mine(channelId: string, change: ChannelMine): Promise<void>;
  /** Studio only: pins a post to the top of its channel, or takes it off. */
  pin(postId: string, on: boolean): Promise<Post>;
  /** Posts and replies in this person's channels containing the words searched for. */
  search(query: string, filters?: SearchFilters): Promise<(Post & { channelName: string })[]>;
  /** The threads this person is in, newest reply first. */
  threads(): Promise<(Post & { channelName: string; unread: boolean })[]>;
  post(
    channelId: string,
    input: { body: string; parentId?: string | null; files?: File[]; ask?: { options: string[] } },
    onProgress?: (f: number) => void,
  ): Promise<{ post: Post; assistantAnswering: boolean }>;
  /** Picks one of the options a post asks about. */
  answer(postId: string, option: number): Promise<Post>;
  /** A thread, and whether this person hears about each reply in it. */
  thread(postId: string): Promise<{ post: Post; replies: Post[]; following?: boolean }>;
  /** Studio, signed in: makes a post into a task on the project. */
  postToTask(postId: string, input: { title: string; due?: string }): Promise<{ taskId: string; project?: Project }>;
  /** Follows a thread (every reply) or leaves it (only when named). */
  follow(postId: string, on: boolean): Promise<void>;
  editPost(postId: string, body: string): Promise<Post>;
  /** Adds or takes back this person's emoji on a post. */
  react(postId: string, emoji: ReactionEmoji, on: boolean): Promise<Post>;
  deletePost(postId: string): Promise<void>;
  /** Studio only: writes a post now that goes out at `sendAt`. */
  schedule(channelId: string, input: { body: string; parentId?: string | null; files?: File[]; ask?: { options: string[] }; sendAt: string }, onProgress?: (f: number) => void): Promise<ScheduledPost>;
  /** This person's posts in a channel waiting to go out. */
  scheduled(channelId: string): Promise<ScheduledPost[]>;
  /** Cancels a post waiting to go out, or sends it now (and returns it). */
  unschedule(id: string, sendNow: boolean): Promise<Post | null>;
  /** Saves a post for later, with a reminder when asked, or takes it off the list. */
  save(postId: string, saved: boolean, remindAt?: string | null): Promise<void>;
  /** The posts this person saved, newest saved first. */
  saved(): Promise<SavedPost[]>;
  /** Studio only: forwards a post into another channel, with a note. */
  forward(postId: string, channelId: string, note?: string): Promise<Post>;
  /** What the first web address in a post shows; null where there is none (or in the demo). */
  preview(postId: string): Promise<LinkPreview | null>;
  /** Where the preview's picture is served from (by us, not the supplier). */
  previewImageUrl(postId: string): string;
  /** Studio, signed in: the assistant drafts a reply to the post's thread. */
  draftReply(postId: string): Promise<string>;
  /** Studio, signed in: the post put into another language. */
  translate(postId: string, to: string): Promise<{ from: string; text: string }>;
  fileUrl(post: Post, file: Attachment, view?: boolean): string;
  meetings(range?: { from?: string; to?: string }): Promise<Meeting[]>;
  meeting(id: string): Promise<MeetingDetail>;
  createMeeting(input: NewMeeting): Promise<Meeting>;
  updateMeeting(id: string, change: MeetingChange): Promise<Meeting>;
  uploadTranscript(id: string, text: string): Promise<TranscriptLine[]>;
  takeNotes(id: string): Promise<Meeting>;
  /** Studio, signed in: the assistant prepares an agenda from the project's open work (not saved). */
  draftAgenda(id: string): Promise<string>;
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
export function serverComms(base: string, audience: "team" | "client"): CommsBackend {
  const send = <T,>(path: string, method: string, body?: unknown) =>
    commsRequest<T>(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const roomPath = (id: string) => `/meetings/${id}/room`;
  const uploadAll = async (files: File[] | undefined, onProgress?: (f: number) => void) => {
    const attachments = [];
    for (const [i, f] of (files ?? []).entries()) {
      const storageKey = await uploadThrough(`${base}/uploads`, f, (p) => onProgress?.((i + p) / (files!.length || 1)), undefined, audience === "client" ? 25 * 1024 * 1024 : undefined);
      attachments.push({ storageKey, name: f.name, sizeBytes: f.size, contentType: f.type || undefined });
    }
    return attachments;
  };
  return {
    mode: "server",
    audience,
    channels: () => commsRequest<ChannelList>(`${base}/conversations`),
    createChannel: async (input) => (await send<{ channel: Channel }>("/conversations", "POST", input)).channel,
    updateChannel: async (id, change) => (await send<{ channel: Channel }>(`/conversations/${id}`, "PATCH", change)).channel,
    openDirect: async (personKey) => (await send<{ channel: Channel }>("/conversations/direct", "POST", { with: personKey })).channel,
    posts: async (channelId, before, peek) => {
      const q = new URLSearchParams();
      if (before) q.set("before", before);
      if (peek) q.set("peek", "1");
      const r = await commsRequest<{ posts: Post[]; pinned?: Post[]; presence?: ChannelPresence; readBefore?: string | null }>(
        `${base}/conversations/${channelId}/posts${q.size ? `?${q}` : ""}`,
      );
      return { posts: r.posts, pinned: r.pinned ?? [], presence: r.presence ?? NO_PRESENCE, readBefore: r.readBefore ?? null };
    },
    mine: async (channelId, change) => void (await send(`/conversations/${channelId}/mine`, "POST", change)),
    files: async (channelId) => (await commsRequest<{ posts: Post[] }>(`${base}/conversations/${channelId}/files`)).posts,
    pin: async (postId, on) => (await send<{ post: Post }>(`/conversations/posts/${postId}`, "PATCH", { pin: on })).post,
    search: async (query, filters) => {
      const q = new URLSearchParams({ q: query });
      if (filters?.from) q.set("from", filters.from);
      if (filters?.channelId) q.set("in", filters.channelId);
      if (filters?.files) q.set("files", "1");
      return (await commsRequest<{ results: (Post & { channelName: string })[] }>(`${base}/conversations/search?${q}`)).results;
    },
    threads: async () => (await commsRequest<{ threads: (Post & { channelName: string; unread: boolean })[] }>(`${base}/conversations/threads`)).threads,
    post: async (channelId, input, onProgress) => {
      const attachments = await uploadAll(input.files, onProgress);
      return send(`/conversations/${channelId}/posts`, "POST", {
        body: input.body,
        parentId: input.parentId ?? null,
        ...(attachments.length ? { attachments } : {}),
        ...(input.ask ? { ask: input.ask } : {}),
      });
    },
    schedule: async (channelId, input, onProgress) => {
      const attachments = await uploadAll(input.files, onProgress);
      const r = await send<{ scheduled: ScheduledPost }>(`/conversations/${channelId}/posts`, "POST", {
        body: input.body,
        parentId: input.parentId ?? null,
        ...(attachments.length ? { attachments } : {}),
        ...(input.ask ? { ask: input.ask } : {}),
        sendAt: input.sendAt,
      });
      return r.scheduled;
    },
    scheduled: async (channelId) => (await commsRequest<{ scheduled: ScheduledPost[] }>(`${base}/conversations/${channelId}/scheduled`)).scheduled,
    unschedule: async (id, sendNow) => (await send<{ post: Post | null }>(`/conversations/scheduled/${id}`, sendNow ? "POST" : "DELETE")).post,
    save: async (postId, saved, remindAt) => void (await send(`/conversations/posts/${postId}/save`, "POST", { saved, ...(remindAt ? { remindAt } : {}) })),
    saved: async () => (await commsRequest<{ saved: SavedPost[] }>(`${base}/conversations/saved`)).saved,
    draftReply: async (postId) => (await send<{ draft: string }>(`/conversations/posts/${postId}/draft`, "POST", {})).draft,
    translate: (postId, to) => send(`/conversations/posts/${postId}/translate`, "POST", { to }),
    previewImageUrl: (postId) => `${base}/conversations/posts/${postId}/preview/image`,
    preview: async (postId) => (await commsRequest<{ preview: LinkPreview | null }>(`${base}/conversations/posts/${postId}/preview`)).preview,
    forward: async (postId, channelId, note) => (await send<{ post: Post }>(`/conversations/posts/${postId}/forward`, "POST", { channelId, ...(note?.trim() ? { note } : {}) })).post,
    answer: async (postId, option) => (await send<{ post: Post }>(`/conversations/posts/${postId}`, "PATCH", { answer: option })).post,
    postToTask: (postId, input) => send(`/conversations/posts/${postId}/task`, "POST", input),
    follow: async (postId, on) => void (await send(`/conversations/posts/${postId}`, "PATCH", { follow: on })),
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
    draftAgenda: async (id) => (await send<{ agenda: string }>(`/meetings/${id}/agenda`, "POST", {})).agenda,
    makeTasks: (id, itemIds) => send(`/meetings/${id}/tasks`, "POST", itemIds ? { itemIds } : {}),
    join: (id, peerId, state) => send(roomPath(id), "POST", { action: "join", peerId, state }),
    room: (id, action) => send(roomPath(id), "POST", action),
    saveRecording: async (id, file, durationSec) => {
      const name = `Meeting recording ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "h")}.${extensionFor(file.type)}`;
      const storageKey = await uploadThrough(`${base}/uploads`, new File([file], name, { type: file.type }));
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
  saved?: { postId: string; remindAt: string | null }[];
  scheduled?: (ScheduledPost & { ask: { options: string[] } | null })[];
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

const NO_PRESENCE: ChannelPresence = { seen: [], typing: [] };

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
      data.channels.unshift({ id: crypto.randomUUID(), name: "Everyone", description: "", visibility: "team", memberIds: [], isDefault: true, createdBy: me.key, createdAt: now(), lastMessageAt: null, unread: 0, muted: false, direct: false });
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
    return { ...post, reactions: post.reactions ?? [], pinnedAt: post.pinnedAt ?? null, ask: post.ask ?? null };
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
    d.posts.push({ id: crypto.randomUUID(), channelId: root.channelId, parentId: root.id, authorKey: me.key, authorName, authorKind: "system", body, attachments: [], mentions: [], meetingId: m.id, replyCount: 0, lastReplyAt: null, createdAt: now(), editedAt: null, reactions: [], pinnedAt: null, ask: null });
    root.replyCount += 1;
    root.lastReplyAt = now();
  };
  const addPost = (d: DemoComms, channelId: string, body: string, parentId: string | null, attachments: Attachment[], files: Record<string, string>, ask: { options: string[] } | null) => {
    const parent = parentId ? d.posts.find((p) => p.id === parentId) : undefined;
    const root = parent?.parentId ? d.posts.find((p) => p.id === parent.parentId) : parent;
    const p: DemoComms["posts"][number] = {
      id: crypto.randomUUID(),
      channelId,
      parentId: root?.id ?? null,
      authorKey: me.key,
      authorName: me.name,
      authorKind: "team",
      body: body.trim(),
      attachments,
      mentions: findMentions(body, people),
      meetingId: root?.meetingId ?? null,
      replyCount: 0,
      lastReplyAt: null,
      createdAt: now(),
      ask: ask ? { options: ask.options, answers: [] } : null,
      editedAt: null,
      reactions: [],
      pinnedAt: null,
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
  };
  /** Posts written for later go out the next time the demo looks. */
  const deliverDue = () => {
    const d = read();
    const due = (d.scheduled ?? []).filter((x) => x.sendAt <= now());
    if (!due.length) return;
    d.scheduled = (d.scheduled ?? []).filter((x) => x.sendAt > now());
    for (const x of due) if (d.channels.some((c) => c.id === x.channelId)) addPost(d, x.channelId, x.body, x.parentId, [], {}, x.ask);
    write(d);
  };
  const peer = (peerId: string, state: Peer["state"]): Peer => ({ id: peerId, personKey: me.key, name: me.name, kind: "team", state, joinedAt: now(), admitted: true });
  let roomPeer: Peer | null = null;
  return {
    mode: "demo",
    audience: "team",
    channels: async () => {
      deliverDue();
      const d = read();
      write(d);
      return { channels: d.channels.filter((c) => !("archived" in c)).map((c) => ({ ...c, muted: !!c.muted })), people, me, canManage: true };
    },
    createChannel: async (input) =>
      change((d) => {
        const channel: Channel = { id: crypto.randomUUID(), name: input.name, description: input.description ?? "", visibility: input.visibility ?? "team", memberIds: [], isDefault: false, createdBy: me.key, createdAt: now(), lastMessageAt: null, unread: 0, muted: false, direct: false };
        d.channels.push(channel);
        return channel;
      }),
    openDirect: async () => {
      throw new Error("In the demo you are the only person here. Sign in to message your team.");
    },
    updateChannel: async (id, ch) =>
      change((d) => {
        const c = d.channels.find((x) => x.id === id);
        if (!c) throw new Error("Channel not found");
        if (c.isDefault && ch.archived) throw new Error("The Everyone channel stays");
        Object.assign(c, { ...(ch.name ? { name: ch.name } : {}), ...(ch.description !== undefined ? { description: ch.description } : {}), ...(ch.visibility ? { visibility: ch.visibility } : {}) });
        if (ch.archived) d.channels = d.channels.filter((x) => x.id !== id);
        return c;
      }),
    posts: async (channelId) => {
      deliverDue();
      const all = read().posts.filter((p) => p.channelId === channelId);
      return {
        posts: all.filter((p) => !p.parentId).slice(-200).map(strip),
        pinned: all.filter((p) => p.pinnedAt).sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!)).map(strip),
        presence: NO_PRESENCE,
      };
    },
    files: async (channelId) =>
      read()
        .posts.filter((p) => p.channelId === channelId && p.attachments.length)
        .reverse()
        .map(strip),
    mine: async (channelId, ch) => {
      if (!("muted" in ch)) return;
      change((d) => {
        const c = d.channels.find((x) => x.id === channelId);
        if (c) c.muted = ch.muted;
      });
    },
    answer: async (postId, option) =>
      change((d) => {
        const p = d.posts.find((x) => x.id === postId);
        if (!p?.ask) throw new Error("This post does not ask that");
        p.ask.answers = [...p.ask.answers.filter((x) => x.key !== me.key), { key: me.key, name: me.name, option, at: now() }];
        return strip(p);
      }),
    pin: async (postId, on) =>
      change((d) => {
        const p = d.posts.find((x) => x.id === postId);
        if (!p) throw new Error("Post not found");
        p.pinnedAt = on ? (p.pinnedAt ?? now()) : null;
        return strip(p);
      }),
    threads: async () => {
      const d = read();
      const names = new Map(d.channels.map((c) => [c.id, c.name]));
      return d.posts
        .filter((p) => !p.parentId && p.replyCount > 0)
        .sort((a, b) => (b.lastReplyAt ?? "").localeCompare(a.lastReplyAt ?? ""))
        .slice(0, 50)
        .map((p) => ({ ...strip(p), channelName: names.get(p.channelId) ?? "", unread: false }));
    },
    search: async (query, filters) => {
      const d = read();
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
      if (!words.length && !filters?.from && !filters?.channelId && !filters?.files) return [];
      const names = new Map(d.channels.map((c) => [c.id, c.name]));
      return d.posts
        .filter((p) => (!filters?.from || p.authorKey === filters.from) && (!filters?.channelId || p.channelId === filters.channelId) && (!filters?.files || p.attachments.length > 0))
        .filter((p) => p.authorKind !== "system" && words.every((w) => `${p.body} ${p.authorName} ${p.attachments.map((a) => a.name).join(" ")}`.toLowerCase().includes(w)))
        .slice(-40)
        .reverse()
        .map((p) => ({ ...strip(p), channelName: names.get(p.channelId) ?? "" }));
    },
    post: async (channelId, input) => {
      const files: Record<string, string> = {};
      const attachments: Attachment[] = [];
      for (const f of input.files ?? []) {
        if (f.size > DEMO_FILE_BYTES) throw new Error(`${f.name} is over 2 MB. In the demo, files stay in this browser; sign in to share larger files.`);
        const id = crypto.randomUUID();
        files[id] = await readAsDataUrl(f);
        attachments.push({ id, name: f.name, sizeBytes: f.size, contentType: f.type || "application/octet-stream" });
      }
      const post = change((d) => addPost(d, channelId, input.body, input.parentId ?? null, attachments, files, input.ask ?? null));
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
    schedule: async (channelId, input) => {
      if (input.files?.length) throw new Error("In the demo, posts sent later carry words only. Send files now, or sign in.");
      const at = Date.parse(input.sendAt);
      if (!(at > Date.now() + 30_000)) throw new Error("Pick a time still to come");
      return change((d) => {
        const x = { id: crypto.randomUUID(), channelId, parentId: input.parentId ?? null, body: input.body.trim(), files: [], sendAt: new Date(at).toISOString(), ask: input.ask ?? null };
        (d.scheduled ??= []).push(x);
        const { ask: _a, ...out } = x;
        void _a;
        return out;
      });
    },
    scheduled: async (channelId) => {
      deliverDue();
      return (read().scheduled ?? [])
        .filter((x) => x.channelId === channelId)
        .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
        .map(({ ask: _a, ...x }) => (void _a, x));
    },
    unschedule: async (id, sendNow) =>
      change((d) => {
        const x = (d.scheduled ?? []).find((y) => y.id === id);
        d.scheduled = (d.scheduled ?? []).filter((y) => y.id !== id);
        return x && sendNow ? strip(addPost(d, x.channelId, x.body, x.parentId, [], {}, x.ask)) : null;
      }),
    save: async (postId, on, remindAt) =>
      change((d) => {
        d.saved = (d.saved ?? []).filter((x) => x.postId !== postId);
        if (on) d.saved.unshift({ postId, remindAt: remindAt ?? null });
      }),
    saved: async () => {
      const d = read();
      const names = new Map(d.channels.map((c) => [c.id, c.name]));
      return (d.saved ?? []).flatMap((x) => {
        const p = d.posts.find((y) => y.id === x.postId);
        return p ? [{ ...strip(p), channelName: names.get(p.channelId) ?? "", remindAt: x.remindAt }] : [];
      });
    },
    draftAgenda: async () => {
      throw new Error("Sign in to have the assistant prepare agendas.");
    },
    preview: async () => null,
    previewImageUrl: () => "",
    follow: async () => undefined,
    postToTask: async () => {
      throw new Error("Sign in to make tasks from posts.");
    },
    draftReply: async () => {
      throw new Error("Sign in to have the assistant draft replies.");
    },
    translate: async () => {
      throw new Error("Sign in to translate posts.");
    },
    forward: async (postId, channelId, note) =>
      change((d) => {
        const p = d.posts.find((x) => x.id === postId);
        const from = d.channels.find((c) => c.id === p?.channelId);
        if (!p || !from) throw new Error("Post not found");
        const quoted = p.body.replace(/@/g, "@\u200b").split("\n").map((l) => `> ${l}`).join("\n");
        const body = `${note?.trim() ? `${note.trim()}\n\n` : ""}> Forwarded from **${p.authorName}** in #${from.name}, ${p.createdAt.slice(0, 10)}${p.body ? `\n${quoted}` : ""}`;
        return strip(addPost(d, channelId, body.slice(0, 5000), null, p.attachments, { ...p.files }, null));
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
          channel = d.channels.find((c) => c.visibility === "client") ?? { id: crypto.randomUUID(), name: "Client", description: "Conversations with the client", visibility: "client", memberIds: [], isDefault: false, createdBy: me.key, createdAt: now(), lastMessageAt: null, unread: 0, muted: false, direct: false };
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
          pinnedAt: null,
          ask: null,
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
          waitingRoom: true,
          repeat: input.repeat ?? "none",
          seriesId: null,
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
