import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import { AccessError } from "@/lib/workspaces/store";
import { projectTeam } from "@/lib/team/store";
import { recordingAllowed } from "./calls";
import { BUILTIN_MAX_PEERS, PEER_TIMEOUT_MS, findMentions, postPreview, readReactions, type ReactionEmoji } from "./types";
import type {
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
}
const CHANNEL_COLUMNS = "c.id,c.name,c.description,c.visibility,c.member_ids,c.is_default,c.created_by,c.created_at,c.last_message_at";

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
          AND m.created_at > COALESCE((SELECT r.read_at FROM project_chat_reads r WHERE r.chat_id=c.id AND r.person_key=$3), '-infinity'::timestamptz)) AS unread
     FROM project_chats c WHERE c.workspace_id=$1 AND c.project_id=$2 AND (c.archived_at IS NULL) <> $4
     ORDER BY c.is_default DESC, c.created_at`,
    [s.workspaceId, s.projectId, s.person.key, opts.archived === true],
  );
  return rows.map(toChannel).filter((c) => canSee(c, s.person));
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
     RETURNING id,name,description,visibility,member_ids,is_default,created_by,created_at,last_message_at`,
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
  if (change.visibility === "client" && channel.memberIds.length) throw new AccessError("Only a channel open to the whole team can be shared with clients", 400);
  const [row] = await s.db.query<ChannelRow>(
    `UPDATE project_chats c SET name=COALESCE($4,name),description=COALESCE($5,description),visibility=COALESCE($6,visibility),
       archived_at=CASE WHEN $7::boolean IS NULL THEN archived_at WHEN $7 THEN COALESCE(archived_at,NOW()) ELSE NULL END
     WHERE id=$1 AND workspace_id=$2 AND project_id=$3 RETURNING ${CHANNEL_COLUMNS}`,
    [channelId, s.workspaceId, s.projectId, change.name ?? null, change.description ?? null, change.visibility ?? null, change.archived ?? null],
  );
  return toChannel(row);
}

/** Marks a channel read up to now for this person. */
export async function markRead(s: CommsScope, channelId: string): Promise<void> {
  await getChannel(s, channelId);
  await s.db.query(
    `INSERT INTO project_chat_reads(chat_id,person_key,read_at) VALUES($1,$2,NOW())
     ON CONFLICT(chat_id,person_key) DO UPDATE SET read_at=NOW()`,
    [channelId, s.person.key],
  );
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
}
const POST_COLUMNS = "id,chat_id,parent_id,author_id,author_name,author_kind,body,attachments,mentions,meeting_id,reply_count,last_reply_at,created_at,edited_at,reactions";

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
    `INSERT INTO project_chat_messages(chat_id,parent_id,author_id,author_name,author_kind,body,attachments,mentions,meeting_id)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) RETURNING ${POST_COLUMNS}`,
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
  const inChannel = (key: string) => team.includes(key) && canSee(channel, { key, name: "", kind: "team" });
  const mentioned = post.mentions.includes("everyone") ? team.filter(inChannel) : post.mentions.filter(inChannel);
  const thread = new Set<string>();
  if (parent) {
    thread.add(parent.authorKey);
    const repliers = await s.db.query<{ author_id: string }>("SELECT DISTINCT author_id FROM project_chat_messages WHERE parent_id=$1", [parent.id]);
    repliers.forEach((r) => thread.add(r.author_id));
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
    title: `${post.authorName} mentioned you in #${channel.name}`,
    body: preview,
    href,
    actor: post.authorName,
  });
  await notify(s.db, {
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    userIds: [...thread].filter((k) => k !== self && inChannel(k) && !mentionedOnly.includes(k)),
    kind: parent ? "reply" : "post",
    title: parent ? `${post.authorName} replied in #${channel.name}` : `${post.authorName} posted in #${channel.name}`,
    body: preview,
    href,
    actor: post.authorName,
  });
}

/** Changes a post's text; only its author can. */
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

