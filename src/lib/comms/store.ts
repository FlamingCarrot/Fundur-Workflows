import { randomBytes } from "node:crypto";
import { firstWebLink, linkPreview, previewImage, type LinkPreview } from "./link-preview";
import type { Db } from "@/lib/db";
import { AccessError } from "@/lib/workspaces/store";
import { projectTeam } from "@/lib/team/store";
import { recordingAllowed } from "./calls";
import { BUILTIN_MAX_PEERS, PEER_TIMEOUT_MS, findMentions, postPreview, readReactions, type ReactionEmoji, type HostAction, type MeetingRepeat, REPEAT_LABEL, nextOccurrence, readAsk } from "./types";
import type {
  ScheduledPost,
  ChannelMine,
  ChannelPresence,
  Attachment,
  AttachmentInput,
  AuthorKind,
  Channel,
  ChannelChange,
  CommsPerson,
  Consent,
  Meeting,
  MeetingChange,
  MeetingNotes,
  NewChannel,
  NewMeeting,
  NewPost,
  NotesSource,
  Peer,
  PeerState,
  Post,
  RoomSnapshot,
  Signal,
  SignalPayload,
  TranscriptLine,
} from "./types";

/**
 * Meetings and conversations on the server. Every call works inside a scope:
 * one project, and the person acting, a teammate or an invited client. Clients
 * reach only what the studio opened to them: client channels and client
 * meetings. Teammates reach every channel they are in.
 */

export interface CommsScope {
  db: Db;
  workspaceId: string;
  /** The project's database id. */
  projectId: string;
  /** The project's slug, for links. */
  slug: string;
  person: CommsPerson;
  /** A workspace owner: may archive any channel, remove any post and end any meeting. */
  manager: boolean;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const isTeam = (s: CommsScope) => s.person.kind === "team";

function refuseClient(s: CommsScope, what = "Only the studio can do that") {
  if (!isTeam(s)) throw new AccessError(what, 403);
}

export const conversationsHref = (slug: string, channelId?: string, postId?: string) =>
  `/projects/${slug}/conversations${channelId ? `?channel=${channelId}${postId ? `&post=${postId}` : ""}` : ""}`;
export const meetingHref = (slug: string, meetingId: string) => `/projects/${slug}/conversations/meetings/${meetingId}`;

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

interface ChannelRow {
  id: string;
  name: string;
  description: string;
  visibility: "team" | "client";
  member_ids: string[];
  is_default: boolean;
  created_by: string;
  created_at: Date;
  last_message_at: Date | null;
  unread?: number;
  muted?: boolean;
  is_direct?: boolean;
}
const CHANNEL_COLUMNS = "c.id,c.name,c.description,c.visibility,c.member_ids,c.is_default,c.created_by,c.created_at,c.last_message_at,c.is_direct";

const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  name: r.name,
  description: r.description ?? "",
  visibility: r.visibility,
  memberIds: r.member_ids ?? [],
  isDefault: r.is_default,
  createdBy: r.created_by,
  createdAt: iso(r.created_at)!,
  lastMessageAt: iso(r.last_message_at),
  unread: Number(r.unread ?? 0),
  muted: !!r.muted,
  direct: !!r.is_direct,
});

/** Whether a person can see and post in a channel. */
export function canSee(channel: Pick<Channel, "visibility" | "memberIds" | "createdBy">, person: CommsPerson): boolean {
  if (person.kind === "client") return channel.visibility === "client";
  return !channel.memberIds.length || channel.createdBy === person.key || channel.memberIds.includes(person.key);
}

async function ensureDefault(s: CommsScope) {
  await s.db.query(
    `INSERT INTO project_chats(workspace_id,project_id,name,member_ids,created_by,is_default) VALUES($1,$2,'Everyone','{}',$3,TRUE)
     ON CONFLICT (project_id) WHERE is_default DO NOTHING`,
    [s.workspaceId, s.projectId, s.person.key],
  );
}

/** The channels this person is in, the default one first, with how many posts they have not read. */
export async function listChannels(s: CommsScope, opts: { archived?: boolean } = {}): Promise<Channel[]> {
  if (isTeam(s)) await ensureDefault(s);
  const rows = await s.db.query<ChannelRow>(
    `SELECT ${CHANNEL_COLUMNS},
       (SELECT count(*)::int FROM project_chat_messages m WHERE m.chat_id=c.id AND m.author_id<>$3
          AND m.created_at > COALESCE((SELECT r.read_at FROM project_chat_reads r WHERE r.chat_id=c.id AND r.person_key=$3), '-infinity'::timestamptz)) AS unread,
       COALESCE((SELECT r.muted FROM project_chat_reads r WHERE r.chat_id=c.id AND r.person_key=$3), FALSE) AS muted
     FROM project_chats c WHERE c.workspace_id=$1 AND c.project_id=$2 AND (c.archived_at IS NULL) <> $4
     ORDER BY c.is_default DESC, c.created_at`,
    [s.workspaceId, s.projectId, s.person.key, opts.archived === true],
  );
  const channels = rows.map(toChannel).filter((c) => canSee(c, s.person));
  if (!channels.some((c) => c.direct)) return channels;
  const names = new Map((await projectTeam(s.db, s.workspaceId, s.slug)).map((m) => [m.id, m.name]));
  return channels.map((c) => (c.direct ? { ...c, name: names.get(c.memberIds.find((k) => k !== s.person.key) ?? "") ?? "Former teammate" } : c));
}

/** The direct conversation between this person and another on the project, started when there is none. */
export async function openDirect(s: CommsScope, otherKey: string): Promise<Channel> {
  refuseClient(s);
  if (otherKey === s.person.key) throw new AccessError("Choose someone else", 400);
  const team = await projectTeam(s.db, s.workspaceId, s.slug);
  const other = team.find((m) => m.id === otherKey && m.active);
  if (!other) throw new AccessError("Choose someone who is on this project", 400);
  const pair = [s.person.key, otherKey].sort();
  const [found] = await s.db.query<{ id: string }>(
    "SELECT id FROM project_chats WHERE workspace_id=$1 AND project_id=$2 AND is_direct AND member_ids=$3::text[]",
    [s.workspaceId, s.projectId, pair],
  );
  const id =
    found?.id ??
    (
      await s.db.query<{ id: string }>(
        `INSERT INTO project_chats(workspace_id,project_id,name,description,visibility,member_ids,created_by,is_direct) VALUES($1,$2,'Direct message','','team',$3,$4,TRUE) RETURNING id`,
        [s.workspaceId, s.projectId, pair, s.person.key],
      )
    )[0].id;
  await s.db.query("UPDATE project_chats SET archived_at=NULL WHERE id=$1", [id]);
  return { ...(await getChannel(s, id)), name: other.name };
}

export async function getChannel(s: CommsScope, channelId: string): Promise<Channel> {
  const [row] = await s.db.query<ChannelRow>(
    `SELECT ${CHANNEL_COLUMNS} FROM project_chats c WHERE c.id=$1 AND c.workspace_id=$2 AND c.project_id=$3`,
    [channelId, s.workspaceId, s.projectId],
  );
  if (!row || !canSee(toChannel(row), s.person)) throw new AccessError("Channel not found", 404);
  return toChannel(row);
}

export async function createChannel(s: CommsScope, input: NewChannel): Promise<Channel> {
  refuseClient(s);
  const visibility = input.visibility ?? "team";
  let members: string[] = [];
  if (input.memberIds?.length) {
    if (visibility === "client") throw new AccessError("A client channel is open to the whole project team", 400);
    const team = new Set((await projectTeam(s.db, s.workspaceId, s.slug)).map((m) => m.id));
    members = [...new Set([s.person.key, ...input.memberIds])];
    if (members.some((m) => !team.has(m))) throw new AccessError("Choose people who are on this project", 400);
  }
  const [count] = await s.db.query<{ n: number }>("SELECT count(*)::int AS n FROM project_chats WHERE workspace_id=$1 AND project_id=$2", [s.workspaceId, s.projectId]);
  if ((count?.n ?? 0) >= 200) throw new AccessError("This project has 200 channels. Archive some first.", 400);
  const [row] = await s.db.query<ChannelRow>(
    `INSERT INTO project_chats(workspace_id,project_id,name,description,visibility,member_ids,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,name,description,visibility,member_ids,is_default,created_by,created_at,last_message_at,is_direct`,
    [s.workspaceId, s.projectId, input.name, input.description ?? "", visibility, members, s.person.key],
  );
  return toChannel(row);
}

export async function updateChannel(s: CommsScope, channelId: string, change: ChannelChange): Promise<Channel> {
  refuseClient(s);
  const channel = await getChannel(s, channelId);
  if (!s.manager && channel.createdBy !== s.person.key && (change.archived !== undefined || change.visibility !== undefined))
    throw new AccessError("Only whoever started this channel, or an owner, can do that", 403);
  if (channel.isDefault && change.archived) throw new AccessError("The Everyone channel stays", 400);
  if (channel.direct && (change.name || change.visibility)) throw new AccessError("A direct conversation keeps its people", 400);
  if (change.visibility === "client" && channel.memberIds.length) throw new AccessError("Only a channel open to the whole team can be shared with clients", 400);
  const [row] = await s.db.query<ChannelRow>(
    `UPDATE project_chats c SET name=COALESCE($4,name),description=COALESCE($5,description),visibility=COALESCE($6,visibility),
       archived_at=CASE WHEN $7::boolean IS NULL THEN archived_at WHEN $7 THEN COALESCE(archived_at,NOW()) ELSE NULL END
     WHERE id=$1 AND workspace_id=$2 AND project_id=$3 RETURNING ${CHANNEL_COLUMNS}`,
    [channelId, s.workspaceId, s.projectId, change.name ?? null, change.description ?? null, change.visibility ?? null, change.archived ?? null],
  );
  return toChannel(row);
}

/** When this person last read a channel, or null if they never opened it. */
export async function lastRead(s: CommsScope, channelId: string): Promise<string | null> {
  const [row] = await s.db.query<{ read_at: Date | null }>(
    "SELECT NULLIF(read_at,'-infinity') AS read_at FROM project_chat_reads WHERE chat_id=$1 AND person_key=$2",
    [channelId, s.person.key],
  );
  return iso(row?.read_at ?? null);
}

