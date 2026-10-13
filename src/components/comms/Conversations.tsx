"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AtSign, Bot, CalendarClock, Hash, Lock, MessageSquare, Paperclip, Pencil, Plus, Send, Settings2, SmilePlus, Trash2, Users, Video, X } from "lucide-react";
import { initials } from "@/components/ui/primitives";
import { fileSize, relativeTime } from "@/lib/studio/format";
import { isString } from "@/lib/view-settings/client";
import type { ChannelList, CommsBackend } from "@/lib/comms/client";
import { ASSISTANT_KEY, REACTIONS, type Attachment, type Channel, type Post } from "@/lib/comms/types";
import { usePolling, useRemembered } from "./useComms";
import { RichText } from "./RichText";

export { RichText };
import "./comms.css";

/**
 * A project's conversations, Teams-style: channels down the side, posts in
 * the middle and a post's thread beside it. On a phone each is its own screen.
 * Teammates see the channels they are in; an invited client sees only client
 * channels. "@Name" mentions someone; "@Assistant" asks the AI to answer in
 * the thread and carry the work on.
 */
export function Conversations({
  backend,
  meetingHref,
  initialChannel,
  initialPost,
}: {
  backend: CommsBackend;
  /** Where a meeting's page is, for its card in a post. */
  meetingHref: (meetingId: string) => string;
  initialChannel?: string | null;
  initialPost?: string | null;
}) {
  const team = backend.audience === "team";
  const list = usePolling(() => backend.channels(), 10_000, [backend]);
  const [remembered, remember] = useRemembered<string>("conversations.channel", "", isString, team);
  const [channelId, setChannelId] = useState<string | null>(initialChannel ?? null);
  const [threadId, setThreadId] = useState<string | null>(initialPost ?? null);
  const [pane, setPane] = useState<"list" | "channel" | "thread">(initialPost ? "thread" : initialChannel ? "channel" : "list");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const channels = list.data?.channels ?? [];
  const current = channels.find((c) => c.id === channelId) ?? channels.find((c) => c.id === remembered) ?? channels[0];

  const open = (id: string) => {
    setChannelId(id);
    remember(id);
    setThreadId(null);
    setPane("channel");
    setEditing(false);
  };
  const openThread = (id: string) => {
    setThreadId(id);
    setPane("thread");
  };

  return (
    <div className="cv-area" data-pane={pane} data-thread={threadId ? "open" : "closed"}>
      <aside className="cv-channels" aria-label="Channels">
        <div className="cv-channels-head">
          <span className="eyebrow">Channels</span>
          {team && (
            <button type="button" className="icon-btn" aria-label="New channel" onClick={() => setCreating(true)}>
              <Plus size={17} />
            </button>
          )}
        </div>
        {list.error && !list.data && <p className="tiny cv-problem">{list.error}</p>}
        {!list.data && !list.error && <p className="tiny muted" style={{ padding: "0.5rem 0.75rem" }}>Loading…</p>}
        <nav className="cv-channel-list">
          {channels.map((c) => (
            <button key={c.id} type="button" className="cv-channel" aria-current={current?.id === c.id ? "true" : undefined} onClick={() => open(c.id)}>
              <ChannelIcon channel={c} />
              <span className="cv-channel-name">{c.name}</span>
              {c.visibility === "client" && team && <span className="cv-tag">Client</span>}
              {c.unread > 0 && current?.id !== c.id && <span className="nav-badge">{c.unread > 99 ? "99+" : c.unread}</span>}
            </button>
          ))}
        </nav>
        {list.data && !channels.length && <p className="small muted" style={{ padding: "0.75rem" }}>Nothing has been shared with you here yet.</p>}
      </aside>

      <section className="cv-channel-pane" aria-label={current ? `#${current.name}` : "Channel"}>
        {current && list.data ? (
          <ChannelView
            key={current.id}
            backend={backend}
            list={list.data}
            channel={current}
            onBack={() => setPane("list")}
            onThread={openThread}
            openThreadId={threadId}
            onEdit={() => setEditing(!editing)}
            meetingHref={meetingHref}
            editing={editing && team}
            onChanged={() => {
              setEditing(false);
              void list.refresh();
            }}
          />
        ) : (
          <div className="cv-empty muted">Pick a channel.</div>
        )}
      </section>

      <aside className="cv-thread-pane" aria-label="Thread">
        {threadId && list.data && (
          <ThreadView
            key={threadId}
            backend={backend}
            list={list.data}
            postId={threadId}
            meetingHref={meetingHref}
            onClose={() => {
              setThreadId(null);
              setPane("channel");
            }}
          />
        )}
      </aside>

      {creating && list.data && (
        <NewChannel
          backend={backend}
          list={list.data}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            void list.refresh().then(() => open(c.id));
          }}
        />
      )}
    </div>
  );
}

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel.memberIds.length) return <Lock size={15} aria-label="Private" />;
  if (channel.visibility === "client") return <Users size={15} aria-label="Shared with the client" />;
  return <Hash size={15} aria-hidden />;
}