const MEETING_SELECT = `SELECT mt.id,mt.title,mt.agenda,mt.starts_at,mt.duration_min,mt.status,mt.provider,mt.client_visible,mt.chat_id,mt.post_id,
  mt.recording_state,mt.recording_by,mt.captions,mt.notes,mt.notes_source,mt.notes_at,mt.created_by,mt.created_at,mt.started_at,mt.ended_at,p.slug,
  (SELECT count(*)::int FROM meeting_peers pe WHERE pe.meeting_id=mt.id AND pe.left_at IS NULL AND pe.last_seen_at > NOW() - make_interval(secs => ${PEER_TIMEOUT_MS / 1000})) AS in_call,
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

// A meeting in a private channel follows that channel's audience, including
// when listed outside the conversation page on the workspace calendar.
const meetingChannelAccess = (team: string, person: string) => `(mt.chat_id IS NULL OR EXISTS (
  SELECT 1 FROM project_chats c WHERE c.id=mt.chat_id AND c.workspace_id=mt.workspace_id AND c.project_id=mt.project_id
  AND (CASE WHEN ${team} THEN cardinality(c.member_ids)=0 OR c.created_by=${person} OR ${person}=ANY(c.member_ids)
       ELSE c.visibility='client' END)))`;

/** The project's meetings in a time range (all of them when left out), soonest first. */
export async function listMeetings(s: CommsScope, range: { from?: string; to?: string } = {}): Promise<Meeting[]> {
  const rows = await s.db.query<MeetingRow>(
    `${MEETING_SELECT} WHERE mt.workspace_id=$1 AND mt.project_id=$2 AND ($3::boolean OR mt.client_visible)
       AND ($4::timestamptz IS NULL OR mt.starts_at >= $4) AND ($5::timestamptz IS NULL OR mt.starts_at < $5)
       AND ${meetingChannelAccess("$3::boolean", "$6")}
     ORDER BY mt.starts_at LIMIT 500`,
    [s.workspaceId, s.projectId, isTeam(s), range.from ?? null, range.to ?? null, s.person.key],
  );
  return rows.map((r) => shown(s, toMeeting(r)));
}

/** Meetings across several projects of a workspace, for the calendar. */
export async function meetingsBetween(db: Db, workspaceId: string, slugs: string[], from: string, to: string, personKey: string): Promise<Meeting[]> {
  if (!slugs.length) return [];
  const rows = await db.query<MeetingRow>(
    `${MEETING_SELECT} WHERE mt.workspace_id=$1 AND p.slug = ANY($2::text[]) AND mt.starts_at >= $3 AND mt.starts_at < $4 AND mt.status<>'cancelled'
       AND ${meetingChannelAccess("TRUE", "$5")}
     ORDER BY mt.starts_at LIMIT 1000`,
    [workspaceId, slugs, from, to, personKey],
  );
  return rows.map(toMeeting);
}

export async function getMeeting(s: CommsScope, meetingId: string): Promise<Meeting> {
  const [row] = await s.db.query<MeetingRow>(`${MEETING_SELECT} WHERE mt.id=$1 AND mt.workspace_id=$2 AND mt.project_id=$3`, [meetingId, s.workspaceId, s.projectId]);
  if (!row || (!isTeam(s) && !row.client_visible)) throw new AccessError("Meeting not found", 404);
  if (row.chat_id) await getChannel(s, row.chat_id);
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
  const room = randomBytes(12).toString("base64url");
  const [row] = await s.db.query<{ id: string }>(
    `INSERT INTO meetings(workspace_id,project_id,title,agenda,starts_at,duration_min,provider,room,client_visible,chat_id,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [s.workspaceId, s.projectId, input.title, input.agenda ?? "", input.startsAt, input.durationMin ?? 30, provider, room, input.clientVisible === true, channel.id, s.person.key],
  );
  const post = await addPost(
    s,
    channel.id,
    { body: `Meeting: ${input.title} · ${when(input.startsAt)} (${input.durationMin ?? 30} min)${input.agenda ? `\n${input.agenda}` : ""}` },
    { authorKind: "system", meetingId: row.id, quiet: true },
  );
  await s.db.query("UPDATE meetings SET post_id=$2 WHERE id=$1", [row.id, post.id]);
  const team = (await projectTeam(s.db, s.workspaceId, s.slug)).filter((m) => m.active && canSee(channel, { key: m.id, name: m.name, kind: "team" }));
  await notify(s.db, {
    workspaceId: s.workspaceId,
    projectId: s.projectId,
    userIds: team.map((m) => m.id).filter((id) => id !== s.person.key),
    kind: "meeting",
    title: `${s.person.name} scheduled ${input.title}`,
    body: when(input.startsAt),
    href: meetingHref(s.slug, row.id),
    actor: s.person.name,
  });
  return getMeeting(s, row.id);
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
       client_visible=COALESCE($6,client_visible),status=CASE WHEN $7::text IS NULL THEN status ELSE $7 END,
       notes=COALESCE($8::jsonb,notes),notes_source=CASE WHEN $8::jsonb IS NULL THEN notes_source ELSE 'manual' END,notes_at=CASE WHEN $8::jsonb IS NULL THEN notes_at ELSE NOW() END
     WHERE id=$1`,
    [meetingId, change.title ?? null, change.agenda ?? null, change.startsAt ?? null, change.durationMin ?? null, change.clientVisible ?? null, change.status ?? null, change.notes ? JSON.stringify(change.notes) : null],
  );
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
    // Notes stay on the team-only meeting detail. Even a team channel can
    // later be shared with clients, so never copy private notes into its history.
    const body = source === "quick" ? "Quick meeting notes are ready for the team on the meeting page." : "Meeting notes are ready for the team on the meeting page.";
    await addPost(s, meeting.channelId, { body, parentId: meeting.postId }, { authorKind: "system", authorName: "Meeting notes", quiet: true });
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
}
const toPeer = (r: PeerRow): Peer => ({
  id: r.id,
  personKey: r.person_key,
  name: r.name,
  kind: r.kind,
  state: typeof r.state === "string" ? JSON.parse(r.state) : r.state,
  joinedAt: iso(r.joined_at)!,
});

async function activePeers(db: Db, meetingId: string): Promise<Peer[]> {
  const rows = await db.query<PeerRow>(
    `SELECT id,person_key,name,kind,state,joined_at FROM meeting_peers WHERE meeting_id=$1 AND left_at IS NULL
       AND last_seen_at > NOW() - make_interval(secs => ${PEER_TIMEOUT_MS / 1000}) ORDER BY joined_at`,
    [meetingId],
  );
  return rows.map(toPeer);
}

async function myPeer(s: CommsScope, meetingId: string, peerId: string): Promise<void> {
  const [row] = await s.db.query<{ person_key: string }>("SELECT person_key FROM meeting_peers WHERE id=$1 AND meeting_id=$2 AND left_at IS NULL", [peerId, meetingId]);
  if (!row || row.person_key !== s.person.key) throw new AccessError("Join the call first", 409);
}

/** Joins a call (one row per browser tab). The meeting goes live with its first person. */
export async function joinRoom(s: CommsScope, meetingId: string, peerId: string, state: PeerState): Promise<{ meeting: Meeting; peer: Peer }> {
  const meeting = await getMeeting(s, meetingId);
  if (meeting.status === "cancelled") throw new AccessError("This meeting was cancelled", 400);
  const peers = await activePeers(s.db, meetingId);
  if (meeting.provider === "builtin" && peers.filter((p) => p.id !== peerId).length >= BUILTIN_MAX_PEERS)
    throw new AccessError(`This call is full: the built-in call service takes ${BUILTIN_MAX_PEERS} people. The Admin can switch on LiveKit for larger calls.`, 400);
  const [row] = await s.db.query<PeerRow>(
    `INSERT INTO meeting_peers(id,meeting_id,person_key,name,kind,state) VALUES($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state,last_seen_at=NOW(),left_at=NULL WHERE meeting_peers.person_key=EXCLUDED.person_key AND meeting_peers.meeting_id=EXCLUDED.meeting_id
     RETURNING id,person_key,name,kind,state,joined_at`,
    [peerId, meetingId, s.person.key, s.person.name.slice(0, 255), s.person.kind, JSON.stringify(state)],
  );
  if (!row) throw new AccessError("Join again", 409);
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
  const touched = await s.db.query(
    "UPDATE meeting_peers SET last_seen_at=NOW(),state=COALESCE($3::jsonb,state) WHERE id=$1 AND meeting_id=$2 AND person_key=$4 AND left_at IS NULL RETURNING id",
    [peerId, meetingId, opts.state ? JSON.stringify(opts.state) : null, s.person.key],
  );
  if (!touched.length) throw new AccessError("You are no longer in this call", 409);
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
  };
}

/** Passes WebRTC handshakes from one browser in the call to another. */
export async function sendSignals(s: CommsScope, meetingId: string, peerId: string, to: string, payloads: SignalPayload[]): Promise<void> {
  await getMeeting(s, meetingId);
  await myPeer(s, meetingId, peerId);
  const [target] = await s.db.query("SELECT 1 FROM meeting_peers WHERE id=$1 AND meeting_id=$2 AND left_at IS NULL", [to, meetingId]);
  if (!target) return;
  for (const p of payloads)
    await s.db.query("INSERT INTO meeting_signals(meeting_id,from_peer,to_peer,payload) VALUES($1,$2,$3,$4::jsonb)", [meetingId, peerId, to, JSON.stringify(p)]);
}

/** Leaves the call; when the last person leaves, the meeting ends. Returns true when it ended. */
export async function leaveRoom(s: CommsScope, meetingId: string, peerId: string): Promise<boolean> {
  await getMeeting(s, meetingId);
  const [peer] = await s.db.query("SELECT id FROM meeting_peers WHERE id=$1 AND meeting_id=$2 AND person_key=$3", [peerId, meetingId, s.person.key]);
  if (!peer) throw new AccessError("This is not your call session", 409);
  await s.db.query("UPDATE meeting_peers SET left_at=NOW() WHERE id=$1 AND meeting_id=$2 AND person_key=$3", [peerId, meetingId, s.person.key]);
  await s.db.query("DELETE FROM meeting_signals WHERE to_peer=$1 OR from_peer=$1", [peerId]);
  if ((await activePeers(s.db, meetingId)).length) return false;
  return endMeeting(s, meetingId, false);
}

/** Ends the call for everyone. Only the studio can end it while people are in it. */
export async function endMeeting(s: CommsScope, meetingId: string, byHand = true): Promise<boolean> {
  if (byHand) refuseClient(s, "Only the studio can end the call for everyone");
  await getMeeting(s, meetingId);
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