/** Marks a channel read up to now for this person. */
export async function markRead(s: CommsScope, channelId: string): Promise<void> {
  await getChannel(s, channelId);
  await s.db.query(
    `INSERT INTO project_chat_reads(chat_id,person_key,person_name,read_at) VALUES($1,$2,$3,NOW())
     ON CONFLICT(chat_id,person_key) DO UPDATE SET read_at=NOW(),person_name=EXCLUDED.person_name`,
    [channelId, s.person.key, s.person.name.slice(0, 255)],
  );
}

/** Says this person is typing in a channel (shown to others for a few seconds), or mutes or unmutes it for them. */
export async function setChannelMine(s: CommsScope, channelId: string, change: ChannelMine): Promise<void> {
  await getChannel(s, channelId);
  if ("unreadFrom" in change) {
    // "Mark unread": reading goes back to just before this post, as in Slack.
    const { post, channel } = await postIn(s, change.unreadFrom);
    if (channel.id !== channelId) throw new AccessError("That post is in another channel", 400);
    const root = post.parentId ? (await postIn(s, post.parentId)).post : post;
    await s.db.query(
      `INSERT INTO project_chat_reads(chat_id,person_key,person_name,read_at) VALUES($1,$2,$3,$4::timestamptz - interval '1 millisecond')
       ON CONFLICT(chat_id,person_key) DO UPDATE SET read_at=EXCLUDED.read_at`,
      [channelId, s.person.key, s.person.name.slice(0, 255), root.createdAt],
    );
    return;
  }
  const typing = "typing" in change;
  await s.db.query(
    `INSERT INTO project_chat_reads(chat_id,person_key,person_name,read_at,typing_at,muted) VALUES($1,$2,$3,'-infinity',$4,$5)
     ON CONFLICT(chat_id,person_key) DO UPDATE SET person_name=EXCLUDED.person_name,
       typing_at=CASE WHEN $6 THEN EXCLUDED.typing_at ELSE project_chat_reads.typing_at END,
       muted=CASE WHEN $6 THEN project_chat_reads.muted ELSE EXCLUDED.muted END`,
    [channelId, s.person.key, s.person.name.slice(0, 255), typing ? new Date() : null, "muted" in change ? change.muted : false, typing],
  );
}

/** Who else has read this channel, and up to when, and who is typing in it now. The assistant is never listed. */
export async function channelPresence(s: CommsScope, channelId: string): Promise<ChannelPresence> {
  const rows = await s.db.query<{ person_key: string; person_name: string | null; read_at: Date | null; typing: boolean }>(
    `SELECT person_key,person_name,NULLIF(read_at,'-infinity') AS read_at,(typing_at > NOW() - INTERVAL '6 seconds') AS typing FROM project_chat_reads
     WHERE chat_id=$1 AND person_key<>$2 AND person_key<>'assistant' ORDER BY read_at DESC LIMIT 50`,
    [channelId, s.person.key],
  );
  const named = rows.filter((r) => r.person_name);
  return {
    seen: named.filter((r) => r.read_at).map((r) => ({ key: r.person_key, name: r.person_name!, readAt: iso(r.read_at)! })),
    typing: named.filter((r) => r.typing).map((r) => ({ key: r.person_key, name: r.person_name! })),
  };
}

/** The first channel clients can see, made when there is none, for a meeting shared with clients. */
async function clientChannel(s: CommsScope): Promise<Channel> {
  const existing = (await listChannels(s)).find((c) => c.visibility === "client");
  return existing ?? createChannel(s, { name: "Client", description: "Conversations with the client", visibility: "client" });
}

// ---------------------------------------------------------------------------
// Posts and replies
// ---------------------------------------------------------------------------

interface PostRow {
  id: string;
  chat_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_kind: AuthorKind;
  body: string;
  attachments: (Attachment & { storageKey?: string })[] | string;
  mentions: string[];
  meeting_id: string | null;
  reply_count: number;
  last_reply_at: Date | null;
  created_at: Date;
  edited_at: Date | null;
  reactions: unknown;
  pinned_at: Date | null;
  ask: unknown;
}
const POST_COLUMNS = "id,chat_id,parent_id,author_id,author_name,author_kind,body,attachments,mentions,meeting_id,reply_count,last_reply_at,created_at,edited_at,reactions,pinned_at,ask";

const toPost = (r: PostRow): Post => {
  const files = (typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments) ?? [];
  return {
    id: r.id,
    channelId: r.chat_id,
    parentId: r.parent_id,
    authorKey: r.author_id,
    authorName: r.author_name,
    authorKind: r.author_kind,
    body: r.body,
    // Where a file is stored stays on the server; it is fetched through the post.
    attachments: files.map((a: Attachment & { storageKey?: string }) => ({ id: a.id, name: a.name, sizeBytes: a.sizeBytes, contentType: a.contentType })),
    mentions: r.mentions ?? [],
    meetingId: r.meeting_id,
    replyCount: Number(r.reply_count ?? 0),
    lastReplyAt: iso(r.last_reply_at),
    createdAt: iso(r.created_at)!,
    editedAt: iso(r.edited_at),
    reactions: readReactions(r.reactions),
    pinnedAt: iso(r.pinned_at),
    ask: readAsk(r.ask),
  };
};

/** The latest posts of a channel (threads, not their replies), oldest first; `before` pages back. */
export async function listPosts(s: CommsScope, channelId: string, opts: { before?: string; limit?: number } = {}): Promise<Post[]> {
  await getChannel(s, channelId);
  const rows = await s.db.query<PostRow>(
    `SELECT * FROM (SELECT ${POST_COLUMNS} FROM project_chat_messages WHERE chat_id=$1 AND parent_id IS NULL
       AND ($2::timestamptz IS NULL OR created_at < $2) ORDER BY created_at DESC LIMIT $3) m ORDER BY created_at`,
    [channelId, opts.before ?? null, Math.min(200, Math.max(1, opts.limit ?? 50))],
  );
  return rows.map(toPost);
}

async function postIn(s: CommsScope, postId: string): Promise<{ post: Post; channel: Channel }> {
  const [row] = await s.db.query<PostRow & { workspace_id: string; project_id: string }>(
    `SELECT m.${POST_COLUMNS.split(",").join(",m.")} FROM project_chat_messages m JOIN project_chats c ON c.id=m.chat_id
     WHERE m.id=$1 AND c.workspace_id=$2 AND c.project_id=$3`,
    [postId, s.workspaceId, s.projectId],
  );
  if (!row) throw new AccessError("Post not found", 404);
  const channel = await getChannel(s, row.chat_id);
  return { post: toPost(row), channel };
}

/** A thread: its post and every reply, oldest first. */
export async function getThread(s: CommsScope, postId: string): Promise<{ post: Post; replies: Post[] }> {
  const { post } = await postIn(s, postId);
  if (post.parentId) return getThread(s, post.parentId);
  const rows = await s.db.query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM project_chat_messages WHERE parent_id=$1 ORDER BY created_at LIMIT 500`,
    [postId],
  );
  return { post, replies: rows.map(toPost) };
}

/** Everyone a post may mention: the project team (and, for the studio, the assistant). */
async function mentionable(s: CommsScope) {
  return (await projectTeam(s.db, s.workspaceId, s.slug)).filter((m) => m.active).map((m) => ({ key: m.id, name: m.name }));
}

export interface PostOptions {
  authorKind?: AuthorKind;
  /** Post under a different name, e.g. the assistant. */
  authorName?: string;
  meetingId?: string;
  /** Skip notifications (system notes). */
  quiet?: boolean;
}

/**
 * Adds a post, or a reply when parentId is given. Mentions are read from the
 * text ("@Name"); everyone mentioned, and the people already in a thread, get
 * a notification. Files must already sit in the project's storage folder.
 */
export async function addPost(s: CommsScope, channelId: string, input: NewPost, opts: PostOptions = {}): Promise<Post> {
  const channel = await getChannel(s, channelId);
  let parent: Post | null = null;
  if (input.parentId) {
    const found = await postIn(s, input.parentId);
    if (found.channel.id !== channel.id) throw new AccessError("Reply in the post's own channel", 400);
    parent = found.post.parentId ? (await postIn(s, found.post.parentId)).post : found.post;
  }
  const people = await mentionable(s);
  const mentions = findMentions(input.body, people).filter((k) => k !== "assistant" || isTeam(s));
  const attachments = (input.attachments ?? []).map((a: AttachmentInput) => ({
    id: crypto.randomUUID(),
    name: a.name,
    sizeBytes: a.sizeBytes,
    contentType: a.contentType || "application/octet-stream",
    storageKey: a.storageKey,
  }));
  const kind: AuthorKind = opts.authorKind ?? (isTeam(s) ? "team" : "client");
  const [row] = await s.db.query<PostRow>(
    `INSERT INTO project_chat_messages(chat_id,parent_id,author_id,author_name,author_kind,body,attachments,mentions,meeting_id,ask)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb) RETURNING ${POST_COLUMNS}`,
    [
      channel.id,
      parent?.id ?? null,
      kind === "assistant" ? "assistant" : s.person.key,
      (opts.authorName ?? s.person.name).slice(0, 255),
      kind,
      input.body,
      JSON.stringify(attachments),
      mentions,
      opts.meetingId ?? parent?.meetingId ?? null,
      // Only the studio asks for decisions.
      input.ask && isTeam(s) ? JSON.stringify({ options: input.ask.options, answers: [] }) : null,
    ],
  );
  await s.db.query("UPDATE project_chats SET last_message_at=$2 WHERE id=$1", [channel.id, row.created_at]);
  if (parent)
    await s.db.query("UPDATE project_chat_messages SET reply_count=reply_count+1,last_reply_at=$2 WHERE id=$1", [parent.id, row.created_at]);
  await s.db.query("UPDATE projects SET last_activity_at=NOW() WHERE workspace_id=$1 AND id=$2", [s.workspaceId, s.projectId]);
  // Reading what you just wrote: your own post never counts as unread.
  await s.db.query(
    `INSERT INTO project_chat_reads(chat_id,person_key,read_at) VALUES($1,$2,$3) ON CONFLICT(chat_id,person_key) DO UPDATE SET read_at=GREATEST(project_chat_reads.read_at,EXCLUDED.read_at)`,
    [channel.id, s.person.key, row.created_at],
  );
  const post = toPost(row);
  if (!opts.quiet) await notifyForPost(s, channel, post, parent, people.map((p) => p.key));
  return post;
}

async function notifyForPost(s: CommsScope, channel: Channel, post: Post, parent: Post | null, team: string[]) {
  const muted = new Set(
    (await s.db.query<{ person_key: string }>("SELECT person_key FROM project_chat_reads WHERE chat_id=$1 AND muted", [channel.id])).map((r) => r.person_key),
  );
  // Someone who muted the channel still hears when they are named, as in Slack and Teams.
  const inChannel = (key: string) => team.includes(key) && canSee(channel, { key, name: "", kind: "team" });
  const loud = (key: string) => inChannel(key) && !muted.has(key);
  const mentioned = post.mentions.includes("everyone") ? team.filter(loud) : post.mentions.filter(inChannel);
  const thread = new Set<string>();
  if (parent) {
    thread.add(parent.authorKey);
    const repliers = await s.db.query<{ author_id: string }>("SELECT DISTINCT author_id FROM project_chat_messages WHERE parent_id=$1", [parent.id]);
    repliers.forEach((r) => thread.add(r.author_id));
    // Who followed the thread hears of every reply; who left it, only when named.
    const follows = await s.db.query<{ person_key: string; follow: boolean }>("SELECT person_key,follow FROM project_chat_follows WHERE post_id=$1", [parent.id]);
    for (const f of follows) {
      if (f.follow) thread.add(f.person_key);
      else thread.delete(f.person_key);
    }
  } else if (channel.direct) {
    channel.memberIds.forEach((k) => thread.add(k));
  } else if (post.authorKind === "client") {
    // A client writing is something the whole team should see.
    team.filter(inChannel).forEach((k) => thread.add(k));
  }
  const href = conversationsHref(s.slug, channel.id, parent?.id ?? post.id);
  const preview = postPreview(post.body, post.attachments);
  // The assistant answers for the person who asked it, who should hear about the answer.
  const self = post.authorKind === "assistant" ? "assistant" : s.person.key;
  const mentionedOnly = mentioned.filter((k) => k !== self);
  await notify(s.db, {
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    userIds: mentionedOnly,
    kind: "mention",
    title: `${post.authorName} mentioned you in ${channel.direct ? "a direct message" : `#${channel.name}`}`,
    body: preview,
    href,
    actor: post.authorName,
  });
  await notify(s.db, {
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    userIds: [...thread].filter((k) => k !== self && loud(k) && !mentionedOnly.includes(k)),
    kind: parent ? "reply" : "post",
    title: channel.direct
      ? `${post.authorName} sent you a message`
      : parent
        ? `${post.authorName} replied in #${channel.name}`
        : `${post.authorName} posted in #${channel.name}`,
    body: preview,
    href,
    actor: post.authorName,
  });
}

