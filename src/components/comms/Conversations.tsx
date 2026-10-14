"use client";
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlarmClock, Bookmark, BookmarkCheck, Clock, Forward, Languages, MailOpen, Sparkles, ArrowLeft, AtSign, Bell, BellOff, Bot, Check, FileText, Link2, ListChecks, Mic, Square, Vote, CalendarClock, Hash, Lock, MessageSquare, Paperclip, Pencil, Plus, Send, Pin, PinOff, Search, Settings2, SmilePlus, Trash2, Users, Video, X } from "lucide-react";
import { initials } from "@/components/ui/primitives";
import { fileSize, relativeTime } from "@/lib/studio/format";
import { isString } from "@/lib/view-settings/client";
import type { ChannelList, CommsBackend, SavedPost } from "@/lib/comms/client";
import { APPROVAL_OPTIONS, ASSISTANT_KEY, REACTIONS, firstWebLink, type LinkPreview, type Ask, type Attachment, type Channel, type ChannelPresence, type Post } from "@/lib/comms/types";
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
/** Something in the project a post can link to: a task or a document. */
export interface Linkable {
  kind: "task" | "document";
  label: string;
  href: string;
  hint?: string;
}
const LinkablesContext = createContext<(() => Linkable[]) | undefined>(undefined);
/** Opens the assistant with a request, where the project has it. */
const AskContext = createContext<((prompt: string) => void) | undefined>(undefined);
/** The posts this person saved (with when to remind them), and saving or unsaving one. */
interface Saved {
  remindAt: Map<string, string | null>;
  set: (postId: string, on: boolean, remindAt?: string | null) => Promise<void>;
}
const SavedContext = createContext<Saved | undefined>(undefined);
/** The channels a post can be forwarded to, for the studio. */
const ChannelsContext = createContext<Channel[] | undefined>(undefined);

/** Ready-made times for "remind me" and "send later", as Slack offers them. */
function laterTimes(hour: number): { label: string; at: string }[] {
  const at = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const monday = at(((8 - new Date().getDay()) % 7) || 7);
  const clock = `${hour}:00`;
  return [
    { label: "In 1 hour", at: new Date(Date.now() + 3_600_000).toISOString() },
    { label: `Tomorrow at ${clock}`, at: at(1).toISOString() },
    ...(monday.getTime() - at(1).getTime() > 86_400_000 ? [{ label: `Monday at ${clock}`, at: monday.toISOString() }] : []),
  ];
}

/** A small menu of times, with one of the person's own choosing. */
function WhenMenu({ label, hour, extra, onPick, onClose }: { label: string; hour: number; extra?: { label: string; onClick: () => void }; onPick: (at: string) => void; onClose: () => void }) {
  const [own, setOwn] = useState("");
  return (
    <div className="cv-when" role="menu" aria-label={label} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <p className="tiny muted">{label}</p>
      {extra && (
        <button type="button" role="menuitem" onClick={extra.onClick}>
          {extra.label}
        </button>
      )}
      {laterTimes(hour).map((t) => (
        <button key={t.label} type="button" role="menuitem" onClick={() => onPick(t.at)}>
          {t.label}
        </button>
      ))}
      <div className="row" style={{ gap: "0.3rem" }}>
        <input type="datetime-local" className="input" aria-label="Pick a date and time" value={own} onChange={(e) => setOwn(e.target.value)} />
        <button type="button" className="btn btn-secondary btn-sm" disabled={!own || Number.isNaN(Date.parse(own))} onClick={() => onPick(new Date(own).toISOString())}>
          Set
        </button>
      </div>
    </div>
  );
}

const whenOf = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Conversations({
  backend,
  meetingHref,
  initialChannel,
  initialPost,
  linkables,
  askAssistant,
}: {
  backend: CommsBackend;
  /** Where a meeting's page is, for its card in a post. */
  meetingHref: (meetingId: string) => string;
  initialChannel?: string | null;
  initialPost?: string | null;
  /** The project's tasks and documents, for the studio to link into a post. */
  linkables?: () => Linkable[];
  /** Opens the assistant with a request ("catch me up"), for the studio. */
  askAssistant?: (prompt: string) => void;
}) {
  const team = backend.audience === "team";
  return (
    <LinkablesContext.Provider value={team ? linkables : undefined}>
      <AskContext.Provider value={team ? askAssistant : undefined}>
        <ConversationsArea backend={backend} meetingHref={meetingHref} initialChannel={initialChannel} initialPost={initialPost} />
      </AskContext.Provider>
    </LinkablesContext.Provider>
  );
}