// ---------------------------------------------------------------------------
// One channel
// ---------------------------------------------------------------------------

function ChannelView({
  backend,
  list,
  channel,
  onBack,
  onThread,
  openThreadId,
  onEdit,
  editing,
  onChanged,
  meetingHref,
}: {
  backend: CommsBackend;
  list: ChannelList;
  channel: Channel;
  onBack: () => void;
  onThread: (postId: string) => void;
  openThreadId: string | null;
  onEdit: () => void;
  editing: boolean;
  onChanged: () => void;
  meetingHref: (id: string) => string;
}) {
  const posts = usePolling(() => backend.posts(channel.id), 4_000, [backend, channel.id]);
  const [older, setOlder] = useState<Post[]>([]);
  const [noMore, setNoMore] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const shown = useMemo(() => {
    const seen = new Set((posts.data ?? []).map((p) => p.id));
    return [...older.filter((p) => !seen.has(p.id)), ...(posts.data ?? [])];
  }, [older, posts.data]);
  const lastId = shown[shown.length - 1]?.id;

  useEffect(() => {
    const el = log.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const loadOlder = async () => {
    const first = shown[0];
    if (!first) return;
    const more = await backend.posts(channel.id, first.createdAt);
    if (more.length < 50) setNoMore(true);
    setOlder((o) => [...more, ...o]);
  };

  return (
    <>
      <header className="cv-head">
        <button type="button" className="icon-btn cv-back" aria-label="Channels" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <div className="grow" style={{ minWidth: 0 }}>
          <h2 className="cv-title">
            <ChannelIcon channel={channel} /> {channel.name}
            {channel.visibility === "client" && backend.audience === "team" && <span className="cv-tag">Client can see</span>}
          </h2>
          {channel.description && <p className="tiny muted truncate">{channel.description}</p>}
        </div>
        {backend.audience === "team" && (
          <button type="button" className="icon-btn" aria-label="Channel settings" aria-expanded={editing} onClick={onEdit}>
            <Settings2 size={17} />
          </button>
        )}
      </header>
      {editing && <ChannelSettings backend={backend} channel={channel} onDone={onChanged} />}
      <div
        className="cv-log"
        ref={log}
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {shown.length >= 50 && !noMore && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "center" }} onClick={() => void loadOlder()}>
            Show earlier posts
          </button>
        )}
        {posts.data && !shown.length && (
          <div className="cv-empty">
            <MessageSquare size={22} />
            <p className="small muted">
              No posts yet. Start the conversation{backend.audience === "team" ? ", mention someone with @, or ask @Assistant" : ""}.
            </p>
          </div>
        )}
        {shown.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            backend={backend}
            me={list.me.key}
            canManage={list.canManage}
            active={openThreadId === p.id}
            meetingHref={meetingHref}
            people={list.people}
            onReplies={() => onThread(p.id)}
            onChanged={() => void posts.refresh()}
          />
        ))}
      </div>
      {posts.error && <p className="tiny cv-problem">{posts.error}</p>}
      <Composer
        backend={backend}
        people={list.people}
        placeholder={`Post in #${channel.name}`}
        key={`channel:${channel.id}`}
        draftKey={`channel:${channel.id}`}
        onSend={async (body, files) => {
          const sent = await backend.post(channel.id, { body, files });
          atBottom.current = true;
          posts.setData((l) => [...(l ?? []), sent.post]);
          if (sent.assistantAnswering) onThread(sent.post.id);
        }}
      />
    </>
  );
}