/** Changes a post's text; only its author can. */
/** Pins a post to the top of its channel, or takes it off. The studio pins; clients see what is pinned in their channels. */
export async function pinPost(s: CommsScope, postId: string, on: boolean): Promise<Post> {
  refuseClient(s, "Only the studio can pin posts");
  const { post } = await postIn(s, postId);
  if (on && !post.pinnedAt) {
    const [n] = await s.db.query<{ n: number }>("SELECT count(*)::int AS n FROM project_chat_messages WHERE chat_id=$1 AND pinned_at IS NOT NULL", [post.channelId]);
    if ((n?.n ?? 0) >= 50) throw new AccessError("A channel keeps up to 50 pinned posts. Unpin one first.", 400);
  }
  const [row] = await s.db.query<PostRow>(
    `UPDATE project_chat_messages SET pinned_at=${on ? "COALESCE(pinned_at,NOW())" : "NULL"},pinned_by=$2 WHERE id=$1 RETURNING ${POST_COLUMNS}`,
    [postId, on ? s.person.key : null],
  );
  return toPost(row);
}

/** A channel's pinned posts, newest pin first. */
export async function listPinned(s: CommsScope, channelId: string): Promise<Post[]> {
  await getChannel(s, channelId);
  const rows = await s.db.query<PostRow>(`SELECT ${POST_COLUMNS} FROM project_chat_messages WHERE chat_id=$1 AND pinned_at IS NOT NULL ORDER BY pinned_at DESC LIMIT 50`, [channelId]);
  return rows.map(toPost);
}

/** Posts and replies in the channels this person can see that contain the words searched for. */
export async function searchPosts(s: CommsScope, query: string, limit = 40): Promise<(Post & { channelName: string })[]> {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const channels = await listChannels(s);
  if (!channels.length) return [];
  const like = words.map((w) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const rows = await s.db.query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM project_chat_messages WHERE chat_id = ANY($1::uuid[]) AND author_kind <> 'system'
       AND (SELECT bool_and(body ILIKE w OR author_name ILIKE w OR EXISTS (SELECT 1 FROM jsonb_array_elements(attachments) a WHERE a->>'name' ILIKE w)) FROM unnest($2::text[]) w)
     ORDER BY created_at DESC LIMIT $3`,
    [channels.map((c) => c.id), like, Math.min(100, limit)],
  );
  const names = new Map(channels.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...toPost(r), channelName: names.get(r.chat_id) ?? "" }));
}

/** Picks one of the options a post asks about; picking again changes the answer. The asker hears of a client's pick. */
export async function answerAsk(s: CommsScope, postId: string, option: number): Promise<Post> {
  const { post, channel } = await postIn(s, postId);
  if (!post.ask || option >= post.ask.options.length) throw new AccessError("This post does not ask that", 400);
  const answers = [...post.ask.answers.filter((a) => a.key !== s.person.key), { key: s.person.key, name: s.person.name, option, at: new Date().toISOString() }];
  const [row] = await s.db.query<PostRow>(`UPDATE project_chat_messages SET ask=jsonb_set(ask,'{answers}',$2::jsonb) WHERE id=$1 RETURNING ${POST_COLUMNS}`, [
    postId,
    JSON.stringify(answers.slice(-200)),
  ]);
  if (!isTeam(s) && post.authorKey !== s.person.key)
    await notify(s.db, {
      workspaceId: s.workspaceId,
      projectId: s.projectId,
      userIds: [post.authorKey],
      kind: "reply",
      title: `${s.person.name} chose "${post.ask.options[option]}" in #${channel.name}`,
      body: postPreview(post.body, post.attachments),
      href: conversationsHref(s.slug, channel.id, post.parentId ?? post.id),
      actor: s.person.name,
    });
  return toPost(row);
}

/** Every post and reply in a channel that carries files, newest first: the channel's files in one place. */
export async function channelFiles(s: CommsScope, channelId: string, limit = 200): Promise<Post[]> {
  await getChannel(s, channelId);
  const rows = await s.db.query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM project_chat_messages WHERE chat_id=$1 AND jsonb_array_length(attachments) > 0 ORDER BY created_at DESC LIMIT $2`,
    [channelId, Math.min(500, limit)],
  );
  return rows.map(toPost);
}

/** Adds or takes back this person's emoji on a post they can see. */
export async function reactToPost(s: CommsScope, postId: string, emoji: ReactionEmoji, on: boolean): Promise<Post> {
  await postIn(s, postId);
  const me = JSON.stringify({ key: s.person.key, name: s.person.name.slice(0, 120) });
  const [row] = await s.db.query<PostRow>(
    on
      ? `UPDATE project_chat_messages SET reactions = jsonb_set(reactions, ARRAY[$2::text],
           (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(COALESCE(reactions->$2, '[]'::jsonb)) x WHERE x->>'key' <> $3) || jsonb_build_array($4::jsonb))
         WHERE id=$1 RETURNING ${POST_COLUMNS}`
      : `UPDATE project_chat_messages SET reactions = CASE WHEN reactions ? $2 THEN jsonb_set(reactions, ARRAY[$2::text],
           (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(reactions->$2) x WHERE x->>'key' <> $3)) ELSE reactions END
         WHERE id=$1 RETURNING ${POST_COLUMNS}`,
    on ? [postId, emoji, s.person.key, me] : [postId, emoji, s.person.key],
  );
  return toPost(row);
}

export async function editPost(s: CommsScope, postId: string, body: string): Promise<Post> {
  const { post } = await postIn(s, postId);
  if (post.authorKey !== s.person.key || post.authorKind === "system") throw new AccessError("Only its author can change this post", 403);
  if (!body.trim() && !post.attachments.length) throw new AccessError("Write something, or delete the post", 400);
  const mentions = findMentions(body, await mentionable(s));
  const [row] = await s.db.query<PostRow>(
    `UPDATE project_chat_messages SET body=$2,mentions=$3,edited_at=NOW() WHERE id=$1 RETURNING ${POST_COLUMNS}`,
    [postId, body.trim(), mentions],
  );
  return toPost(row);
}

/** Removes a post (and its replies); its author or an owner can. */
export async function deletePost(s: CommsScope, postId: string): Promise<void> {
  const { post } = await postIn(s, postId);
  if (post.authorKey !== s.person.key && !(s.manager && isTeam(s))) throw new AccessError("Only its author can delete this post", 403);
  await s.db.query("DELETE FROM project_chat_messages WHERE id=$1", [postId]);
  if (post.parentId)
    await s.db.query("UPDATE project_chat_messages SET reply_count=GREATEST(reply_count-1,0) WHERE id=$1", [post.parentId]);
}

/** Where a file of a post is stored, for someone who can see the post. */
export async function attachmentFile(s: CommsScope, postId: string, attachmentId: string): Promise<{ storageKey: string; name: string; contentType: string } | null> {
  await postIn(s, postId);
  const [row] = await s.db.query<{ attachments: unknown }>("SELECT attachments FROM project_chat_messages WHERE id=$1", [postId]);
  const files = (typeof row?.attachments === "string" ? JSON.parse(row.attachments) : row?.attachments) as (Attachment & { storageKey: string })[] | undefined;
  const file = files?.find((a) => a.id === attachmentId);
  return file ? { storageKey: file.storageKey, name: file.name, contentType: file.contentType } : null;
}

/** Recent posts and replies across the channels this person is in, newest first: for the assistant and search. */
export async function recentActivity(s: CommsScope, opts: { channelId?: string; since?: string; limit?: number; query?: string } = {}): Promise<(Post & { channelName: string })[]> {
  const channels = await listChannels(s);
  const ids = channels.filter((c) => !opts.channelId || c.id === opts.channelId).map((c) => c.id);
  if (!ids.length) return [];
  const rows = await s.db.query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM project_chat_messages WHERE chat_id = ANY($1::uuid[])
       AND ($2::timestamptz IS NULL OR created_at >= $2) AND ($3::text IS NULL OR body ILIKE '%' || $3 || '%')
     ORDER BY created_at DESC LIMIT $4`,
    [ids, opts.since ?? null, opts.query ?? null, Math.min(300, opts.limit ?? 80)],
  );
  const names = new Map(channels.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...toPost(r), channelName: names.get(r.chat_id) ?? "" }));
}