function ConversationsArea({
  backend,
  meetingHref,
  initialChannel,
  initialPost,
}: {
  backend: CommsBackend;
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
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [dmProblem, setDmProblem] = useState("");
  // A list in place of the channel: what this person saved, or the threads they are in.
  const [panel, setPanel] = useState<"saved" | "threads" | null>(null);
  const showSaved = panel === "saved";
  const saved = usePolling(team ? () => backend.saved() : null, 30_000, [backend, team]);
  const savedCtx = useMemo<Saved | undefined>(
    () =>
      team
        ? {
            remindAt: new Map((saved.data ?? []).map((p) => [p.id, p.remindAt])),
            set: async (postId, on, remindAt) => {
              await backend.save(postId, on, remindAt);
              await saved.refresh();
            },
          }
        : undefined,
    [team, saved, backend],
  );
  const channels = list.data?.channels ?? [];
  const current = channels.find((c) => c.id === channelId) ?? channels.find((c) => c.id === remembered) ?? channels[0];

  const open = (id: string) => {
    setPanel(null);
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
    <SavedContext.Provider value={savedCtx}>
    <ChannelsContext.Provider value={team ? channels : undefined}>
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
        <label className="cv-search">
          <Search size={15} aria-hidden />
          <input type="search" value={query} placeholder="Search messages" aria-label="Search messages" onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length > 1) {
              setPanel(null);
              setPane("channel");
            }
          }} />
        </label>
        {list.error && !list.data && <p className="tiny cv-problem">{list.error}</p>}
        {!list.data && !list.error && <p className="tiny muted" style={{ padding: "0.5rem 0.75rem" }}>Loading…</p>}
        <nav className="cv-channel-list">
          {channels.filter((c) => !c.direct).map((c) => (
            <button
              key={c.id}
              type="button"
              className="cv-channel"
              data-muted={c.muted ? "true" : undefined}
              data-unread={c.unread > 0 && current?.id !== c.id ? "true" : undefined}
              aria-current={current?.id === c.id ? "true" : undefined}
              onClick={() => open(c.id)}
            >
              <ChannelIcon channel={c} />
              <span className="cv-channel-name">{c.name}</span>
              {c.visibility === "client" && team && <span className="cv-tag">Client</span>}
              {c.muted && <BellOff size={13} aria-label="Muted" className="muted" />}
              {c.unread > 0 && current?.id !== c.id && !c.muted && <span className="nav-badge">{c.unread > 99 ? "99+" : c.unread}</span>}
            </button>
          ))}
        </nav>
        {team && list.data && (
          <>
            <div className="cv-channels-head">
              <span className="eyebrow">Direct messages</span>
              <button type="button" className="icon-btn" aria-label="Message someone" aria-expanded={picking} onClick={() => (setPicking(!picking), setDmProblem(""))}>
                <Plus size={17} />
              </button>
            </div>
            {picking && (
              <ul className="cv-dm-pick" aria-label="Message someone">
                {list.data.people
                  .filter((p) => p.key !== list.data!.me.key && p.key !== ASSISTANT_KEY)
                  .map((p) => (
                    <li key={p.key}>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const c = await backend.openDirect(p.key);
                            setPicking(false);
                            await list.refresh();
                            open(c.id);
                          } catch (e) {
                            setDmProblem(e instanceof Error ? e.message : "That didn't work. Please retry.");
                          }
                        }}
                      >
                        <span className="avatar cv-dm-avatar">{initials(p.name)}</span> {p.name}
                      </button>
                    </li>
                  ))}
                {list.data.people.filter((p) => p.key !== list.data!.me.key && p.key !== ASSISTANT_KEY).length === 0 && (
                  <li className="tiny muted" style={{ padding: "0.3rem 0.75rem" }}>Nobody else is on this project yet. Add people under Project settings, Team access.</li>
                )}
              </ul>
            )}
            {dmProblem && <p className="tiny cv-problem">{dmProblem}</p>}
            <nav className="cv-channel-list">
              {channels.filter((c) => c.direct).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="cv-channel"
                  data-muted={c.muted ? "true" : undefined}
                  data-unread={c.unread > 0 && current?.id !== c.id ? "true" : undefined}
                  aria-current={current?.id === c.id ? "true" : undefined}
                  onClick={() => open(c.id)}
                >
                  <ChannelIcon channel={c} />
                  <span className="cv-channel-name">{c.name}</span>
                  {c.unread > 0 && current?.id !== c.id && !c.muted && <span className="nav-badge">{c.unread > 99 ? "99+" : c.unread}</span>}
                </button>
              ))}
            </nav>
          </>
        )}
        {list.data && !channels.length && <p className="small muted" style={{ padding: "0.75rem" }}>Nothing has been shared with you here yet.</p>}
        {list.data && (
          <nav className="cv-channel-list cv-saved-link">
            <button type="button" className="cv-channel" aria-current={panel === "threads" ? "true" : undefined} onClick={() => (setPanel("threads"), setQuery(""), setPane("channel"))}>
              <MessageSquare size={15} />
              <span className="cv-channel-name">Threads</span>
            </button>
            {team && (
            <button type="button" className="cv-channel" aria-current={showSaved ? "true" : undefined} onClick={() => (setPanel("saved"), setQuery(""), setPane("channel"))}>
              <Bookmark size={15} />
              <span className="cv-channel-name">Saved for later</span>
              {(saved.data?.length ?? 0) > 0 && <span className="tiny muted">{saved.data!.length}</span>}
            </button>
            )}
          </nav>
        )}
      </aside>

      <section className="cv-channel-pane" aria-label={current ? `#${current.name}` : "Channel"}>
        {showSaved && list.data ? (
          <SavedList
            items={saved.data}
            problem={saved.error}
            list={list.data}
            onClose={() => (setPanel(null), setPane("list"))}
            onRemove={(id) => void savedCtx?.set(id, false)}
            onOpen={(post) => {
              open(post.channelId);
              openThread(post.parentId ?? post.id);
            }}
          />
        ) : panel === "threads" && list.data ? (
          <ThreadsList
            backend={backend}
            list={list.data}
            onClose={() => (setPanel(null), setPane("list"))}
            onOpen={(post) => {
              setPanel("threads");
              openThread(post.id);
            }}
          />
        ) : query.trim().length > 1 && list.data ? (
          <SearchResults
            backend={backend}
            list={list.data}
            query={query}
            onClose={() => {
              setQuery("");
              setPane("list");
            }}
            onOpen={(post) => {
              setQuery("");
              open(post.channelId);
              openThread(post.parentId ?? post.id);
            }}
          />
        ) : current && list.data ? (
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
    </ChannelsContext.Provider>
    </SavedContext.Provider>
  );
}