function ChannelSettings({ backend, channel, onDone }: { backend: CommsBackend; channel: Channel; onDone: () => void }) {
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [shared, setShared] = useState(channel.visibility === "client");
  const [problem, setProblem] = useState("");
  const save = async (change: Parameters<CommsBackend["updateChannel"]>[1]) => {
    try {
      await backend.updateChannel(channel.id, change);
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Not saved. Please retry.");
    }
  };
  return (
    <form
      className="cv-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ name, description, visibility: shared ? "client" : "team" });
      }}
    >
      <label className="field">
        <span className="field-label">Name</span>
        <input className="input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} disabled={channel.isDefault} />
      </label>
      <label className="field">
        <span className="field-label">What it is for</span>
        <input className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {!channel.memberIds.length && (
        <label className="check-line">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Invited clients can read and post here
        </label>
      )}
      {problem && <p className="tiny cv-problem">{problem}</p>}
      <div className="row wrap" style={{ gap: "0.5rem" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
          Save
        </button>
        {!channel.isDefault && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save({ archived: true })}>
            Archive channel
          </button>
        )}
      </div>
    </form>
  );
}

function NewChannel({ backend, list, onClose, onCreated }: { backend: CommsBackend; list: ChannelList; onClose: () => void; onCreated: (c: Channel) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [who, setWho] = useState<"all" | "client" | "some">("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const others = list.people.filter((p) => p.key !== list.me.key && p.key !== ASSISTANT_KEY);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <form
        className="sheet cv-sheet"
        role="dialog"
        aria-label="New channel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setProblem("");
          try {
            onCreated(await backend.createChannel({ name, description, visibility: who === "client" ? "client" : "team", memberIds: who === "some" ? picked : [] }));
          } catch (err) {
            setProblem(err instanceof Error ? err.message : "The channel was not made. Please retry.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="row-between">
          <h2 className="display-s">New channel</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input" value={name} maxLength={100} placeholder="e.g. Lighting, Site visits, Client" onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">What it is for (optional)</span>
          <input className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <fieldset className="stack" style={{ gap: "0.4rem", border: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginBottom: "0.4rem" }}>Who is in it</legend>
          <label className="check-line">
            <input type="radio" name="who" checked={who === "all"} onChange={() => setWho("all")} /> Everyone on the project team
          </label>
          <label className="check-line">
            <input type="radio" name="who" checked={who === "client"} onChange={() => setWho("client")} /> The team and invited clients
          </label>
          {backend.mode === "server" && (
            <label className="check-line">
              <input type="radio" name="who" checked={who === "some"} onChange={() => setWho("some")} /> Only some teammates
            </label>
          )}
        </fieldset>
        {who === "some" && (
          <div className="stack" style={{ gap: "0.3rem", maxHeight: 180, overflowY: "auto" }}>
            {!others.length && <p className="tiny muted">Nobody else is on this project yet.</p>}
            {others.map((p) => (
              <label key={p.key} className="check-line">
                <input type="checkbox" checked={picked.includes(p.key)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.key] : picked.filter((k) => k !== p.key))} />
                {p.name}
              </label>
            ))}
          </div>
        )}
        {problem && <p className="tiny cv-problem">{problem}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || (who === "some" && !picked.length)}>
          Make channel
        </button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

const timeOf = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

function Files({ backend, post }: { backend: CommsBackend; post: Post }) {
  if (!post.attachments.length) return null;
  return (
    <div className="cv-files">
      {post.attachments.map((a: Attachment) =>
        /^image\/(png|jpe?g|gif|webp)$/.test(a.contentType) ? (
          <a key={a.id} href={backend.fileUrl(post, a, true)} target="_blank" rel="noreferrer" className="cv-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={backend.fileUrl(post, a, true)} alt={a.name} loading="lazy" />
          </a>
        ) : (
          <a key={a.id} href={backend.fileUrl(post, a)} download={a.name} className="cv-file">
            <Paperclip size={14} />
            <span className="truncate">{a.name}</span>
            <span className="tiny muted">{fileSize(a.sizeBytes)}</span>
          </a>
        ),
      )}
    </div>
  );
}

function Reactions({ post, me, onReact }: { post: Post; me: string; onReact: (emoji: string, on: boolean) => void }) {
  if (!post.reactions.length) return null;
  return (
    <div className="cv-reactions">
      {post.reactions.map((r) => {
        const mine = r.people.some((p) => p.key === me);
        const who = r.people.map((p) => (p.key === me ? "You" : p.name)).join(", ");
        return (
          <button key={r.emoji} type="button" className="cv-reaction" aria-pressed={mine} title={who} aria-label={`${r.emoji} ${r.people.length}: ${who}`} onClick={() => onReact(r.emoji, !mine)}>
            <span aria-hidden>{r.emoji}</span> {r.people.length}
          </button>
        );
      })}
    </div>
  );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="cv-picker-wrap">
      <button type="button" className="cv-link" aria-label="Add a reaction" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SmilePlus size={14} />
      </button>
      {open && (
        <span className="cv-picker" role="menu" onMouseLeave={() => setOpen(false)}>
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(e);
              }}
            >
              {e}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function PostCard({
  post,
  backend,
  me,
  canManage,
  active,
  onReplies,
  onChanged,
  meetingHref,
  people = [],
  inThread = false,
}: {
  post: Post;
  backend: CommsBackend;
  me: string;
  canManage: boolean;
  active?: boolean;
  onReplies?: () => void;
  onChanged: () => void;
  meetingHref: (id: string) => string;
  people?: { key: string; name: string }[];
  inThread?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(post.body);
  const [problem, setProblem] = useState("");
  const mine = post.authorKey === me && post.authorKind !== "system" && post.authorKind !== "assistant";
  const system = post.authorKind === "system";
  const meetingRoot = !!post.meetingId && !post.parentId;
  // Shown at once; the server's copy replaces it on the next refresh.
  const [shown, setShown] = useState(post.reactions);
  const [seen, setSeen] = useState(post);
  if (seen !== post) {
    setSeen(post);
    setShown(post.reactions);
  }
  const react = async (emoji: string, on: boolean) => {
    const before = shown;
    const others = (r: { people: { key: string; name: string }[] }) => r.people.filter((p) => p.key !== me);
    const next = shown.map((r) => (r.emoji === emoji ? { ...r, people: [...others(r), ...(on ? [{ key: me, name: "You" }] : [])] } : r));
    if (on && !next.some((r) => r.emoji === emoji)) next.push({ emoji, people: [{ key: me, name: "You" }] });
    setShown(next.filter((r) => r.people.length));
    try {
      await backend.react(post.id, emoji as (typeof REACTIONS)[number], on);
      onChanged();
    } catch (err) {
      setShown(before);
      setProblem(err instanceof Error ? err.message : "That reaction did not save");
    }
  };
  const view = { ...post, reactions: shown };
  return (
    <article className="cv-post" data-kind={post.authorKind} data-active={active ? "true" : undefined}>
      <span className="cv-avatar" aria-hidden data-kind={post.authorKind}>
        {post.authorKind === "assistant" ? <Bot size={16} /> : meetingRoot ? <Video size={16} /> : initials(post.authorName)}
      </span>
      <div className="cv-post-body">
        <div className="cv-post-meta">
          <strong>{meetingRoot ? "Meeting" : post.authorName}</strong>
          {post.authorKind === "client" && backend.audience === "team" && <span className="cv-tag">Client</span>}
          <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
            {timeOf(post.createdAt)}
          </time>
          {post.editedAt && <span className="tiny muted">edited</span>}
        </div>
        {editing ? (
          <form
            className="stack"
            style={{ gap: "0.4rem" }}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await backend.editPost(post.id, text);
                setEditing(false);
                onChanged();
              } catch (err) {
                setProblem(err instanceof Error ? err.message : "Not saved");
              }
            }}
          >
            <textarea className="input cv-textarea" value={text} maxLength={5000} onChange={(e) => setText(e.target.value)} rows={3} />
            <div className="row" style={{ gap: "0.4rem" }}>
              <button type="submit" className="btn btn-primary btn-sm">Save</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className={system ? "cv-text cv-system" : "cv-text"}>
            <RichText text={post.body} people={people} />
          </div>
        )}
        {meetingRoot && (
          <Link href={meetingHref(post.meetingId!)} className="btn btn-secondary btn-sm cv-meeting-link">
            <CalendarClock size={15} /> Open meeting
          </Link>
        )}
        <Files backend={backend} post={post} />
        {problem && <p className="tiny cv-problem">{problem}</p>}
        <Reactions post={view} me={me} onReact={react} />
        <div className="cv-post-actions">
          {!inThread && onReplies && (
            <button type="button" className="cv-link" onClick={onReplies}>
              <MessageSquare size={14} />
              {post.replyCount ? `${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}${post.lastReplyAt ? ` · ${relativeTime(post.lastReplyAt)}` : ""}` : "Reply"}
            </button>
          )}
          {!system && <ReactionPicker onPick={(emoji) => void react(emoji, !shown.some((r) => r.emoji === emoji && r.people.some((p) => p.key === me)))} />}
          {mine && !editing && (
            <button type="button" className="cv-link" aria-label="Edit post" onClick={() => setEditing(true)}>
              <Pencil size={13} />
            </button>
          )}
          {(mine || (canManage && backend.audience === "team")) && !system && (
            <button
              type="button"
              className="cv-link"
              aria-label="Delete post"
              onClick={async () => {
                if (!window.confirm(post.parentId ? "Delete this reply?" : "Delete this post and its replies?")) return;
                try {
                  await backend.deletePost(post.id);
                  onChanged();
                } catch (err) {
                  setProblem(err instanceof Error ? err.message : "Not deleted");
                }
              }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function ThreadView({
  backend,
  list,
  postId,
  onClose,
  meetingHref,
}: {
  backend: CommsBackend;
  list: ChannelList;
  postId: string;
  /** Left out where the thread is the whole panel, such as a meeting's chat. */
  onClose?: () => void;
  meetingHref: (id: string) => string;
}) {
  const thread = usePolling(() => backend.thread(postId), 4_000, [backend, postId]);
  const [waitingSince, setWaitingSince] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const replies = thread.data?.replies ?? [];
  const lastId = replies[replies.length - 1]?.id;
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lastId]);
  // The assistant was asked when the thread opened from a new post that mentions it.
  const [openedAt] = useState(() => Date.now());
  const root = thread.data?.post;
  const asked = waitingSince ?? (root && root.mentions.includes(ASSISTANT_KEY) && !replies.some((r) => r.authorKind === "assistant") && openedAt - Date.parse(root.createdAt) < 5 * 60_000 ? root.createdAt : null);
  const answered = asked && replies.some((r) => r.authorKind === "assistant" && r.createdAt > asked);
  return (
    <div className="cv-thread">
      {onClose && (
        <header className="cv-head">
          <button type="button" className="icon-btn" aria-label="Close thread" onClick={onClose}>
            <ArrowLeft size={18} className="cv-back-icon" />
            <X size={18} className="cv-close-icon" />
          </button>
          <h2 className="cv-title">Thread</h2>
        </header>
      )}
      <div className="cv-log">
        {!thread.data && !thread.error && <p className="tiny muted">Loading…</p>}
        {thread.error && !thread.data && <p className="tiny cv-problem">{thread.error}</p>}
        {thread.data && (
          <>
            <PostCard post={thread.data.post} backend={backend} me={list.me.key} canManage={list.canManage} meetingHref={meetingHref} people={list.people} inThread onChanged={() => void thread.refresh()} />
            <div className="cv-divider tiny muted">{replies.length ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "No replies yet"}</div>
            {replies.map((r) => (
              <PostCard key={r.id} post={r} backend={backend} me={list.me.key} canManage={list.canManage} meetingHref={meetingHref} people={list.people} inThread onChanged={() => void thread.refresh()} />
            ))}
            {asked && !answered && (
              <p className="cv-working small">
                <Bot size={15} /> The assistant is working on it…
              </p>
            )}
          </>
        )}
        <div ref={end} />
      </div>
      <Composer
        backend={backend}
        people={list.people}
        placeholder="Reply"
        key={`thread:${postId}`}
        draftKey={`thread:${postId}`}
        onSend={async (body, files) => {
          const sent = await backend.post(thread.data?.post.channelId ?? "", { body, files, parentId: postId });
          if (sent.assistantAnswering) setWaitingSince(sent.post.createdAt);
          await thread.refresh();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Writing a post
// ---------------------------------------------------------------------------

const DRAFTS = "fundur.comms.draft.";
function readDraft(key?: string): string {
  if (!key) return "";
  try {
    return localStorage.getItem(DRAFTS + key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key: string | undefined, value: string) {
  if (!key) return;
  try {
    if (value.trim()) localStorage.setItem(DRAFTS + key, value.slice(0, 5000));
    else localStorage.removeItem(DRAFTS + key);
  } catch {
    /* A full or blocked store only loses the draft. */
  }
}

export function Composer({
  backend,
  people,
  placeholder,
  onSend,
  draftKey,
}: {
  backend: CommsBackend;
  people: { key: string; name: string }[];
  placeholder: string;
  onSend: (body: string, files: File[]) => Promise<void>;
  /** Where an unsent message is kept in this browser, so switching channel or thread does not lose it. */
  draftKey?: string;
}) {
  const [text, setTextState] = useState(() => readDraft(draftKey));
  const setText = useCallback(
    (value: string) => {
      setTextState(value);
      writeDraft(draftKey, value);
    },
    [draftKey],
  );
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const canAttach = backend.audience === "team";
  const addFiles = (list: File[]) => {
    if (!canAttach || !list.length) return;
    setFiles((old) => [...old, ...list].slice(0, 10));
  };
  const matches = query === null ? [] : people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const fit = () => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  const watchMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setQuery(m ? m[2] : null);
    setHighlight(0);
  };
  const insert = useCallback(
    (name: string) => {
      const el = area.current;
      const caret = el?.selectionStart ?? text.length;
      const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${name} `);
      const next = before + text.slice(caret);
      setText(next);
      setQuery(null);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(before.length, before.length);
        fit();
      });
    },
    [text, setText],
  );
  const send = async () => {
    if (busy || (!text.trim() && !files.length)) return;
    setBusy(true);
    setProblem("");
    try {
      await onSend(text.trim(), files);
      setText("");
      setFiles([]);
      requestAnimationFrame(fit);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Not sent. Please retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="cv-composer"
      data-drag={dragging ? "true" : undefined}
      onDragOver={(e) => {
        if (!canAttach || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!canAttach) return;
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {matches.length > 0 && (
        <ul className="cv-mentions" role="listbox" aria-label="Mention someone">
          {matches.map((p, i) => (
            <li key={p.key}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(p.name);
                }}
              >
                {p.key === ASSISTANT_KEY ? <Bot size={14} /> : <AtSign size={14} />} {p.name}
                {p.key === ASSISTANT_KEY && <span className="tiny muted">answers here and does the work</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <div className="cv-pending">
          {files.map((f, i) => (
            <span key={i} className="chip">
              <Paperclip size={13} /> <span className="truncate" style={{ maxWidth: 160 }}>{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}
      {problem && <p className="tiny cv-problem">{problem}</p>}
      <div className="cv-compose-row">
        {canAttach && (
          <>
            <button type="button" className="icon-btn" aria-label="Add files" onClick={() => picker.current?.click()}>
              <Paperclip size={18} />
            </button>
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </>
        )}
        <textarea
          ref={area}
          className="input cv-textarea"
          rows={1}
          value={text}
          maxLength={5000}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            watchMention(e.target.value, e.target.selectionStart);
            fit();
          }}
          onKeyDown={(e) => {
            if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setHighlight((h) => (h + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            } else if (matches.length && (e.key === "Enter" || e.key === "Tab")) {
              e.preventDefault();
              insert(matches[highlight].name);
            } else if (e.key === "Escape") setQuery(null);
            else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          onPaste={(e) => {
            // A pasted screenshot or copied file is attached, like in Slack and Teams.
            const pasted = Array.from(e.clipboardData.files);
            if (!canAttach || !pasted.length) return;
            e.preventDefault();
            addFiles(pasted.map((f, i) => (f.name === "image.png" ? new File([f], `Pasted image ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "h")}${i ? `-${i + 1}` : ""}.png`, { type: f.type }) : f)));
          }}
        />
        <button type="submit" className="btn btn-primary cv-send" aria-label="Send" disabled={busy || (!text.trim() && !files.length)}>
          <Send size={16} />
        </button>
      </div>
    </form>
  );
}