// ---------------------------------------------------------------------------
// Notifications (teammates)
// ---------------------------------------------------------------------------

export interface Notification {
  id: string;
  projectId: string | null;
  kind: string;
  title: string;
  body: string;
  href: string;
  actorName: string;
  createdAt: string;
  read: boolean;
}

export async function notify(
  db: Db,
  n: { workspaceId: string; projectId: string | null; userIds: string[]; kind: string; title: string; body?: string; href: string; actor?: string },
): Promise<void> {
  const ids = [...new Set(n.userIds)].filter((id) => id && !id.startsWith("client:") && id !== "assistant" && id !== "everyone");
  if (!ids.length) return;
  await db.query(
    `INSERT INTO notifications(workspace_id,project_id,user_id,kind,title,body,href,actor_name)
     SELECT $1,$2,u.id,$4,$5,$6,$7,$8 FROM users u WHERE u.id = ANY($3::text[])`,
    [n.workspaceId, n.projectId, ids, n.kind, n.title.slice(0, 300), (n.body ?? "").slice(0, 500), n.href.slice(0, 500), (n.actor ?? "").slice(0, 255)],
  );
}

export async function listNotifications(db: Db, workspaceId: string, userId: string, limit = 50): Promise<{ notifications: Notification[]; unread: number }> {
  const rows = await db.query<{ id: string; project_slug: string | null; kind: string; title: string; body: string; href: string; actor_name: string; created_at: Date; read_at: Date | null }>(
    `SELECT n.id,p.slug AS project_slug,n.kind,n.title,n.body,n.href,n.actor_name,n.created_at,n.read_at FROM notifications n
     LEFT JOIN projects p ON p.id=n.project_id WHERE n.user_id=$1 AND n.workspace_id=$2 ORDER BY n.created_at DESC LIMIT $3`,
    [userId, workspaceId, Math.min(200, limit)],
  );
  const [count] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND workspace_id=$2 AND read_at IS NULL", [userId, workspaceId]);
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      projectId: r.project_slug,
      kind: r.kind,
      title: r.title,
      body: r.body,
      href: r.href,
      actorName: r.actor_name,
      createdAt: iso(r.created_at)!,
      read: !!r.read_at,
    })),
    unread: count?.n ?? 0,
  };
}

/** Marks some notifications read, or all of them when no ids are given. */
export async function markNotificationsRead(db: Db, workspaceId: string, userId: string, ids?: string[]): Promise<void> {
  await db.query(
    "UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND workspace_id=$2 AND read_at IS NULL AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))",
    [userId, workspaceId, ids?.length ? ids : null],
  );
  // Old read notifications are of no further use.
  await db.query("DELETE FROM notifications WHERE user_id=$1 AND read_at < NOW() - INTERVAL '90 days'", [userId]);
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

interface MeetingRow {
  id: string;
  title: string;
  agenda: string;
  starts_at: Date;
  duration_min: number;
  status: Meeting["status"];
  provider: string;
  client_visible: boolean;
  waiting_room: boolean;
  repeat: MeetingRepeat;
  series_id: string | null;
  chat_id: string | null;
  post_id: string | null;
  recording_state: "off" | "on";
  recording_by: string | null;
  captions: boolean;
  notes: MeetingNotes | string | null;
  notes_source: NotesSource | null;
  notes_at: Date | null;
  created_by: string;
  created_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  in_call: number;
  has_transcript: boolean;
  recordings: number;
  slug: string;
}

const MEETING_SELECT = `SELECT mt.id,mt.title,mt.agenda,mt.starts_at,mt.duration_min,mt.status,mt.provider,mt.client_visible,mt.waiting_room,mt.repeat,mt.series_id,mt.chat_id,mt.post_id,
  mt.recording_state,mt.recording_by,mt.captions,mt.notes,mt.notes_source,mt.notes_at,mt.created_by,mt.created_at,mt.started_at,mt.ended_at,p.slug,
  (SELECT count(*)::int FROM meeting_peers pe WHERE pe.meeting_id=mt.id AND pe.left_at IS NULL AND pe.admitted AND pe.last_seen_at > NOW() - make_interval(secs => ${PEER_TIMEOUT_MS / 1000})) AS in_call,
  EXISTS(SELECT 1 FROM meeting_transcript_lines l WHERE l.meeting_id=mt.id) AS has_transcript,
  (SELECT count(*)::int FROM meeting_recordings r WHERE r.meeting_id=mt.id) AS recordings
  FROM meetings mt JOIN projects p ON p.id=mt.project_id`;

const toMeeting = (r: MeetingRow): Meeting => ({
  id: r.id,
  projectId: r.slug,
  title: r.title,
  agenda: r.agenda ?? "",
  startsAt: iso(r.starts_at)!,
  durationMin: Number(r.duration_min),
  status: r.status,
  provider: r.provider,
  clientVisible: r.client_visible,
  waitingRoom: r.waiting_room !== false,
  repeat: r.repeat ?? "none",
  seriesId: r.series_id ?? null,
  channelId: r.chat_id,
  postId: r.post_id,
  recording: r.recording_state,
  recordingBy: r.recording_by,
  captions: r.captions,
  notes: typeof r.notes === "string" ? (JSON.parse(r.notes) as MeetingNotes) : r.notes,
  notesSource: r.notes_source,
  notesAt: iso(r.notes_at),
  createdBy: r.created_by,
  createdAt: iso(r.created_at)!,
  startedAt: iso(r.started_at),
  endedAt: iso(r.ended_at),
  inCall: Number(r.in_call ?? 0),
  hasTranscript: !!r.has_transcript,
  recordings: Number(r.recordings ?? 0),
});

/** Clients never get a meeting's notes: the studio decides what to share from them. */
const shown = (s: CommsScope, m: Meeting): Meeting => (isTeam(s) ? m : { ...m, notes: null, notesSource: null, notesAt: null });

/** The project's meetings in a time range (all of them when left out), soonest first. */
export async function listMeetings(s: CommsScope, range: { from?: string; to?: string } = {}): Promise<Meeting[]> {
  await rollSeries(s.db, s.workspaceId, s.projectId);
  const rows = await s.db.query<MeetingRow>(
    `${MEETING_SELECT} WHERE mt.workspace_id=$1 AND mt.project_id=$2 AND ($3::boolean OR mt.client_visible)
       AND ($4::timestamptz IS NULL OR mt.starts_at >= $4) AND ($5::timestamptz IS NULL OR mt.starts_at < $5)
     ORDER BY mt.starts_at LIMIT 500`,
    [s.workspaceId, s.projectId, isTeam(s), range.from ?? null, range.to ?? null],
  );
  return rows.map((r) => shown(s, toMeeting(r)));
}

/** Meetings across several projects of a workspace, for the calendar. */
export async function meetingsBetween(db: Db, workspaceId: string, slugs: string[], from: string, to: string): Promise<Meeting[]> {
  if (!slugs.length) return [];
  await rollSeries(db, workspaceId, null);
  const rows = await db.query<MeetingRow>(
    `${MEETING_SELECT} WHERE mt.workspace_id=$1 AND p.slug = ANY($2::text[]) AND mt.starts_at >= $3 AND mt.starts_at < $4 AND mt.status<>'cancelled'
     ORDER BY mt.starts_at LIMIT 1000`,
    [workspaceId, slugs, from, to],
  );
  return rows.map(toMeeting);
}

/** The next occurrence of a repeating meeting after this one, for its page to link on to. */
export async function nextInSeries(s: CommsScope, m: Meeting): Promise<{ id: string; startsAt: string } | null> {
  if (!m.seriesId) return null;
  const [row] = await s.db.query<{ id: string; starts_at: Date }>(
    "SELECT id,starts_at FROM meetings WHERE series_id=$1 AND workspace_id=$2 AND project_id=$3 AND starts_at>$4 AND ($5::boolean OR client_visible) ORDER BY starts_at LIMIT 1",
    [m.seriesId, s.workspaceId, s.projectId, m.startsAt, isTeam(s)],
  );
  return row ? { id: row.id, startsAt: iso(row.starts_at)! } : null;
}

export async function getMeeting(s: CommsScope, meetingId: string): Promise<Meeting> {
  const [row] = await s.db.query<MeetingRow>(`${MEETING_SELECT} WHERE mt.id=$1 AND mt.workspace_id=$2 AND mt.project_id=$3`, [meetingId, s.workspaceId, s.projectId]);
  if (!row || (!isTeam(s) && !row.client_visible)) throw new AccessError("Meeting not found", 404);
  return shown(s, toMeeting(row));
}

const when = (startsAt: string) =>
  new Date(startsAt).toLocaleString("en-ZA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Johannesburg" });

/**
 * Schedules a meeting. Its chat is a thread in a channel (a client channel
 * when clients are invited), and the people in that channel are told.
 */
export async function createMeeting(s: CommsScope, input: NewMeeting, provider: string): Promise<Meeting> {
  refuseClient(s, "Only the studio can schedule meetings");
  let channel = input.channelId ? await getChannel(s, input.channelId) : (await listChannels(s)).find((c) => c.isDefault)!;
  if (input.clientVisible && channel.visibility !== "client") channel = await clientChannel(s);
  const id = await insertMeeting(s, channel.id, { ...input, provider, waitingRoom: true, seriesId: null });
  if (!id) throw new AccessError("The meeting was not made. Please retry.", 500);
  const team = (await projectTeam(s.db, s.workspaceId, s.slug)).filter((m) => m.active && canSee(channel, { key: m.id, name: m.name, kind: "team" }));
  await notify(s.db, {
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    userIds: team.map((m) => m.id).filter((id) => id !== s.person.key),
    kind: "meeting",
    title: `${s.person.name} scheduled ${input.title}`,
    body: when(input.startsAt),
    href: meetingHref(s.slug, id),
    actor: s.person.name,
  });
  return getMeeting(s, id);
}