/** Every thread this person is in, newest reply first, as Slack's Threads. */
function ThreadsList({ backend, list, onOpen, onClose }: { backend: CommsBackend; list: ChannelList; onOpen: (post: Post) => void; onClose: () => void }) {
  const threads = usePolling(() => backend.threads(), 15_000, [backend]);
  return (
    <>
      <header className="cv-head">
        <button type="button" className="icon-btn" aria-label="Close threads" onClick={onClose}>
          <ArrowLeft size={18} />
        </button>
        <h2 className="cv-title grow">
          <MessageSquare size={16} /> Threads
        </h2>
      </header>
      <div className="cv-log">
        {threads.error && !threads.data && <p className="tiny cv-problem">{threads.error}</p>}
        {!threads.data && !threads.error && <p className="tiny muted">Loading…</p>}
        {threads.data && !threads.data.length && <p className="small muted">No threads yet. Threads you start, reply in or follow show here, newest reply first.</p>}
        {threads.data?.map((p) => (
          <button key={p.id} type="button" className="cv-result" data-unread={p.unread ? "true" : undefined} onClick={() => onOpen(p)}>
            <span className="tiny muted">
              {p.channelName.startsWith("#") ? p.channelName : `#${p.channelName}`} · {p.authorName}
            </span>
            <span className="cv-text">
              <RichText text={p.body.length > 240 ? `${p.body.slice(0, 240)}…` : p.body} people={list.people} />
            </span>
            <span className="tiny">
              {p.unread && <strong className="cv-new-dot">New replies · </strong>}
              {p.replyCount} {p.replyCount === 1 ? "reply" : "replies"}
              {p.lastReplyAt ? `, last ${relativeTime(p.lastReplyAt)}` : ""}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

/** What this person saved for later, each with its reminder, as Slack's "Later". */
function SavedList({
  items,
  problem,
  list,
  onOpen,
  onRemove,
  onClose,
}: {
  items: SavedPost[] | null;
  problem: string;
  list: ChannelList;
  onOpen: (post: Post) => void;
  onRemove: (postId: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <header className="cv-head">
        <button type="button" className="icon-btn" aria-label="Close saved" onClick={onClose}>
          <ArrowLeft size={18} />
        </button>
        <h2 className="cv-title grow">
          <Bookmark size={16} /> Saved for later
        </h2>
      </header>
      <div className="cv-log">
        {problem && !items && <p className="tiny cv-problem">{problem}</p>}
        {!items && !problem && <p className="tiny muted">Loading…</p>}
        {items && !items.length && <p className="small muted">Nothing saved yet. Use the bookmark on a post to keep it here, with a reminder if you like.</p>}
        {items?.map((p) => (
          <div key={p.id} className="cv-saved-row">
            <button type="button" className="cv-result grow" onClick={() => onOpen(p)}>
              <span className="tiny muted">
                #{p.channelName} · {p.authorName} · {timeOf(p.createdAt)}
                {p.parentId ? " · in a thread" : ""}
              </span>
              <span className="cv-text">
                <RichText text={p.body.length > 300 ? `${p.body.slice(0, 300)}…` : p.body} people={list.people} />
              </span>
              {p.remindAt && (
                <span className="tiny cv-remind">
                  <AlarmClock size={12} /> Reminder {whenOf(p.remindAt)}
                </span>
              )}
            </button>
            <button type="button" className="icon-btn" aria-label="Take off the saved list" onClick={() => onRemove(p.id)}>
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function SearchResults({
  backend,
  list,
  query,
  onOpen,
  onClose,
}: {
  backend: CommsBackend;
  list: ChannelList;
  query: string;
  onOpen: (post: Post) => void;
  onClose: () => void;
}) {
  const [results, setResults] = useState<(Post & { channelName: string })[] | null>(null);
  const [problem, setProblem] = useState("");
  const [from, setFrom] = useState("");
  const [inChannel, setInChannel] = useState("");
  const [files, setFiles] = useState(false);
  useEffect(() => {
    let live = true;
    // Waits for a pause in typing before asking.
    const t = setTimeout(() => {
      backend.search(query, { from: from || undefined, channelId: inChannel || undefined, files }).then(
        (r) => live && (setResults(r), setProblem("")),
        (e: Error) => live && setProblem(e.message),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [backend, query, from, inChannel, files]);
  return (
    <>
      <header className="cv-head">
        <button type="button" className="icon-btn" aria-label="Close search" onClick={onClose}>
          <ArrowLeft size={18} />
        </button>
        <h2 className="cv-title grow">Results for &ldquo;{query.trim()}&rdquo;</h2>
      </header>
      <div className="cv-filters row wrap" role="group" aria-label="Search filters">
        <select className="input" value={from} aria-label="From" onChange={(e) => setFrom(e.target.value)}>
          <option value="">From anyone</option>
          {list.people.map((p) => (
            <option key={p.key} value={p.key}>
              From {p.name}
            </option>
          ))}
        </select>
        <select className="input" value={inChannel} aria-label="In" onChange={(e) => setInChannel(e.target.value)}>
          <option value="">In every channel</option>
          {list.channels.map((c) => (
            <option key={c.id} value={c.id}>
              In {c.direct ? c.name : `#${c.name}`}
            </option>
          ))}
        </select>
        <label className="chip">
          <input type="checkbox" checked={files} onChange={(e) => setFiles(e.target.checked)} /> With files
        </label>
      </div>
      <div className="cv-log">
        {problem && <p className="tiny cv-problem">{problem}</p>}
        {!results && !problem && <p className="tiny muted">Searching…</p>}
        {results && !results.length && <p className="small muted">Nothing found. Try fewer or other words.</p>}
        {results?.map((p) => (
          <button key={p.id} type="button" className="cv-result" onClick={() => onOpen(p)}>
            <span className="tiny muted">
              #{p.channelName} · {p.authorName} · {timeOf(p.createdAt)}
              {p.parentId ? " · in a thread" : ""}
            </span>
            <span className="cv-text">
              <RichText text={p.body.length > 400 ? `${p.body.slice(0, 400)}…` : p.body} people={list.people} />
            </span>
            {p.attachments.length > 0 && (
              <span className="tiny muted">
                <Paperclip size={12} /> {p.attachments.map((a) => a.name).join(", ")}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel.direct)
    return (
      <span className="avatar cv-dm-avatar" aria-label="Direct message">
        {initials(channel.name)}
      </span>
    );
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
  // After "Mark unread" the channel is looked at without counting as read, until this person writes or leaves.
  const [peek, setPeek] = useState(false);
  const posts = usePolling(() => backend.posts(channel.id, undefined, peek), 4_000, [backend, channel.id]);
  const [older, setOlder] = useState<Post[]>([]);
  const [showPins, setShowPins] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const pinned = posts.data?.pinned ?? [];
  const [noMore, setNoMore] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const shown = useMemo(() => {
    const latest = posts.data?.posts ?? [];
    const seen = new Set(latest.map((p) => p.id));
    return [...older.filter((p) => !seen.has(p.id)), ...latest];
  }, [older, posts.data]);
  const lastId = shown[shown.length - 1]?.id;
  // Where this person had read up to when they opened the channel: posts after it get a "New" line.
  const [readBefore, setReadBefore] = useState<string | null | undefined>(undefined);
  if (readBefore === undefined && posts.data) setReadBefore(posts.data.readBefore ?? null);
  const firstNew = readBefore ? shown.find((p) => p.createdAt > readBefore && p.authorKey !== list.me.key)?.id : undefined;
  const unreadCount = readBefore ? shown.filter((p) => p.createdAt > readBefore && p.authorKey !== list.me.key).reduce((n, p) => n + 1 + p.replyCount, 0) : 0;
  const ask = useContext(AskContext);
  const router = useRouter();
  const [calling, setCalling] = useState(false);
  const callNow = async () => {
    setCalling(true);
    try {
      const m = await backend.createMeeting({ title: `Call with ${channel.name}`.slice(0, 200), startsAt: new Date().toISOString(), durationMin: 30, channelId: channel.id });
      router.push(`${meetingHref(m.id)}?join=1`);
    } catch {
      setCalling(false);
    }
  };
  const jumped = useRef(false);
  const later = usePolling(backend.audience === "team" ? () => backend.scheduled(channel.id) : null, 30_000, [backend, channel.id]);

  useEffect(() => {
    const el = log.current;
    if (!el) return;
    // Opening a channel with new posts starts at the first of them, as Slack and Teams do.
    const mark = firstNew && !jumped.current ? el.querySelector<HTMLElement>(".cv-new") : null;
    if (mark) {
      jumped.current = true;
      el.scrollTop += mark.getBoundingClientRect().top - el.getBoundingClientRect().top - 24;
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    } else if (atBottom.current) el.scrollTop = el.scrollHeight;
  }, [lastId, firstNew]);

  const loadOlder = async () => {
    const first = shown[0];
    if (!first) return;
    const { posts: more } = await backend.posts(channel.id, first.createdAt);
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
        {channel.direct && backend.audience === "team" && (
          <button type="button" className="icon-btn" aria-label={`Call ${channel.name}`} disabled={calling} onClick={() => void callNow()}>
            <Video size={17} />
          </button>
        )}
        <button type="button" className="icon-btn" aria-label="Files shared here" aria-expanded={showFiles} onClick={() => setShowFiles(!showFiles)}>
          <Paperclip size={17} />
        </button>
        {pinned.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showPins} onClick={() => setShowPins(!showPins)}>
            <Pin size={14} /> {pinned.length}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={channel.muted ? "Unmute channel" : "Mute channel"}
          title={channel.muted ? "Muted: you only hear when someone names you. Unmute" : "Mute: only hear when someone names you"}
          aria-pressed={channel.muted}
          onClick={async () => {
            await backend.mine(channel.id, { muted: !channel.muted }).catch(() => undefined);
            onChanged();
          }}
        >
          {channel.muted ? <BellOff size={17} /> : <Bell size={17} />}
        </button>
        {backend.audience === "team" && !channel.direct && (
          <button type="button" className="icon-btn" aria-label="Channel settings" aria-expanded={editing} onClick={onEdit}>
            <Settings2 size={17} />
          </button>
        )}
      </header>
      {editing && <ChannelSettings backend={backend} channel={channel} onDone={onChanged} />}
      {showFiles && <ChannelFiles backend={backend} channelId={channel.id} onOpen={(p) => (setShowFiles(false), onThread(p.parentId ?? p.id))} />}
      {showPins && pinned.length > 0 && (
        <div className="cv-pins" aria-label="Pinned posts">
          {pinned.map((p) => (
            <button
              key={p.id}
              type="button"
              className="cv-result"
              onClick={() => {
                setShowPins(false);
                onThread(p.parentId ?? p.id);
              }}
            >
              <span className="tiny muted">
                <Pin size={11} /> {p.authorName} · {timeOf(p.createdAt)}
              </span>
              <span className="small truncate">{p.body || p.attachments.map((a) => a.name).join(", ")}</span>
            </button>
          ))}
        </div>
      )}
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
          <Fragment key={p.id}>
          {p.id === firstNew && (
            <div className="cv-new" role="separator" aria-label="New messages">
              <span>New</span>
              {ask && unreadCount > 2 && (
                <button
                  type="button"
                  className="cv-catch-up"
                  onClick={() =>
                    ask(
                      `Catch me up on ${channel.direct ? `my conversation with ${channel.name}` : `#${channel.name}`} in this project: read what was said since ${new Date(readBefore!).toLocaleString()} (read_conversations, and the threads that matter) and sum it up in a few lines: decisions made, questions waiting on me, and what changed. Do not post anything.`,
                    )
                  }
                >
                  <Bot size={13} /> Catch me up
                </button>
              )}
            </div>
          )}
          <PostCard
            post={p}
            backend={backend}
            me={list.me.key}
            canManage={list.canManage}
            active={openThreadId === p.id}
            meetingHref={meetingHref}
            people={list.people}
            onReplies={() => onThread(p.id)}
            onChanged={() => void posts.refresh()}
            onMarkUnread={
              backend.mode === "server" && p.authorKey !== list.me.key
                ? async () => {
                    setPeek(true);
                    await backend.mine(channel.id, { unreadFrom: p.id });
                    setReadBefore(new Date(Date.parse(p.createdAt) - 1).toISOString());
                    onChanged();
                  }
                : undefined
            }
          />
          </Fragment>
        ))}
        <SeenBy presence={posts.data?.presence} last={shown[shown.length - 1]} />
      </div>
      {posts.error && <p className="tiny cv-problem">{posts.error}</p>}
      <Typing presence={posts.data?.presence} />
      {(later.data?.length ?? 0) > 0 && (
        <div className="cv-later" aria-label="Waiting to send">
          {later.data!.map((x) => (
            <div key={x.id} className="cv-later-row">
              <Clock size={13} aria-hidden />
              <span className="tiny grow truncate">
                <strong>Sends {whenOf(x.sendAt)}</strong>
                {x.parentId ? " as a reply" : ""}: {x.body || x.files.join(", ")}
              </span>
              <button
                type="button"
                className="cv-link tiny"
                onClick={async () => {
                  await backend.unschedule(x.id, true).catch(() => undefined);
                  await Promise.all([later.refresh(), posts.refresh()]);
                }}
              >
                Send now
              </button>
              <button
                type="button"
                className="cv-link tiny"
                onClick={async () => {
                  await backend.unschedule(x.id, false).catch(() => undefined);
                  await later.refresh();
                }}
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}
      <Composer
        backend={backend}
        people={list.people}
        placeholder={channel.direct ? `Message ${channel.name}` : `Post in #${channel.name}`}
        key={`channel:${channel.id}`}
        draftKey={`channel:${channel.id}`}
        onTyping={backend.mode === "server" ? () => void backend.mine(channel.id, { typing: true }).catch(() => undefined) : undefined}
        onSend={async (body, files, ask) => {
          setPeek(false);
          const sent = await backend.post(channel.id, { body, files, ask });
          atBottom.current = true;
          posts.setData((d) => ({ posts: [...(d?.posts ?? []), sent.post], pinned: d?.pinned ?? [], presence: d?.presence ?? { seen: [], typing: [] } }));
          if (sent.assistantAnswering) onThread(sent.post.id);
        }}
        onSchedule={
          backend.audience === "team"
            ? async (body, files, ask, sendAt) => {
                await backend.schedule(channel.id, { body, files, ask, sendAt });
                await later.refresh();
              }
            : undefined
        }
      />
    </>
  );
}

/** Every file shared in a channel, newest first, each with who shared it and a way to its post. */
function ChannelFiles({ backend, channelId, onOpen }: { backend: CommsBackend; channelId: string; onOpen: (post: Post) => void }) {
  const files = usePolling(() => backend.files(channelId), 30_000, [backend, channelId]);
  const rows = (files.data ?? []).flatMap((p) => p.attachments.map((a) => ({ post: p, file: a })));
  return (
    <div className="cv-pins cv-files-panel" aria-label="Files shared here">
      {!files.data && !files.error && <p className="tiny muted">Loading…</p>}
      {files.error && <p className="tiny cv-problem">{files.error}</p>}
      {files.data && !rows.length && <p className="tiny muted">No files have been shared here yet. Add them with the paper clip, or drop them on the message box.</p>}
      {rows.map(({ post, file }) => (
        <div key={`${post.id}:${file.id}`} className="cv-file-row">
          {/^image\//.test(file.contentType) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={backend.fileUrl(post, file, true)} alt="" loading="lazy" />
          ) : /^audio\//.test(file.contentType) ? (
            <Mic size={16} aria-hidden />
          ) : (
            <FileText size={16} aria-hidden />
          )}
          <a href={backend.fileUrl(post, file)} download={file.name} className="grow truncate small">
            {file.name}
          </a>
          <button type="button" className="cv-link tiny" onClick={() => onOpen(post)}>
            {post.authorName} · {timeOf(post.createdAt)}
          </button>
        </div>
      ))}
    </div>
  );
}

const namesOf = (names: string[]) =>
  names.length <= 3 ? names.join(names.length === 2 ? " and " : ", ").replace(/, ([^,]*)$/, " and $1") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;

/** "Seen by …" under the latest post: the people (not its author) who have opened the channel since it was posted. */
function SeenBy({ presence, last }: { presence?: ChannelPresence; last?: Post }) {
  if (!presence || !last) return null;
  const names = presence.seen.filter((p) => p.key !== last.authorKey && p.readAt >= last.createdAt).map((p) => p.name);
  if (!names.length) return null;
  return <p className="tiny muted cv-seen">Seen by {namesOf(names)}</p>;
}

/** Who is writing in the channel right now. The line keeps its height so the posts above do not jump. */
function Typing({ presence }: { presence?: ChannelPresence }) {
  const names = presence?.typing.map((p) => p.name) ?? [];
  return (
    <p className="tiny muted cv-typing" aria-live="polite">
      {names.length ? `${namesOf(names)} ${names.length === 1 ? "is" : "are"} typing…` : ""}
    </p>
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
        /^audio\//.test(a.contentType) ? (
          <div key={a.id} className="cv-voice">
            <audio controls preload="none" src={backend.fileUrl(post, a, true)} aria-label={a.name} />
          </div>
        ) : /^image\/(png|jpe?g|gif|webp)$/.test(a.contentType) ? (
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

/** A decision asked for in a post: everyone who can see it picks one, and sees who picked what. */
function AskCard({ ask, me, onPick }: { ask: Ask; me: string; onPick: (option: number) => Promise<void> }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  const mine = picked ?? ask.answers.find((a) => a.key === me)?.option ?? null;
  return (
    <div className="cv-ask" role="group" aria-label="Choose one">
      {ask.options.map((o, i) => {
        const who = ask.answers.filter((a) => a.option === i && a.key !== me);
        const count = who.length + (mine === i ? 1 : 0);
        return (
          <button
            key={i}
            type="button"
            className="cv-ask-option"
            aria-pressed={mine === i}
            title={[...(mine === i ? ["You"] : []), ...who.map((a) => a.name)].join(", ") || undefined}
            onClick={async () => {
              const before = picked;
              setPicked(i);
              setProblem("");
              try {
                await onPick(i);
              } catch (e) {
                setPicked(before);
                setProblem(e instanceof Error ? e.message : "Your choice did not save. Please retry.");
              }
            }}
          >
            {mine === i && <Check size={14} aria-hidden />}
            <span className="grow">{o}</span>
            {count > 0 && <span className="tiny">{count}</span>}
          </button>
        );
      })}
      {ask.answers.some((a) => a.key !== me) && (
        <p className="tiny muted" style={{ margin: 0 }}>
          {ask.answers
            .filter((a) => a.key !== me)
            .map((a) => `${a.name}: ${ask.options[a.option]}`)
            .join(" · ")}
        </p>
      )}
      {problem && <p className="tiny cv-problem">{problem}</p>}
    </div>
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
  onMarkUnread,
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
  /** Marks the channel unread from this post on. */
  onMarkUnread?: () => Promise<void>;
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
  const saved = useContext(SavedContext);
  const isSaved = !!saved?.remindAt.has(post.id);
  const remindAt = saved?.remindAt.get(post.id) ?? null;
  const [saving, setSaving] = useState(false);
  const channels = useContext(ChannelsContext);
  const [forwarding, setForwarding] = useState(false);
  const [forwarded, setForwarded] = useState("");
  const aiHelp = !!useContext(AskContext) && backend.mode === "server";
  const [tasking, setTasking] = useState(false);
  const canTask = backend.mode === "server" && backend.audience === "team" && !system && !!post.body.trim();
  const [translation, setTranslation] = useState<{ to: string; from: string; text: string } | "busy" | null>(null);
  const translate = async (to: string) => {
    setTranslation("busy");
    try {
      setTranslation({ to, ...(await backend.translate(post.id, to)) });
    } catch (err) {
      setTranslation(null);
      setProblem(err instanceof Error ? err.message : "Not translated. Please retry.");
    }
  };
  const save = async (on: boolean, at?: string | null) => {
    setSaving(false);
    try {
      await saved?.set(post.id, on, at);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Not saved");
    }
  };
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
          {post.pinnedAt && (
            <span className="cv-tag">
              <Pin size={10} /> Pinned
            </span>
          )}
          {isSaved && (
            <span className="cv-tag" title={remindAt ? `Reminder ${whenOf(remindAt)}` : "Saved for later"}>
              {remindAt ? <AlarmClock size={10} /> : <BookmarkCheck size={10} />} {remindAt ? whenOf(remindAt) : "Saved"}
            </span>
          )}
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
        {translation === "busy" && <p className="tiny muted">Translating…</p>}
        {translation && translation !== "busy" && (
          <div className="cv-translation" aria-label="Translation">
            <div className="row wrap tiny muted" style={{ gap: "0.4rem" }}>
              <Languages size={12} /> {translation.from ? `From ${translation.from} into` : "Into"}
              <select className="cv-translation-to" value={translation.to} aria-label="Language" onChange={(e) => void translate(e.target.value)}>
                {TRANSLATE_INTO.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <button type="button" className="cv-link tiny" onClick={() => setTranslation(null)}>
                Hide
              </button>
            </div>
            <div className="cv-text">
              <RichText text={translation.text} people={people} />
            </div>
          </div>
        )}
        <Files backend={backend} post={post} />
        {backend.mode === "server" && !system && firstWebLink(post.body) && <LinkCard backend={backend} post={post} />}
        {post.ask && <AskCard ask={post.ask} me={me} onPick={(i) => backend.answer(post.id, i).then(onChanged)} />}
        {problem && <p className="tiny cv-problem">{problem}</p>}
        <Reactions post={view} me={me} onReact={react} />
        <div className="cv-post-actions">
          {!inThread && onReplies && (
            <button type="button" className="cv-link" onClick={onReplies}>
              <MessageSquare size={14} />
              {post.replyCount ? `${post.replyCount} ${post.replyCount === 1 ? "reply" : "replies"}${post.lastReplyAt ? ` · ${relativeTime(post.lastReplyAt)}` : ""}` : "Reply"}
            </button>
          )}
          {backend.audience === "team" && !system && (
            <button
              type="button"
              className="cv-link"
              aria-label={post.pinnedAt ? "Unpin" : "Pin to the channel"}
              onClick={async () => {
                try {
                  await backend.pin(post.id, !post.pinnedAt);
                  onChanged();
                } catch (err) {
                  setProblem(err instanceof Error ? err.message : "Not pinned");
                }
              }}
            >
              {post.pinnedAt ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
          )}
          {saved && !system && (
            <span className="cv-save">
              <button
                type="button"
                className="cv-link"
                aria-label={isSaved ? "Take off saved" : "Save for later"}
                aria-expanded={isSaved ? undefined : saving}
                onClick={() => (isSaved ? void save(false) : setSaving(!saving))}
              >
                {isSaved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
              </button>
            </span>
          )}
          {channels && channels.length > 1 && (post.body || post.attachments.length > 0) && (
            <button type="button" className="cv-link" aria-label="Forward to another channel" aria-expanded={forwarding} onClick={() => (setForwarding(!forwarding), setForwarded(""))}>
              <Forward size={13} />
            </button>
          )}
          {aiHelp && !system && post.body.trim() && !translation && (
            <button type="button" className="cv-link" aria-label="Translate" title="Translate" onClick={() => void translate("English")}>
              <Languages size={13} />
            </button>
          )}
          {canTask && (
            <button type="button" className="cv-link" aria-label="Make a task" title="Make a task" aria-expanded={tasking} onClick={() => setTasking(!tasking)}>
              <ListChecks size={13} />
            </button>
          )}
          {onMarkUnread && (
            <button type="button" className="cv-link" aria-label="Mark unread from here" title="Mark unread from here" onClick={() => void onMarkUnread().catch((err: Error) => setProblem(err.message))}>
              <MailOpen size={13} />
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
        {tasking && (
          <TaskForm
            initial={post.body}
            onCancel={() => setTasking(false)}
            onMake={async (title, due) => {
              await backend.postToTask(post.id, { title, ...(due ? { due } : {}) });
              setTasking(false);
              onChanged();
            }}
          />
        )}
        {forwarding && channels && (
          <ForwardForm
            channels={channels.filter((c) => c.id !== post.channelId)}
            onCancel={() => setForwarding(false)}
            onForward={async (channel, note) => {
              await backend.forward(post.id, channel.id, note);
              setForwarding(false);
              setForwarded(`Forwarded to ${channel.direct ? channel.name : `#${channel.name}`}`);
            }}
          />
        )}
        {forwarded && (
          <p className="tiny muted" role="status">
            <Check size={12} /> {forwarded}
          </p>
        )}
        {saving && <WhenMenu label="Save, and remind me" hour={9} extra={{ label: "Just save it", onClick: () => void save(true) }} onPick={(at) => void save(true, at)} onClose={() => setSaving(false)} />}
      </div>
    </article>
  );
}

const previews = new Map<string, Promise<LinkPreview | null>>();
const TRANSLATE_INTO = ["English", "Afrikaans", "isiZulu", "isiXhosa", "Sesotho", "Setswana", "Portuguese", "French"];

/** The page a post links to, at a glance: its site, title and description. */
function LinkCard({ backend, post }: { backend: CommsBackend; post: Post }) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const url = firstWebLink(post.body);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const key = `${post.id} ${url}`;
    if (!previews.has(key)) previews.set(key, backend.preview(post.id).catch(() => null));
    void previews.get(key)!.then((p) => live && setPreview(p));
    return () => {
      live = false;
    };
  }, [backend, post.id, url]);
  const [noPicture, setNoPicture] = useState(false);
  if (!preview) return null;
  return (
    <a className="cv-preview" href={preview.url} target="_blank" rel="noopener noreferrer" data-picture={preview.image && !noPicture ? "true" : undefined}>
      <span className="cv-preview-words">
        <span className="tiny muted">{preview.site}</span>
        {preview.title && <strong className="small">{preview.title}</strong>}
        {preview.description && <span className="tiny cv-preview-text">{preview.description}</span>}
      </span>
      {preview.image && !noPicture && (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own route, sized by CSS
        <img className="cv-preview-img" src={backend.previewImageUrl(post.id)} alt="" loading="lazy" onError={() => setNoPicture(true)} />
      )}
    </a>
  );
}

/** A post made into a task: its title (from the post's first line) and when it is due. */
function TaskForm({ initial, onMake, onCancel }: { initial: string; onMake: (title: string, due: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(() =>
    (initial.split("\n").find((l) => l.trim()) ?? "")
      .replace(/^[>\-*•\s]+/, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_~`]/g, "")
      .trim()
      .slice(0, 200),
  );
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  return (
    <form
      className="cv-forward"
      aria-label="Make a task"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onMake(title, due);
        } catch (err) {
          setProblem(err instanceof Error ? err.message : "No task made. Please retry.");
          setBusy(false);
        }
      }}
    >
      <label className="tiny muted">
        Task
        <input className="input" value={title} maxLength={500} required onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="tiny muted">
        Due (optional)
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </label>
      {problem && <p className="tiny cv-problem">{problem}</p>}
      <div className="row" style={{ gap: "0.4rem" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>
          <ListChecks size={14} /> Make task
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Where to forward a post, and a note to go with it. */
function ForwardForm({ channels, onForward, onCancel }: { channels: Channel[]; onForward: (c: Channel, note: string) => Promise<void>; onCancel: () => void }) {
  const [to, setTo] = useState(channels[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const target = channels.find((c) => c.id === to);
  return (
    <form
      className="cv-forward"
      aria-label="Forward"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!target) return;
        setBusy(true);
        try {
          await onForward(target, note);
        } catch (err) {
          setProblem(err instanceof Error ? err.message : "Not forwarded. Please retry.");
          setBusy(false);
        }
      }}
    >
      <label className="tiny muted">
        Forward to
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.direct ? c.name : `#${c.name}`}
              {c.visibility === "client" ? " (client can see)" : ""}
            </option>
          ))}
        </select>
      </label>
      <input className="input" value={note} maxLength={1000} placeholder="Add a note (optional)" aria-label="Note" onChange={(e) => setNote(e.target.value)} />
      {target?.visibility === "client" && <p className="tiny cv-problem">The client will see this post and its files.</p>}
      {problem && <p className="tiny cv-problem">{problem}</p>}
      <div className="row" style={{ gap: "0.4rem" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !target}>
          <Forward size={14} /> Forward
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
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
  const canDraft = !!useContext(AskContext) && backend.mode === "server";
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
          <h2 className="cv-title grow">Thread</h2>
          {backend.mode === "server" && backend.audience === "team" && thread.data && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-pressed={!!thread.data.following}
              title={thread.data.following ? "You hear about every reply. Leave to hear only when someone names you." : "Hear about every reply in this thread"}
              onClick={async () => {
                const on = !thread.data?.following;
                thread.setData((d) => (d ? { ...d, following: on } : d));
                await backend.follow(postId, on).catch(() => undefined);
                void thread.refresh();
              }}
            >
              {thread.data.following ? <BellOff size={14} /> : <Bell size={14} />} {thread.data.following ? "Leave thread" : "Follow thread"}
            </button>
          )}
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
        onDraft={canDraft ? () => backend.draftReply(postId) : undefined}
        onSend={async (body, files, ask) => {
          const sent = await backend.post(thread.data?.post.channelId ?? "", { body, files, parentId: postId, ask });
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

const clockOf = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Records a voice note with the microphone, up to five minutes, and hands it over as a file. */
function useVoiceNote(onFile: (f: File) => void, onProblem: (p: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; keep: boolean; timer: ReturnType<typeof setInterval> } | null>(null);
  const supported = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const finish = (keep: boolean) => {
    const r = rec.current;
    if (!r) return;
    r.keep = keep;
    clearInterval(r.timer);
    if (r.recorder.state !== "inactive") r.recorder.stop();
    setRecording(false);
  };
  useEffect(() => () => finish(false), []);
  const start = async () => {
    onProblem("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      const began = Date.now();
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const r = rec.current;
        rec.current = null;
        if (!r?.keep || !chunks.length) return;
        const mime = recorder.mimeType || type || "audio/webm";
        const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
        const at = new Date(began).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        onFile(new File(chunks, `Voice note ${at}.${ext}`, { type: mime.split(";")[0] }));
      };
      recorder.start(1000);
      setSeconds(0);
      const timer = setInterval(() => {
        const sec = Math.round((Date.now() - began) / 1000);
        setSeconds(sec);
        if (sec >= 300) finish(true);
      }, 500);
      rec.current = { recorder, stream, keep: true, timer };
      setRecording(true);
    } catch {
      onProblem("The microphone could not be used. Allow it for this site and try again.");
    }
  };
  return { supported, recording, seconds, start, stop: () => finish(true), cancel: () => finish(false) };
}

/** Picks a task or document to link in a post, found by typing part of its name. */
function LinkPicker({ items, onPick, onClose }: { items: Linkable[]; onPick: (l: Linkable) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const found = items.filter((i) => words.every((w) => `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(w))).slice(0, 8);
  return (
    <div className="cv-links" role="dialog" aria-label="Link a task or document">
      <input
        className="input"
        autoFocus
        value={q}
        placeholder="Find a task or document"
        aria-label="Find a task or document"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && found[0]) {
            e.preventDefault();
            onPick(found[0]);
          }
        }}
      />
      <ul>
        {found.map((i) => (
          <li key={`${i.kind}:${i.href}:${i.label}`}>
            <button type="button" onClick={() => onPick(i)}>
              {i.kind === "task" ? <ListChecks size={14} /> : <FileText size={14} />}
              <span className="truncate">{i.label}</span>
              {i.hint && <span className="tiny muted truncate">{i.hint}</span>}
            </button>
          </li>
        ))}
        {!found.length && <li className="tiny muted" style={{ padding: "0.4rem 0.5rem" }}>{items.length ? "Nothing matches." : "This project has no tasks or documents yet."}</li>}
      </ul>
    </div>
  );
}

export function Composer({
  people,
  placeholder,
  onSend,
  onSchedule,
  onDraft,
  draftKey,
  onTyping,
}: {
  backend: CommsBackend;
  people: { key: string; name: string }[];
  placeholder: string;
  onSend: (body: string, files: File[], ask?: { options: string[] }) => Promise<void>;
  /** The studio writing now to send later, such as in a client's working hours. */
  onSchedule?: (body: string, files: File[], ask: { options: string[] } | undefined, sendAt: string) => Promise<void>;
  /** The assistant drafts the message, for the person to change and send. */
  onDraft?: () => Promise<string>;
  /** Called at most every few seconds while someone writes, so others see they are typing. */
  onTyping?: () => void;
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
  const typedAt = useRef(0);
  const linkables = useContext(LinkablesContext);
  const [linking, setLinking] = useState(false);
  // The studio asking for a decision: approve or not, or its own options.
  const [asking, setAsking] = useState<string[] | null>(null);
  const askOptions = asking?.map((o) => o.trim()).filter(Boolean) ?? [];
  // Clients send photos of the space and documents too, as in a client portal.
  const canAttach = true;
  const addFiles = (list: File[]) => {
    if (!canAttach || !list.length) return;
    setFiles((old) => [...old, ...list].slice(0, 10));
  };
  const voice = useVoiceNote((f) => addFiles([f]), setProblem);
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
  const insertLink = (l: Linkable) => {
    const el = area.current;
    const caret = el?.selectionStart ?? text.length;
    const label = `${l.kind === "task" ? "Task" : "Document"}: ${l.label}`.replace(/[[\]]/g, "").slice(0, 150);
    const before = `${text.slice(0, caret)}${caret && !/\s$/.test(text.slice(0, caret)) ? " " : ""}[${label}](${l.href}) `;
    setText(before + text.slice(caret));
    setLinking(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(before.length, before.length);
      fit();
    });
  };
  const [laterOpen, setLaterOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const draft = async () => {
    if (!onDraft || drafting) return;
    if (text.trim() && !window.confirm("Replace what you have written with the assistant's draft?")) return;
    setDrafting(true);
    setProblem("");
    try {
      setText(await onDraft());
      requestAnimationFrame(() => {
        fit();
        area.current?.focus();
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "No draft came back. Please retry.");
    } finally {
      setDrafting(false);
    }
  };
  const send = async (sendAt?: string) => {
    setLaterOpen(false);
    if (busy || (!text.trim() && !files.length)) return;
    if (asking && (!text.trim() || askOptions.length < 2)) {
      setProblem("Write the question, and give at least two options.");
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const ask = asking ? { options: askOptions } : undefined;
      if (sendAt && onSchedule) await onSchedule(text.trim(), files, ask, sendAt);
      else await onSend(text.trim(), files, ask);
      setText("");
      setFiles([]);
      setAsking(null);
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
      {linking && linkables && <LinkPicker items={linkables()} onPick={insertLink} onClose={() => setLinking(false)} />}
      {asking && (
        <div className="cv-ask-edit" role="group" aria-label="Options to choose from">
          <div className="row wrap" style={{ gap: "0.35rem" }}>
            <span className="tiny muted grow">The message is the question. Everyone who can see it picks one, clients too in a client channel.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking([...APPROVAL_OPTIONS])}>
              Approve or not
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(["", ""])}>
              Own options
            </button>
            <button type="button" className="icon-btn" aria-label="Stop asking" onClick={() => setAsking(null)}>
              <X size={15} />
            </button>
          </div>
          {asking.map((o, i) => (
            <input
              key={i}
              className="input"
              value={o}
              maxLength={80}
              placeholder={`Option ${i + 1}`}
              aria-label={`Option ${i + 1}`}
              onChange={(e) => setAsking(asking.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
          {asking.length < 6 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={() => setAsking([...asking, ""])}>
              <Plus size={14} /> Add an option
            </button>
          )}
        </div>
      )}
      {problem && <p className="tiny cv-problem">{problem}</p>}
      <div className="cv-compose-row">
        {linkables && (
          <button type="button" className="icon-btn" aria-label="Link a task or document" aria-expanded={linking} onClick={() => setLinking(!linking)}>
            <Link2 size={18} />
          </button>
        )}
        {linkables && (
          <button type="button" className="icon-btn" aria-label="Ask for a decision" aria-pressed={!!asking} onClick={() => setAsking(asking ? null : [...APPROVAL_OPTIONS])}>
            <Vote size={18} />
          </button>
        )}
        {onDraft && (
          <button type="button" className="icon-btn" aria-label={drafting ? "Drafting a reply" : "Draft a reply with the assistant"} title="Draft a reply with the assistant" disabled={drafting} data-busy={drafting ? "true" : undefined} onClick={() => void draft()}>
            <Sparkles size={18} />
          </button>
        )}
        {voice.supported && (
          <button
            type="button"
            className="icon-btn"
            data-recording={voice.recording ? "true" : undefined}
            aria-label={voice.recording ? `Stop the voice note (${clockOf(voice.seconds)})` : "Record a voice note"}
            onClick={() => (voice.recording ? voice.stop() : void voice.start())}
          >
            {voice.recording ? <Square size={16} /> : <Mic size={18} />}
          </button>
        )}
        {voice.recording && (
          <span className="cv-voice-live tiny" aria-live="polite">
            <span className="live-dot" /> {clockOf(voice.seconds)}
            <button type="button" className="cv-link tiny" onClick={voice.cancel}>
              Discard
            </button>
          </span>
        )}
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
            if (onTyping && e.target.value.trim() && e.timeStamp - typedAt.current > 3_000) {
              typedAt.current = e.timeStamp;
              onTyping();
            }
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
        {onSchedule && (
          <span className="cv-save">
            <button type="button" className="icon-btn" aria-label="Send later" aria-expanded={laterOpen} disabled={busy || (!text.trim() && !files.length)} onClick={() => setLaterOpen(!laterOpen)}>
              <Clock size={17} />
            </button>
            {laterOpen && <WhenMenu label="Send later" hour={8} onPick={(at) => void send(at)} onClose={() => setLaterOpen(false)} />}
          </span>
        )}
        <button type="submit" className="btn btn-primary cv-send" aria-label="Send" disabled={busy || (!text.trim() && !files.length)}>
          <Send size={16} />
        </button>
      </div>
    </form>
  );
}