/** Saves a meeting and its post in the channel, where its chat goes. Null when that occurrence of a series already exists. */
async function insertMeeting(
  s: CommsScope,
  channelId: string,
  m: Pick<NewMeeting, "title" | "agenda" | "startsAt" | "durationMin" | "clientVisible" | "repeat"> & { provider: string; waitingRoom: boolean; seriesId: string | null },
): Promise<string | null> {
  const room = randomBytes(12).toString("base64url");
  const repeat = m.repeat ?? "none";
  const [row] = await s.db.query<{ id: string }>(
    `INSERT INTO meetings(workspace_id,project_id,title,agenda,starts_at,duration_min,provider,room,client_visible,waiting_room,chat_id,created_by,repeat,series_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING RETURNING id`,
    [s.workspaceId, s.projectId, m.title, m.agenda ?? "", m.startsAt, m.durationMin ?? 30, m.provider, room, m.clientVisible === true, m.waitingRoom, channelId, s.person.key, repeat, m.seriesId],
  );
  if (!row) return null;
  // A repeating meeting's first occurrence starts its series.
  if (repeat !== "none" && !m.seriesId) await s.db.query("UPDATE meetings SET series_id=id WHERE id=$1", [row.id]);
  const post = await addPost(
    s,
    channelId,
    { body: `Meeting: ${m.title} · ${when(m.startsAt)} (${m.durationMin ?? 30} min)${repeat !== "none" ? ` · ${REPEAT_LABEL[repeat].toLowerCase()}` : ""}${m.agenda ? `\n${m.agenda}` : ""}` },
    { authorKind: "system", meetingId: row.id, quiet: true },
  );
  await s.db.query("UPDATE meetings SET post_id=$2 WHERE id=$1", [row.id, post.id]);
  return row.id;
}

/**
 * Makes the next occurrence of each repeating meeting whose latest one has
 * passed (or was cancelled on its own). Occurrences missed while nobody looked
 * are skipped: the next one is the first still to come.
 */
export async function rollSeries(db: Db, workspaceId: string, projectId: string | null): Promise<void> {
  const due = await db.query<MeetingRow & { project_id: string; created_by: string; client_visible: boolean }>(
    `${MEETING_SELECT.replace("SELECT mt.id,", "SELECT mt.id,mt.project_id,")} WHERE mt.workspace_id=$1 AND ($2::uuid IS NULL OR mt.project_id=$2) AND mt.repeat<>'none' AND mt.series_id IS NOT NULL
       AND mt.starts_at + make_interval(mins => mt.duration_min) < NOW() AND mt.status<>'live'
       AND NOT EXISTS (SELECT 1 FROM meetings n WHERE n.series_id=mt.series_id AND n.starts_at > mt.starts_at) LIMIT 50`,
    [workspaceId, projectId],
  );
  for (const r of due) {
    const m = toMeeting(r);
    if (m.repeat === "none" || !r.chat_id) continue;
    const s: CommsScope = { db, workspaceId, projectId: r.project_id, slug: r.slug, person: { key: r.created_by, name: "Fundur", kind: "team" }, manager: true };
    await insertMeeting(s, r.chat_id, {
      title: m.title,
      agenda: m.agenda,
      startsAt: nextOccurrence(m.startsAt, m.repeat, Date.now() - m.durationMin * 60_000),
      durationMin: m.durationMin,
      clientVisible: m.clientVisible,
      repeat: m.repeat,
      provider: m.provider,
      waitingRoom: m.waitingRoom,
      seriesId: m.seriesId,
    });
  }
}

export async function updateMeeting(s: CommsScope, meetingId: string, change: MeetingChange): Promise<Meeting> {
  refuseClient(s);
  const meeting = await getMeeting(s, meetingId);
  if (change.clientVisible && meeting.channelId) {
    const channel = await getChannel(s, meeting.channelId);
    if (channel.visibility !== "client") throw new AccessError("Share this meeting's channel with clients first, or schedule a new client meeting", 400);
  }
  await s.db.query(
    `UPDATE meetings SET title=COALESCE($2,title),agenda=COALESCE($3,agenda),starts_at=COALESCE($4,starts_at),duration_min=COALESCE($5,duration_min),
       client_visible=COALESCE($6,client_visible),waiting_room=COALESCE($9,waiting_room),
       repeat=COALESCE($10,repeat),series_id=CASE WHEN COALESCE($10,repeat)<>'none' THEN COALESCE(series_id,id) ELSE series_id END,status=CASE WHEN $7::text IS NULL THEN status ELSE $7 END,
       notes=COALESCE($8::jsonb,notes),notes_source=CASE WHEN $8::jsonb IS NULL THEN notes_source ELSE 'manual' END,notes_at=CASE WHEN $8::jsonb IS NULL THEN notes_at ELSE NOW() END
     WHERE id=$1`,
    [meetingId, change.title ?? null, change.agenda ?? null, change.startsAt ?? null, change.durationMin ?? null, change.clientVisible ?? null, change.status ?? null, change.notes ? JSON.stringify(change.notes) : null, change.waitingRoom ?? null, change.repeat ?? null],
  );
  // Changing how often it repeats changes it from this occurrence on.
  if (change.repeat && meeting.seriesId)
    await s.db.query("UPDATE meetings SET repeat=$3 WHERE series_id=$1 AND starts_at>$2", [meeting.seriesId, meeting.startsAt, change.repeat]);
  if (change.status === "cancelled" && meeting.postId && meeting.channelId)
    await addPost(s, meeting.channelId, { body: `${s.person.name} cancelled this meeting.`, parentId: meeting.postId }, { authorKind: "system", quiet: true });
  return getMeeting(s, meetingId);
}

/** Saves notes taken from a meeting and says so in its thread. */
export async function saveNotes(s: CommsScope, meetingId: string, notes: MeetingNotes, source: NotesSource): Promise<Meeting> {
  await s.db.query("UPDATE meetings SET notes=$2::jsonb,notes_source=$3,notes_at=NOW() WHERE id=$1 AND workspace_id=$4 AND project_id=$5", [
    meetingId,
    JSON.stringify(notes),
    source,
    s.workspaceId,
    s.projectId,
  ]);
  const meeting = await getMeeting(s, meetingId);
  if (meeting.postId && meeting.channelId) {
    const lines = [
      source === "ai" ? "Meeting notes are ready." : "Quick meeting notes are ready (no AI model was available, so these were picked out of what was said).",
      notes.summary,
      notes.decisions.length ? `Decisions:\n${notes.decisions.map((d) => `• ${d}`).join("\n")}` : "",
      notes.actionItems.length ? `Action items:\n${notes.actionItems.map((a) => `• ${a.title}${a.owner ? ` (${a.owner})` : ""}${a.due ? `, by ${a.due}` : ""}`).join("\n")}` : "",
    ].filter(Boolean);
    await addPost(s, meeting.channelId, { body: lines.join("\n\n").slice(0, 5000), parentId: meeting.postId }, { authorKind: "system", authorName: "Meeting notes", quiet: true });
  }
  const people = await s.db.query<{ person_key: string }>("SELECT DISTINCT person_key FROM meeting_peers WHERE meeting_id=$1", [meetingId]);
  await notify(s.db, {
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    userIds: [meeting.createdBy, ...people.map((p) => p.person_key)],
    kind: "notes",
    title: `Notes from ${meeting.title} are ready`,
    body: notes.summary.slice(0, 300),
    href: meetingHref(s.slug, meetingId),
    actor: "",
  });
  return meeting;
}

/** Records which task an action item became. */
export async function linkActionItems(s: CommsScope, meetingId: string, links: Record<string, string>): Promise<Meeting> {
  const meeting = await getMeeting(s, meetingId);
  if (!meeting.notes) throw new AccessError("This meeting has no notes yet", 400);
  const notes: MeetingNotes = { ...meeting.notes, actionItems: meeting.notes.actionItems.map((a) => (links[a.id] ? { ...a, taskId: links[a.id] } : a)) };
  await s.db.query("UPDATE meetings SET notes=$2::jsonb WHERE id=$1", [meetingId, JSON.stringify(notes)]);
  return getMeeting(s, meetingId);
}

// ---------------------------------------------------------------------------
// The call room
// ---------------------------------------------------------------------------

interface PeerRow {
  id: string;
  person_key: string;
  name: string;
  kind: "team" | "client";
  state: PeerState | string;
  joined_at: Date;
  admitted: boolean;
}
const toPeer = (r: PeerRow): Peer => ({
  id: r.id,
  personKey: r.person_key,
  name: r.name,
  kind: r.kind,
  state: typeof r.state === "string" ? JSON.parse(r.state) : r.state,
  joinedAt: iso(r.joined_at)!,
  admitted: r.admitted !== false,
});

const PEER_COLUMNS = "id,person_key,name,kind,state,joined_at,admitted";
const FRESH = `last_seen_at > NOW() - make_interval(secs => ${PEER_TIMEOUT_MS / 1000})`;

/** Who is in the call; those still waiting to be let in only when asked for. */
async function activePeers(db: Db, meetingId: string, waiting = false): Promise<Peer[]> {
  const rows = await db.query<PeerRow>(
    `SELECT ${PEER_COLUMNS} FROM meeting_peers WHERE meeting_id=$1 AND left_at IS NULL AND admitted <> $2 AND ${FRESH} ORDER BY joined_at`,
    [meetingId, waiting],
  );
  return rows.map(toPeer);
}

async function myPeer(s: CommsScope, meetingId: string, peerId: string): Promise<void> {
  const [row] = await s.db.query<{ person_key: string; admitted: boolean }>(
    "SELECT person_key,admitted FROM meeting_peers WHERE id=$1 AND meeting_id=$2 AND left_at IS NULL",
    [peerId, meetingId],
  );
  if (!row || row.person_key !== s.person.key || !row.admitted) throw new AccessError("Join the call first", 409);
}

const REMOVED = "Someone in the studio took you out of this call";

/** Joins a call (one row per browser tab). The meeting goes live with its first person. */
export async function joinRoom(s: CommsScope, meetingId: string, peerId: string, state: PeerState): Promise<{ meeting: Meeting; peer: Peer }> {
  const meeting = await getMeeting(s, meetingId);
  if (meeting.status === "cancelled") throw new AccessError("This meeting was cancelled", 400);
  const [before] = await s.db.query<{ removed: boolean }>("SELECT removed FROM meeting_peers WHERE id=$1", [peerId]);
  if (before?.removed) throw new AccessError(REMOVED, 403);
  const peers = await activePeers(s.db, meetingId);
  if (meeting.provider === "builtin" && peers.filter((p) => p.id !== peerId).length >= BUILTIN_MAX_PEERS)
    throw new AccessError(`This call is full: the built-in call service takes ${BUILTIN_MAX_PEERS} people. The Admin can switch on LiveKit for larger calls.`, 400);
  // A client waits in the lobby until someone in the studio lets them in, when the meeting says so.
  const waits = !isTeam(s) && meeting.waitingRoom;
  const [row] = await s.db.query<PeerRow>(
    `INSERT INTO meeting_peers(id,meeting_id,person_key,name,kind,state,admitted) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,last_seen_at=NOW(),left_at=NULL,mute_at=NULL
       WHERE meeting_peers.person_key=EXCLUDED.person_key AND meeting_peers.meeting_id=EXCLUDED.meeting_id
     RETURNING ${PEER_COLUMNS}`,
    [peerId, meetingId, s.person.key, s.person.name.slice(0, 255), s.person.kind, JSON.stringify(state), !waits],
  );
  if (!row) throw new AccessError("Join again", 409);
  if (!row.admitted) return { meeting, peer: toPeer(row) };
  if (meeting.status !== "live") {
    await s.db.query("UPDATE meetings SET status='live',started_at=COALESCE(started_at,NOW()),ended_at=NULL WHERE id=$1", [meetingId]);
    if (meeting.postId && meeting.channelId && !meeting.startedAt)
      await addPost(s, meeting.channelId, { body: `${s.person.name} started the call.`, parentId: meeting.postId }, { authorKind: "system", quiet: true });
  }
  return { meeting: await getMeeting(s, meetingId), peer: toPeer(row) };
}

/** What a browser in the call needs every second or so: who is here, handshakes for it, consents and new transcript lines. */
export async function pollRoom(
  s: CommsScope,
  meetingId: string,
  peerId: string,
  opts: { state?: PeerState; afterSignal: number; afterLine: number },
): Promise<RoomSnapshot> {
  const meeting = await getMeeting(s, meetingId);
  const [me] = await s.db.query<{ admitted: boolean; mute_at: Date | null }>(
    "UPDATE meeting_peers SET last_seen_at=NOW(),state=COALESCE($3::jsonb,state) WHERE id=$1 AND meeting_id=$2 AND person_key=$4 AND left_at IS NULL RETURNING admitted,mute_at",
    [peerId, meetingId, opts.state ? JSON.stringify(opts.state) : null, s.person.key],
  );
  if (!me) {
    const [gone] = await s.db.query<{ removed: boolean }>("SELECT removed FROM meeting_peers WHERE id=$1 AND person_key=$2", [peerId, s.person.key]);
    throw new AccessError(gone?.removed ? REMOVED : "You are no longer in this call", gone?.removed ? 403 : 409);
  }
  const you = { admitted: me.admitted, mutedAt: iso(me.mute_at) };
  // Someone waiting hears nothing of the call until they are let in.
  if (!me.admitted) return { meeting, peers: [], signals: [], consents: [], lines: [], you };
  // Handshakes already read are of no further use; nor is anything older than two minutes.
  await s.db.query("DELETE FROM meeting_signals WHERE (to_peer=$1 AND id<=$2) OR created_at < NOW() - INTERVAL '2 minutes'", [peerId, opts.afterSignal]);
  const signals = await s.db.query<{ id: string | number; from_peer: string; payload: SignalPayload | string }>(
    "SELECT id,from_peer,payload FROM meeting_signals WHERE to_peer=$1 AND meeting_id=$2 AND id>$3 ORDER BY id LIMIT 200",
    [peerId, meetingId, opts.afterSignal],
  );
  return {
    meeting,
    peers: await activePeers(s.db, meetingId),
    signals: signals.map((r): Signal => ({ id: Number(r.id), from: r.from_peer, payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload })),
    consents: await listConsents(s.db, meetingId),
    lines: await transcriptLines(s.db, meetingId, opts.afterLine, 200),
    ...(isTeam(s) ? { waiting: (await activePeers(s.db, meetingId, true)).map((p) => ({ id: p.id, name: p.name })) } : {}),
    you,
  };
}

/**
 * The studio running its call: let a waiting client in or turn them away,
 * mute someone (they can unmute themselves, as in Teams), mute everyone
 * else, or take someone out of the call.
 */
export async function hostAction(s: CommsScope, meetingId: string, peerId: string, what: HostAction, target?: string): Promise<void> {
  refuseClient(s, "Only the studio runs the call");
  await myPeer(s, meetingId, peerId);
  if (what === "mute-all") {
    await s.db.query("UPDATE meeting_peers SET mute_at=NOW() WHERE meeting_id=$1 AND id<>$2 AND left_at IS NULL AND admitted", [meetingId, peerId]);
    return;
  }
  if (!target || target === peerId) throw new AccessError("Choose someone else in the call", 400);
  const set = what === "admit" ? "admitted=TRUE" : what === "mute" ? "mute_at=NOW()" : "removed=TRUE,left_at=NOW()";
  const done = await s.db.query(`UPDATE meeting_peers SET ${set} WHERE id=$1 AND meeting_id=$2 AND left_at IS NULL RETURNING id`, [target, meetingId]);
  if (!done.length) throw new AccessError("They are no longer in the call", 404);
  if (what === "decline" || what === "remove") await s.db.query("DELETE FROM meeting_signals WHERE to_peer=$1 OR from_peer=$1", [target]);
}

/** Passes WebRTC handshakes from one browser in the call to another. */
export async function sendSignals(s: CommsScope, meetingId: string, peerId: string, to: string, payloads: SignalPayload[]): Promise<void> {
  await myPeer(s, meetingId, peerId);
  const [target] = await s.db.query("SELECT 1 FROM meeting_peers WHERE id=$1 AND meeting_id=$2 AND left_at IS NULL AND admitted", [to, meetingId]);
  if (!target) return;
  for (const p of payloads)
    await s.db.query("INSERT INTO meeting_signals(meeting_id,from_peer,to_peer,payload) VALUES($1,$2,$3,$4::jsonb)", [meetingId, peerId, to, JSON.stringify(p)]);
}

/** Leaves the call; when the last person leaves, the meeting ends. Returns true when it ended. */
export async function leaveRoom(s: CommsScope, meetingId: string, peerId: string): Promise<boolean> {
  await s.db.query("UPDATE meeting_peers SET left_at=NOW() WHERE id=$1 AND meeting_id=$2 AND person_key=$3", [peerId, meetingId, s.person.key]);
  await s.db.query("DELETE FROM meeting_signals WHERE to_peer=$1 OR from_peer=$1", [peerId]);
  if ((await activePeers(s.db, meetingId)).length) return false;
  return endMeeting(s, meetingId, false);
}

/** Ends the call for everyone. Only the studio can end it while people are in it. */
export async function endMeeting(s: CommsScope, meetingId: string, byHand = true): Promise<boolean> {
  if (byHand) refuseClient(s, "Only the studio can end the call for everyone");
  const ended = await s.db.query<{ id: string }>(
    "UPDATE meetings SET status='ended',ended_at=NOW(),recording_state='off',captions=FALSE WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND status='live' RETURNING id",
    [meetingId, s.workspaceId, s.projectId],
  );
  if (!ended.length) return false;
  await s.db.query("UPDATE meeting_peers SET left_at=COALESCE(left_at,NOW()) WHERE meeting_id=$1", [meetingId]);
  await s.db.query("DELETE FROM meeting_signals WHERE meeting_id=$1", [meetingId]);
  const meeting = await getMeeting(s, meetingId);
  if (meeting.postId && meeting.channelId) {
    const minutes = meeting.startedAt ? Math.max(1, Math.round((Date.now() - Date.parse(meeting.startedAt)) / 60_000)) : 0;
    await addPost(s, meeting.channelId, { body: `The call ended${minutes ? ` after ${minutes} min` : ""}.`, parentId: meeting.postId }, { authorKind: "system", quiet: true });
  }
  return true;
}

/**
 * Starts or stops recording and live transcription. Starting it tells
 * everyone in the call and asks each to agree; the person starting it agrees
 * by starting it. Clients cannot start it.
 */
export async function setRecording(s: CommsScope, meetingId: string, peerId: string, on: boolean, captions = true): Promise<Meeting> {
  refuseClient(s, "Only the studio can record a meeting");
  await myPeer(s, meetingId, peerId);
  const meeting = await getMeeting(s, meetingId);
  if (on && !(await recordingAllowed(s.db))) throw new AccessError("Recording is switched off for this studio. The Platform Admin can switch it on in Settings, Calls.", 403);
  if (on === (meeting.recording === "on") && (!on || captions === meeting.captions)) return meeting;
  await s.db.query("UPDATE meetings SET recording_state=$2,recording_by=$3,captions=$4 WHERE id=$1", [meetingId, on ? "on" : "off", on ? s.person.key : null, on && captions]);
  if (on) await setConsent(s, meetingId, "given");
  if (meeting.postId && meeting.channelId)
    await addPost(
      s,
      meeting.channelId,
      { body: on ? `${s.person.name} started recording${captions ? " and transcribing" : ""}. Everyone in the call was asked to agree.` : `${s.person.name} stopped recording.`, parentId: meeting.postId },
      { authorKind: "system", quiet: true },
    );
  return getMeeting(s, meetingId);
}

export async function setConsent(s: CommsScope, meetingId: string, decision: "given" | "declined"): Promise<void> {
  await getMeeting(s, meetingId);
  await s.db.query(
    `INSERT INTO meeting_consents(meeting_id,person_key,name,decision) VALUES($1,$2,$3,$4)
     ON CONFLICT(meeting_id,person_key) DO UPDATE SET decision=EXCLUDED.decision,name=EXCLUDED.name,decided_at=NOW()`,
    [meetingId, s.person.key, s.person.name.slice(0, 255), decision],
  );
}

export async function listConsents(db: Db, meetingId: string): Promise<Consent[]> {
  const rows = await db.query<{ person_key: string; name: string; decision: Consent["decision"]; decided_at: Date }>(
    "SELECT person_key,name,decision,decided_at FROM meeting_consents WHERE meeting_id=$1 ORDER BY decided_at",
    [meetingId],
  );
  return rows.map((r) => ({ personKey: r.person_key, name: r.name, decision: r.decision, decidedAt: iso(r.decided_at)! }));
}

/** Live captions from one person's browser. Only while transcribing, and only from someone who agreed to it. */
export async function addCaptions(s: CommsScope, meetingId: string, peerId: string, lines: { atMs: number; text: string }[]): Promise<void> {
  await myPeer(s, meetingId, peerId);
  const meeting = await getMeeting(s, meetingId);
  if (meeting.recording !== "on" || !meeting.captions) throw new AccessError("Transcription is not on", 409);
  const consent = (await listConsents(s.db, meetingId)).find((c) => c.personKey === s.person.key);
  if (consent?.decision !== "given") throw new AccessError("Agree to the transcript first", 409);
  await addTranscriptLines(s.db, meetingId, lines.map((l) => ({ ...l, speaker: s.person.name })), "live", s.person.key);
}

// ---------------------------------------------------------------------------
// Transcripts and recordings
// ---------------------------------------------------------------------------

export async function addTranscriptLines(
  db: Db,
  meetingId: string,
  lines: { speaker: string; atMs: number; text: string }[],
  source: TranscriptLine["source"],
  personKey?: string,
): Promise<number> {
  let added = 0;
  for (const l of lines) {
    // Very long passages are kept as several lines.
    for (let i = 0; i < l.text.length && added < 20_000; i += 5000) {
      const text = l.text.slice(i, i + 5000).trim();
      if (!text) continue;
      await db.query("INSERT INTO meeting_transcript_lines(meeting_id,speaker,person_key,at_ms,text,source) VALUES($1,$2,$3,$4,$5,$6)", [
        meetingId,
        l.speaker.slice(0, 255),
        personKey ?? null,
        Math.max(0, Math.round(l.atMs)),
        text,
        source,
      ]);
      added++;
    }
  }
  return added;
}

export async function transcriptLines(db: Db, meetingId: string, afterId = 0, limit = 5000): Promise<TranscriptLine[]> {
  const rows = await db.query<{ id: string | number; speaker: string; at_ms: number; text: string; source: TranscriptLine["source"] }>(
    "SELECT id,speaker,at_ms,text,source FROM meeting_transcript_lines WHERE meeting_id=$1 AND id>$2 ORDER BY id LIMIT $3",
    [meetingId, afterId, limit],
  );
  return rows.map((r) => ({ id: String(r.id), speaker: r.speaker, atMs: Number(r.at_ms), text: r.text, source: r.source }));
}

/**
 * The meeting's transcript to read: an uploaded one wins, then the transcribed
 * recording, then live captions; within each, in the order things were said.
 */
export async function getTranscript(s: CommsScope, meetingId: string): Promise<TranscriptLine[]> {
  await getMeeting(s, meetingId);
  const all = await transcriptLines(s.db, meetingId);
  for (const source of ["upload", "recording", "live"] as const) {
    const lines = all.filter((l) => l.source === source);
    if (lines.length) return source === "live" ? lines : lines.sort((a, b) => a.atMs - b.atMs || Number(a.id) - Number(b.id));
  }
  return [];
}

/** Replaces the uploaded transcript of a meeting. */
export async function uploadTranscript(s: CommsScope, meetingId: string, lines: { speaker: string; atMs: number; text: string }[]): Promise<number> {
  refuseClient(s);
  await getMeeting(s, meetingId);
  await s.db.query("DELETE FROM meeting_transcript_lines WHERE meeting_id=$1 AND source='upload'", [meetingId]);
  return addTranscriptLines(s.db, meetingId, lines, "upload", s.person.key);
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
}

export async function listRecordings(s: CommsScope, meetingId: string): Promise<Recording[]> {
  await getMeeting(s, meetingId);
  const rows = await s.db.query<{ id: string; name: string; content_type: string; size_bytes: string | number; duration_sec: number; status: Recording["status"]; error: string | null; created_at: Date }>(
    "SELECT id,name,content_type,size_bytes,duration_sec,status,error,created_at FROM meeting_recordings WHERE meeting_id=$1 ORDER BY created_at",
    [meetingId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, contentType: r.content_type, sizeBytes: Number(r.size_bytes), durationSec: Number(r.duration_sec), status: r.status, error: r.error, createdAt: iso(r.created_at)! }));
}

export async function addRecording(
  s: CommsScope,
  meetingId: string,
  file: { storageKey: string; name: string; contentType: string; sizeBytes: number; durationSec: number },
): Promise<Recording> {
  refuseClient(s);
  await getMeeting(s, meetingId);
  const [row] = await s.db.query<{ id: string }>(
    "INSERT INTO meeting_recordings(meeting_id,storage_key,name,content_type,size_bytes,duration_sec,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [meetingId, file.storageKey, file.name.slice(0, 255), file.contentType.slice(0, 100), file.sizeBytes, file.durationSec, s.person.key],
  );
  return (await listRecordings(s, meetingId)).find((r) => r.id === row.id)!;
}

export async function recordingFile(s: CommsScope, meetingId: string, recordingId: string): Promise<{ storageKey: string; name: string; contentType: string } | null> {
  await getMeeting(s, meetingId);
  const [row] = await s.db.query<{ storage_key: string; name: string; content_type: string }>(
    "SELECT storage_key,name,content_type FROM meeting_recordings WHERE id=$1 AND meeting_id=$2",
    [recordingId, meetingId],
  );
  return row ? { storageKey: row.storage_key, name: row.name, contentType: row.content_type } : null;
}

export async function setRecordingStatus(db: Db, recordingId: string, status: Recording["status"], error?: string, durationSec?: number): Promise<void> {
  await db.query("UPDATE meeting_recordings SET status=$2,error=$3,duration_sec=COALESCE($4,duration_sec) WHERE id=$1", [recordingId, status, error?.slice(0, 500) ?? null, durationSec ?? null]);
}

// ---------------------------------------------------------------------------
// Saved posts and reminders; posts sent later
// ---------------------------------------------------------------------------

/** Saves a post for this person, with a reminder when they want one; saving again changes the reminder. */
export async function savePost(s: CommsScope, postId: string, remindAt: string | null): Promise<void> {
  await postIn(s, postId);
  if (remindAt && Date.parse(remindAt) < Date.now() - 60_000) throw new AccessError("Pick a time still to come", 400);
  await s.db.query(
    `INSERT INTO project_chat_saved(post_id,person_key,workspace_id,remind_at) VALUES($1,$2,$3,$4)
     ON CONFLICT(post_id,person_key) DO UPDATE SET remind_at=EXCLUDED.remind_at,reminded_at=NULL`,
    [postId, s.person.key, s.workspaceId, remindAt],
  );
}

export async function unsavePost(s: CommsScope, postId: string): Promise<void> {
  await s.db.query("DELETE FROM project_chat_saved WHERE post_id=$1 AND person_key=$2", [postId, s.person.key]);
}

/** The posts this person saved on this project, newest saved first, with their reminders. */
export async function listSaved(s: CommsScope): Promise<(Post & { channelName: string; remindAt: string | null })[]> {
  const channels = await listChannels(s);
  if (!channels.length) return [];
  const rows = await s.db.query<PostRow & { remind_at: Date | null; reminded_at: Date | null }>(
    `SELECT ${POST_COLUMNS.split(",").map((c) => `m.${c}`).join(",")},sv.remind_at,sv.reminded_at FROM project_chat_saved sv JOIN project_chat_messages m ON m.id=sv.post_id
     WHERE sv.person_key=$1 AND m.chat_id = ANY($2::uuid[]) ORDER BY sv.created_at DESC LIMIT 200`,
    [s.person.key, channels.map((c) => c.id)],
  );
  const names = new Map(channels.map((c) => [c.id, c.name]));
  return rows.map((r) => ({ ...toPost(r), channelName: names.get(r.chat_id) ?? "", remindAt: r.reminded_at ? null : iso(r.remind_at) }));
}

/** Writes a post now to go out at a time to come (the studio only), as its author. */
export async function schedulePost(s: CommsScope, channelId: string, input: NewPost, sendAt: string): Promise<ScheduledPost> {
  refuseClient(s);
  await getChannel(s, channelId);
  const at = Date.parse(sendAt);
  if (!(at > Date.now() + 30_000) || at > Date.now() + 90 * 86_400_000) throw new AccessError("Pick a time from now up to three months ahead", 400);
  if (input.parentId) {
    const { channel } = await postIn(s, input.parentId);
    if (channel.id !== channelId) throw new AccessError("Reply in the post's own channel", 400);
  }
  const [count] = await s.db.query<{ n: number }>("SELECT count(*)::int AS n FROM project_chat_scheduled WHERE workspace_id=$1 AND author_id=$2", [s.workspaceId, s.person.key]);
  if ((count?.n ?? 0) >= 100) throw new AccessError("You have 100 posts waiting to go out. Send or cancel some first.", 400);
  const [row] = await s.db.query<ScheduledRow>(
    `INSERT INTO project_chat_scheduled(workspace_id,project_id,chat_id,parent_id,author_id,author_name,body,attachments,ask,send_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10) RETURNING id,chat_id,parent_id,body,attachments,send_at`,
    [
      s.workspaceId,
      s.projectId,
      channelId,
      input.parentId ?? null,
      s.person.key,
      s.person.name.slice(0, 255),
      input.body,
      JSON.stringify(input.attachments ?? []),
      input.ask ? JSON.stringify(input.ask) : null,
      new Date(at).toISOString(),
    ],
  );
  return toScheduled(row);
}

interface ScheduledRow {
  id: string;
  chat_id: string;
  parent_id: string | null;
  body: string;
  attachments: { name: string }[] | string;
  send_at: Date;
}
const toScheduled = (r: ScheduledRow): ScheduledPost => ({
  id: r.id,
  channelId: r.chat_id,
  parentId: r.parent_id,
  body: r.body,
  files: ((typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments) ?? []).map((a: { name: string }) => a.name),
  sendAt: iso(r.send_at)!,
});

/** This person's posts waiting to go out in a channel, soonest first. */
export async function listScheduled(s: CommsScope, channelId: string): Promise<ScheduledPost[]> {
  if (!isTeam(s)) return [];
  const rows = await s.db.query<ScheduledRow>(
    "SELECT id,chat_id,parent_id,body,attachments,send_at FROM project_chat_scheduled WHERE chat_id=$1 AND author_id=$2 AND workspace_id=$3 ORDER BY send_at",
    [channelId, s.person.key, s.workspaceId],
  );
  return rows.map(toScheduled);
}

/** Cancels one of this person's posts waiting to go out; with `sendNow` it goes out at once instead. */
export async function cancelScheduled(s: CommsScope, id: string, sendNow = false): Promise<Post | null> {
  const [row] = await s.db.query<ScheduledFull>(`DELETE FROM project_chat_scheduled WHERE id=$1 AND author_id=$2 AND workspace_id=$3 RETURNING ${SCHEDULED_FULL}`, [
    id,
    s.person.key,
    s.workspaceId,
  ]);
  if (!row) throw new AccessError("That post is no longer waiting", 404);
  return sendNow ? sendScheduled(s.db, row) : null;
}

interface ScheduledFull extends ScheduledRow {
  workspace_id: string;
  project_id: string;
  author_id: string;
  author_name: string;
  ask: { options: string[] } | string | null;
  slug: string;
}
const SCHEDULED_FULL = "id,workspace_id,project_id,chat_id,parent_id,author_id,author_name,body,attachments,ask,send_at,(SELECT slug FROM projects p WHERE p.id=project_id) AS slug";

async function sendScheduled(db: Db, r: ScheduledFull): Promise<Post | null> {
  const s: CommsScope = { db, workspaceId: r.workspace_id, projectId: r.project_id, slug: r.slug, person: { key: r.author_id, name: r.author_name, kind: "team" }, manager: false };
  const files = (typeof r.attachments === "string" ? JSON.parse(r.attachments) : r.attachments) as AttachmentInput[];
  const ask = typeof r.ask === "string" ? JSON.parse(r.ask) : r.ask;
  try {
    return await addPost(s, r.chat_id, { body: r.body, parentId: r.parent_id, attachments: files, ...(ask ? { ask } : {}) });
  } catch (err) {
    // The author left the channel, or it went: tell them their post did not go out.
    await notify(db, {
      workspaceId: r.workspace_id,
      projectId: r.project_id,
      userIds: [r.author_id],
      kind: "post",
      title: "A post you wrote for later could not go out",
      body: `${err instanceof Error ? err.message : "It could not be sent"}: ${r.body.slice(0, 200)}`,
      href: `/projects/${r.slug}/conversations?channel=${r.chat_id}`,
    });
    return null;
  }
}

/**
 * Sends the workspace's posts whose time has come and gives out reminders
 * that are due. Called whenever someone in the workspace looks at their
 * notifications or a conversation, so nothing waits on a timer.
 */
export async function deliverDue(db: Db, workspaceId: string): Promise<void> {
  const due = await db.query<ScheduledFull>(
    `DELETE FROM project_chat_scheduled WHERE id IN (SELECT id FROM project_chat_scheduled WHERE workspace_id=$1 AND send_at <= NOW() ORDER BY send_at LIMIT 20) RETURNING ${SCHEDULED_FULL}`,
    [workspaceId],
  );
  for (const r of due.sort((a, b) => a.send_at.getTime() - b.send_at.getTime())) await sendScheduled(db, r);
  const reminders = await db.query<{ post_id: string; person_key: string; chat_id: string; parent_id: string | null; body: string; author_name: string; slug: string; project_id: string }>(
    `UPDATE project_chat_saved sv SET reminded_at=NOW() FROM project_chat_messages m JOIN project_chats c ON c.id=m.chat_id JOIN projects p ON p.id=c.project_id
     WHERE sv.post_id=m.id AND sv.workspace_id=$1 AND sv.remind_at <= NOW() AND sv.reminded_at IS NULL
     RETURNING sv.post_id,sv.person_key,m.chat_id,m.parent_id,m.body,m.author_name,p.slug,c.project_id`,
    [workspaceId],
  );
  await remindMeetings(db, workspaceId);
  for (const r of reminders)
    await notify(db, {
      workspaceId,
      projectId: r.project_id,
      userIds: [r.person_key],
      kind: "reminder",
      title: `Reminder: ${r.author_name}'s post`,
      body: r.body.slice(0, 300),
      href: conversationsHref(r.slug, r.chat_id, r.parent_id ?? r.post_id),
    });
}

/**
 * Forwards a post into another channel of the project (the studio only), as
 * a quote with who wrote it and where, its files carried along, and a note
 * of the forwarder's own above it. Names in the quote don't notify again.
 */
export async function forwardPost(s: CommsScope, postId: string, toChannelId: string, note = ""): Promise<Post> {
  refuseClient(s);
  const { post, channel: from } = await postIn(s, postId);
  if (post.authorKind === "system" && !post.body) throw new AccessError("There is nothing to forward", 400);
  const [raw] = await s.db.query<{ attachments: unknown }>("SELECT attachments FROM project_chat_messages WHERE id=$1", [postId]);
  const files = ((typeof raw?.attachments === "string" ? JSON.parse(raw.attachments) : raw?.attachments) ?? []) as (AttachmentInput & { id: string })[];
  const where = from.direct ? "a direct message" : `#${from.name}`;
  const when = post.createdAt.slice(0, 10);
  const quoted = post.body
    .replace(/@/g, "@\u200b")
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const head = `> Forwarded from **${post.authorName.replace(/[*_`]/g, "")}** in ${where}, ${when}`;
  const body = `${note.trim() ? `${note.trim()}\n\n` : ""}${head}${post.body ? `\n${quoted}` : ""}`;
  return addPost(s, toChannelId, {
    body: body.length > 5000 ? `${body.slice(0, 4990)}…` : body,
    attachments: files.map(({ storageKey, name, sizeBytes, contentType }) => ({ storageKey, name, sizeBytes, contentType })),
  });
}

/** The preview of the first web address in a post this person can see. */
export async function postLinkPreview(s: CommsScope, postId: string, read?: Parameters<typeof linkPreview>[3]): Promise<LinkPreview | null> {
  const { post } = await postIn(s, postId);
  const url = firstWebLink(post.body);
  return url ? linkPreview(s.db, s.workspaceId, url, read) : null;
}

/** Tells the team a meeting starts within ten minutes, once, with the way in. */
async function remindMeetings(db: Db, workspaceId: string): Promise<void> {
  const soon = await db.query<{ id: string; title: string; starts_at: Date; chat_id: string | null; project_id: string; slug: string }>(
    `UPDATE meetings m SET reminded_at=NOW() FROM projects p
     WHERE p.id=m.project_id AND m.workspace_id=$1 AND m.status='scheduled' AND m.reminded_at IS NULL
       AND m.starts_at <= NOW() + INTERVAL '10 minutes' AND m.starts_at > NOW() - INTERVAL '5 minutes'
     RETURNING m.id,m.title,m.starts_at,m.chat_id,m.project_id,p.slug`,
    [workspaceId],
  );
  for (const m of soon) {
    const [row] = m.chat_id ? await db.query<ChannelRow>(`SELECT ${CHANNEL_COLUMNS} FROM project_chats c WHERE c.id=$1`, [m.chat_id]) : [];
    const channel = row ? toChannel(row) : null;
    const team = (await projectTeam(db, workspaceId, m.slug)).filter((p) => p.active).map((p) => p.id);
    const minutes = Math.round((m.starts_at.getTime() - Date.now()) / 60_000);
    await notify(db, {
      workspaceId,
      projectId: m.project_id,
      userIds: team.filter((key) => !channel || canSee(channel, { key, name: "", kind: "team" })),
      kind: "meeting",
      title: minutes > 0 ? `${m.title} starts in ${minutes} min` : `${m.title} is starting`,
      body: "Join from the meeting page.",
      href: `${meetingHref(m.slug, m.id)}?join=1`,
    });
  }
}

/** Whether this person hears about every reply in a thread: they follow it, or wrote in it and did not leave. */
export async function isFollowing(s: CommsScope, rootId: string): Promise<boolean> {
  const [row] = await s.db.query<{ follow: boolean | null; wrote: boolean }>(
    `SELECT (SELECT follow FROM project_chat_follows WHERE post_id=$1 AND person_key=$2) AS follow,
            EXISTS(SELECT 1 FROM project_chat_messages WHERE (id=$1 OR parent_id=$1) AND author_id=$2) AS wrote`,
    [rootId, s.person.key],
  );
  return row?.follow ?? !!row?.wrote;
}

/** Follows a thread or leaves it, for this person. Returns the thread's post. */
export async function setFollow(s: CommsScope, postId: string, follow: boolean): Promise<Post> {
  const { post } = await postIn(s, postId);
  const root = post.parentId ? (await postIn(s, post.parentId)).post : post;
  await s.db.query(
    `INSERT INTO project_chat_follows(post_id,person_key,follow) VALUES($1,$2,$3)
     ON CONFLICT(post_id,person_key) DO UPDATE SET follow=EXCLUDED.follow,updated_at=NOW()`,
    [root.id, s.person.key, follow],
  );
  return root;
}

/** The picture of the first web address in a post this person can see, fetched by the server. */
export async function postPreviewImage(s: CommsScope, postId: string, image: typeof previewImage = previewImage): Promise<{ bytes: Buffer; type: string } | null> {
  const preview = await postLinkPreview(s, postId);
  return preview?.image ? image(preview.image) : null;
}
