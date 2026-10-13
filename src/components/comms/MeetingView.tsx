"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, CalendarPlus, Send, Check, Copy, Download, FileText, ListChecks, Pencil, RefreshCw, Search, Sparkles, Upload, Video, X } from "lucide-react";
import type { ChannelList, CommsBackend, MeetingDetail } from "@/lib/comms/client";
import { REPEAT_LABEL, clock, joinable, type ActionItem, type Meeting, type MeetingNotes, type MeetingRepeat } from "@/lib/comms/types";
import type { Project } from "@/lib/studio/types";
import { CallRoom } from "./CallRoom";
import { ThreadView } from "./Conversations";
import { RepeatField, downloadIcs, meetingWhen } from "./Meetings";
import { usePolling } from "./useComms";
import "./comms.css";

const SOURCE: Record<string, string> = { ai: "Notes by the assistant", quick: "Quick notes (no AI)", manual: "Notes written by the team" };

/** The notes as a post for the client: summary, decisions and next steps, never the transcript. */
function notesForClient(m: Meeting, n: MeetingNotes) {
  const day = new Date(m.startsAt).toLocaleDateString(undefined, { day: "numeric", month: "long" });
  const parts = [`**Notes from ${m.title}** (${day})`];
  if (n.summary.trim()) parts.push(n.summary.trim());
  if (n.decisions.length) parts.push(["**Decisions**", ...n.decisions.map((d) => `- ${d}`)].join("\n"));
  if (n.actionItems.length)
    parts.push(
      ["**Next steps**", ...n.actionItems.map((a) => `- ${a.owner ? `${a.owner}: ` : ""}${a.title}${a.due ? `, by ${new Date(`${a.due}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}`)].join("\n"),
    );
  return parts.join("\n\n").slice(0, 5000);
}

/** Lets the team check and edit the notes before they go to the client's channel. */
function ShareWithClient({ backend, meeting, notes, onDone }: { backend: CommsBackend; meeting: Meeting; notes: MeetingNotes; onDone: (where: string) => void }) {
  const [text, setText] = useState(() => notesForClient(meeting, notes));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  return (
    <form
      className="stack mt-share"
      style={{ gap: "0.5rem" }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setProblem("");
        try {
          const { channels } = await backend.channels();
          const channel = channels.find((c) => c.visibility === "client") ?? (await backend.createChannel({ name: "Client", description: "Conversations with the client", visibility: "client" }));
          await backend.post(channel.id, { body: text.trim() });
          onDone(channel.name);
        } catch (err) {
          setProblem(err instanceof Error ? err.message : "Not sent. Please retry.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span className="field-label">What the client will read (check it first; the transcript is never shared)</span>
        <textarea className="input" rows={8} value={text} maxLength={5000} onChange={(e) => setText(e.target.value)} />
      </label>
      {problem && <p className="tiny cv-problem">{problem}</p>}
      <div className="row wrap" style={{ gap: "0.4rem" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>
          <Send size={15} /> {busy ? "Sending…" : "Send to the client's channel"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDone("")}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const statusLine = (m: Meeting) =>
  m.status === "cancelled"
    ? "Cancelled"
    : m.status === "live" && m.inCall > 0
      ? `Live now, ${m.inCall} in the call`
      : m.status === "ended"
        ? `Ended${m.startedAt && m.endedAt ? ` after ${Math.max(1, Math.round((Date.parse(m.endedAt) - Date.parse(m.startedAt)) / 60_000))} min` : ""}`
        : joinable(m)
          ? "Open to join"
          : Date.parse(m.startsAt) > Date.now()
            ? "Scheduled"
            : "Not held";

/** Writes notes as plain text for editing: a line per decision and per action ("Owner: what, by 2026-10-20"). */
function notesToText(n: MeetingNotes | null) {
  return {
    summary: n?.summary ?? "",
    decisions: (n?.decisions ?? []).join("\n"),
    actions: (n?.actionItems ?? []).map((a) => `${a.owner ? `${a.owner}: ` : ""}${a.title}${a.due ? `, by ${a.due}` : ""}`).join("\n"),
  };
}

function textToNotes(t: { summary: string; decisions: string; actions: string }, old: MeetingNotes | null): MeetingNotes {
  const lines = (s: string) => s.split("\n").map((l) => l.replace(/^[-*•\s]+/, "").trim()).filter(Boolean);
  return {
    summary: t.summary.trim(),
    decisions: lines(t.decisions).slice(0, 50).map((d) => d.slice(0, 500)),
    actionItems: lines(t.actions)
      .slice(0, 50)
      .map((l, i) => {
        const due = l.match(/,?\s*(?:by|due)\s+(\d{4}-\d{2}-\d{2})\s*$/i);
        let rest = due ? l.slice(0, due.index).trim() : l;
        const owner = rest.match(/^([^:]{1,60}):\s+/);
        if (owner) rest = rest.slice(owner[0].length);
        const kept = old?.actionItems.find((a) => a.title === rest.slice(0, 500));
        const item: ActionItem = { id: kept?.id ?? `a${Date.now().toString(36)}${i}`, title: rest.slice(0, 500) || l.slice(0, 500) };
        if (owner) item.owner = owner[1].trim();
        if (due) item.due = due[1];
        if (kept?.taskId) item.taskId = kept.taskId;
        return item;
      }),
  };
}

function NotesEditor({ notes, onSave, onCancel }: { notes: MeetingNotes | null; onSave: (n: MeetingNotes) => Promise<void>; onCancel: () => void }) {
  const [t, setT] = useState(() => notesToText(notes));
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(textToNotes(t, notes));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field">
        <span className="field-label">Summary</span>
        <textarea className="input" rows={4} value={t.summary} maxLength={6000} onChange={(e) => setT({ ...t, summary: e.target.value })} style={{ height: "auto", paddingTop: "0.6rem" }} />
      </label>
      <label className="field">
        <span className="field-label">Decisions, one a line</span>
        <textarea className="input" rows={3} value={t.decisions} onChange={(e) => setT({ ...t, decisions: e.target.value })} style={{ height: "auto", paddingTop: "0.6rem" }} />
      </label>
      <label className="field">
        <span className="field-label">Action items, one a line (&quot;Name: what to do, by 2026-10-20&quot;)</span>
        <textarea className="input" rows={4} value={t.actions} onChange={(e) => setT({ ...t, actions: e.target.value })} style={{ height: "auto", paddingTop: "0.6rem" }} />
      </label>
      <div className="row" style={{ gap: "0.5rem" }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          Save notes
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditMeeting({ meeting, onSave, onCancel }: { meeting: Meeting; onSave: (m: Partial<Pick<Meeting, "title" | "agenda" | "startsAt" | "durationMin" | "clientVisible" | "waitingRoom" | "repeat">>) => Promise<void>; onCancel: () => void }) {
  const start = new Date(meeting.startsAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const [title, setTitle] = useState(meeting.title);
  const [agenda, setAgenda] = useState(meeting.agenda);
  const [date, setDate] = useState(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
  const [time, setTime] = useState(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
  const [duration, setDuration] = useState(meeting.durationMin);
  const [client, setClient] = useState(meeting.clientVisible);
  const [lobby, setLobby] = useState(meeting.waitingRoom);
  const [repeat, setRepeat] = useState<MeetingRepeat>(meeting.repeat);
  const [problem, setProblem] = useState("");
  return (
    <form
      className="mt-form mt-section"
      onSubmit={async (e) => {
        e.preventDefault();
        setProblem("");
        try {
          await onSave({ title: title.trim(), agenda: agenda.trim(), startsAt: new Date(`${date}T${time}`).toISOString(), durationMin: duration, clientVisible: client, waitingRoom: lobby, ...(repeat !== meeting.repeat ? { repeat } : {}) });
        } catch (err) {
          setProblem(err instanceof Error ? err.message : "Not saved. Please retry.");
        }
      }}
    >
      <h2>Change the meeting</h2>
      <label className="field">
        <span className="field-label">Title</span>
        <input className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <div className="mt-form-row">
        <label className="field">
          <span className="field-label">Day</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Time</span>
          <input className="input" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Minutes</span>
          <input className="input" type="number" min={5} max={600} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 30)} />
        </label>
        <RepeatField value={repeat} onChange={setRepeat} />
      </div>
      <label className="field">
        <span className="field-label">Agenda</span>
        <textarea className="input" rows={3} value={agenda} maxLength={5000} onChange={(e) => setAgenda(e.target.value)} style={{ height: "auto", paddingTop: "0.6rem" }} />
      </label>
      <label className="mt-check">
        <input type="checkbox" checked={client} onChange={(e) => setClient(e.target.checked)} />
        The client is invited
      </label>
      {client && (
        <label className="mt-check">
          <input type="checkbox" checked={lobby} onChange={(e) => setLobby(e.target.checked)} />
          The client waits until someone in the studio lets them in
        </label>
      )}
      {problem && <p className="tiny cv-problem" style={{ padding: 0 }}>{problem}</p>}
      <div className="row" style={{ gap: "0.5rem" }}>
        <button type="submit" className="btn btn-primary btn-sm">
          Save
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * One meeting: join the call, and afterwards its notes, decisions and action
 * items (which become tasks), the transcript, recordings and the meeting's chat.
 * An invited client sees the meeting, the Join button and the chat.
 */
export function MeetingView({
  backend,
  meetingId,
  backHref,
  backLabel,
  onProject,
  addTasksHere,
  askAssistant,
}: {
  backend: CommsBackend;
  meetingId: string;
  backHref: string;
  backLabel: string;
  /** The project as the server now has it, after action items became tasks. */
  onProject?: (p: Project) => void;
  /** Demo only: adds the tasks in this browser. */
  addTasksHere?: (items: ActionItem[]) => void;
  /** Opens the assistant with a request about this meeting. */
  askAssistant?: (prompt: string) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const team = backend.audience === "team";
  const detail = usePolling<MeetingDetail>(() => backend.meeting(meetingId), 10_000, [backend, meetingId]);
  const [inCall, setInCall] = useState(params.get("join") === "1");
  const [editing, setEditing] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const [chatList, setChatList] = useState<ChannelList | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState("");
  const pageUrl = () => `${window.location.origin}${window.location.pathname}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem("The link could not be copied. Copy it from the address bar.");
    }
  };
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    backend
      .channels()
      .then((l) => live && setChatList(l))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [backend]);

  const m = detail.data?.meeting;
  const notes = m?.notes ?? null;
  const open = notes?.actionItems.filter((a) => !a.taskId) ?? [];
  const chosen = picked ?? open.map((a) => a.id);
  const transcript = useMemo(() => detail.data?.transcript ?? [], [detail.data]);
  // The recording the transcript's times line up with, and how far into the meeting it began.
  const sync = useMemo(() => {
    const recs = detail.data?.recordings ?? [];
    const source = transcript[0]?.source;
    if (!recs.length || !source || source === "upload") return null;
    if (source === "recording") {
      const rec = [...recs].reverse().find((r) => r.status === "transcribed") ?? recs[recs.length - 1];
      return { rec, offsetMs: 0 };
    }
    // Live captions count from the start of the call; a recording began some time into it.
    const startedAt = detail.data?.meeting.startedAt;
    const started = startedAt ? Date.parse(startedAt) : NaN;
    const rec = recs[0];
    const began = Date.parse(rec.createdAt) - rec.durationSec * 1000;
    return Number.isFinite(started) ? { rec, offsetMs: Math.max(0, began - started) } : null;
  }, [detail.data, transcript]);
  const player = useRef<HTMLAudioElement>(null);
  const [playingMs, setPlayingMs] = useState<number | null>(null);
  const follow = useRef(true);
  const playFrom = (atMs: number) => {
    const a = player.current;
    if (!a || !sync) return;
    a.currentTime = Math.max(0, (atMs - sync.offsetMs) / 1000);
    follow.current = true;
    void a.play().catch(() => undefined);
  };
  const currentLine = useMemo(() => {
    if (playingMs === null) return null;
    let at: string | null = null;
    for (const l of transcript) if (l.atMs <= playingMs) at = l.id;
    return at;
  }, [playingMs, transcript]);
  useEffect(() => {
    if (!currentLine || !follow.current) return;
    document.getElementById(`line-${currentLine}`)?.scrollIntoView({ block: "nearest" });
  }, [currentLine]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? transcript.filter((l) => l.text.toLowerCase().includes(q) || l.speaker.toLowerCase().includes(q)) : transcript;
  }, [transcript, query]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setProblem("");
    try {
      await fn();
      await detail.refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't work. Please retry.");
    } finally {
      setBusy("");
    }
  };

  const makeTasks = () =>
    run("tasks", async () => {
      const items = open.filter((a) => chosen.includes(a.id));
      if (!items.length) return;
      if (backend.mode === "server") {
        const res = await backend.makeTasks(meetingId, items.map((a) => a.id));
        if (res.project) onProject?.(res.project);
      } else if (addTasksHere && notes) {
        addTasksHere(items);
        const ids = new Set(items.map((a) => a.id));
        await backend.updateMeeting(meetingId, { notes: { ...notes, actionItems: notes.actionItems.map((a) => (ids.has(a.id) ? { ...a, taskId: `added-${a.id}` } : a)) } });
      }
      setPicked(null);
    });

  const uploadFile = async (f: File) => {
    if (f.size > 2_000_000) {
      setProblem("That file is too big for a transcript. Use the text export (.vtt, .srt or .txt).");
      return;
    }
    const text = await f.text();
    await run("transcript", async () => void (await backend.uploadTranscript(meetingId, text)));
  };

  if (detail.error && !detail.data)
    return (
      <div className="stack">
        <a className="small" href={backHref}>
          ← {backLabel}
        </a>
        <p className="cv-problem small">{detail.error}</p>
      </div>
    );
  if (!m) return <p className="small muted">Loading the meeting…</p>;

  const canJoin = joinable(m);
  const finished = m.status === "ended" || m.status === "cancelled";

  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <a className="small muted" href={backHref} onClick={(e) => (e.preventDefault(), router.push(backHref))}>
        ← {backLabel}
      </a>
      <div className="mt-hero" style={{ marginBottom: 0 }}>
        <div className="stack" style={{ gap: "0.25rem", minWidth: 0 }}>
          <p className="tiny muted" style={{ margin: 0 }}>
            {statusLine(m)}
            {m.clientVisible && team ? " · Client invited" : ""}
          </p>
          <h1 style={{ fontSize: "clamp(1.3rem, 4vw, 1.8rem)", margin: 0 }}>{m.title}</h1>
          <p className="small muted" style={{ margin: 0 }}>
            {meetingWhen(m)}
            {m.repeat !== "none" ? ` · ${REPEAT_LABEL[m.repeat].toLowerCase()}` : ""}
          </p>
          {detail.data?.next && (
            // Each occurrence has its own page; this one links on to the next.
            <a className="small" href={detail.data.next.id} style={{ color: "#d9f99d" }}>
              Next: {meetingWhen({ startsAt: detail.data.next.startsAt, durationMin: m.durationMin })} →
            </a>
          )}
        </div>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          {canJoin && (
            <button type="button" className="btn btn-accent btn-lg" onClick={() => setInCall(true)}>
              <Video size={18} /> {m.status === "live" && m.inCall > 0 ? "Join the call" : "Start the call"}
            </button>
          )}
          {m.status !== "cancelled" && m.status !== "ended" && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#f3f2ec" }} onClick={() => void copyLink()} title={team ? "For the team. Invited clients join from their project page." : undefined}>
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Copied" : "Copy link"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#f3f2ec" }} onClick={() => downloadIcs(m, pageUrl())}>
                <CalendarPlus size={15} /> Add to calendar
              </button>
            </>
          )}
          {team && m.status === "scheduled" && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#f3f2ec" }} onClick={() => setEditing(true)}>
                <Pencil size={15} /> Change
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: "#f3f2ec" }}
                onClick={() => confirm("Cancel this meeting? Everyone invited sees it as cancelled.") && void run("cancel", async () => void (await backend.updateMeeting(meetingId, { status: "cancelled" })))}
              >
                <X size={15} /> Cancel meeting
              </button>
            </>
          )}
          {team && m.status === "cancelled" && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#f3f2ec" }} onClick={() => void run("restore", async () => void (await backend.updateMeeting(meetingId, { status: "scheduled" })))}>
              Put it back on
            </button>
          )}
        </div>
      </div>
      {problem && <p className="small cv-problem" style={{ padding: 0 }}>{problem}</p>}
      {editing && (
        <EditMeeting
          meeting={m}
          onCancel={() => setEditing(false)}
          onSave={async (change) => {
            await backend.updateMeeting(meetingId, change);
            setEditing(false);
            await detail.refresh();
          }}
        />
      )}

      <div className="mt-grid">
        <div className="stack" style={{ gap: "1rem", minWidth: 0 }}>
          {m.agenda && (
            <section className="mt-section">
              <h2>Agenda</h2>
              <p className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {m.agenda}
              </p>
            </section>
          )}

          {team && (
            <section className="mt-section">
              <div className="row-between wrap" style={{ gap: "0.5rem" }}>
                <h2>Notes</h2>
                <div className="row wrap" style={{ gap: "0.35rem" }}>
                  {transcript.length > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => (!notes || notes && confirm("Take the notes again from the transcript? Changes made by hand are replaced.")) && void run("notes", async () => void (await backend.takeNotes(meetingId)))}>
                      <Sparkles size={15} /> {busy === "notes" ? "Taking notes…" : notes ? "Take again" : "Take notes"}
                    </button>
                  )}
                  {!editingNotes && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingNotes(true)}>
                      <Pencil size={15} /> {notes ? "Edit" : "Write notes"}
                    </button>
                  )}
                  {notes && !editingNotes && !sharing && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setSharing(true), setShared(""))}>
                      <Send size={15} /> Share with the client
                    </button>
                  )}
                </div>
              </div>
              {sharing && notes && m && (
                <ShareWithClient
                  backend={backend}
                  meeting={m}
                  notes={notes}
                  onDone={(where) => {
                    setSharing(false);
                    setShared(where);
                  }}
                />
              )}
              {shared && <p className="tiny" style={{ margin: 0, color: "var(--good)" }}>Sent to #{shared}. The client sees it on their project page.</p>}
              {editingNotes ? (
                <NotesEditor
                  notes={notes}
                  onCancel={() => setEditingNotes(false)}
                  onSave={async (n) => {
                    await run("save", async () => void (await backend.updateMeeting(meetingId, { notes: n })));
                    setEditingNotes(false);
                  }}
                />
              ) : notes ? (
                <>
                  <p className="tiny muted" style={{ margin: 0 }}>
                    {SOURCE[m.notesSource ?? "manual"]}
                    {m.notesAt ? `, ${new Date(m.notesAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
                  </p>
                  {notes.summary && <p className="small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{notes.summary}</p>}
                  {notes.decisions.length > 0 && (
                    <div className="stack" style={{ gap: "0.3rem" }}>
                      <p className="eyebrow">Decisions</p>
                      <ul className="small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
                        {notes.decisions.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {notes.actionItems.length > 0 && (
                    <div className="stack" style={{ gap: "0.45rem" }}>
                      <p className="eyebrow">Action items</p>
                      <ul className="mt-actions">
                        {notes.actionItems.map((a) => (
                          <li key={a.id}>
                            {a.taskId ? (
                              <ListChecks size={17} aria-label="Made into a task" style={{ color: "var(--good)", flexShrink: 0, marginTop: 2 }} />
                            ) : (
                              <input
                                type="checkbox"
                                aria-label={`Make "${a.title}" a task`}
                                checked={chosen.includes(a.id)}
                                onChange={(e) => setPicked(e.target.checked ? [...chosen, a.id] : chosen.filter((x) => x !== a.id))}
                                style={{ marginTop: 4 }}
                              />
                            )}
                            <span>
                              {a.owner && <strong>{a.owner}: </strong>}
                              {a.title}
                              {a.due && <span className="muted"> · by {new Date(`${a.due}T12:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
                              {a.taskId && <span className="tiny muted"> · on the project&apos;s tasks</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="row wrap" style={{ gap: "0.4rem" }}>
                        {open.length > 0 && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || !chosen.length} onClick={() => void makeTasks()}>
                            <ListChecks size={15} /> {busy === "tasks" ? "Adding…" : `Add ${chosen.length || ""} to the project's tasks`}
                          </button>
                        )}
                        {askAssistant && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => askAssistant(`Read the meeting "${m.title}" (its notes, decisions, action items and transcript) and carry on with the work that came out of it. Tell me what you did and what still needs me.`)}
                          >
                            <Bot size={15} /> Ask the assistant to carry on
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  {transcript.length
                    ? "There is a transcript. Take notes to get a summary, decisions and action items."
                    : finished
                      ? "No notes yet. Upload a transcript (from Teams, Zoom or Meet too), or write the notes by hand."
                      : "Record the call and the summary, decisions and action items come here when it ends."}
                </p>
              )}
            </section>
          )}

          {team && (
            <section className="mt-section">
              <div className="row-between wrap" style={{ gap: "0.5rem" }}>
                <h2>Transcript</h2>
                <div className="row wrap" style={{ gap: "0.35rem" }}>
                  <input
                    ref={fileInput}
                    type="file"
                    accept=".vtt,.srt,.txt,text/vtt,text/plain,application/x-subrip"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadFile(f);
                    }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => fileInput.current?.click()}>
                    <Upload size={15} /> {busy === "transcript" ? "Reading…" : "Upload"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasting(!pasting)}>
                    <FileText size={15} /> Paste
                  </button>
                  {transcript.length > 0 && backend.transcriptUrl(meetingId) && (
                    <a className="btn btn-ghost btn-sm" href={backend.transcriptUrl(meetingId)!} download>
                      <Download size={15} /> Download
                    </a>
                  )}
                </div>
              </div>
              {pasting && (
                <div className="stack" style={{ gap: "0.5rem" }}>
                  <textarea
                    className="input"
                    rows={6}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder={"Paste a transcript. Lines like \"Thandi: We go with oak\" work, and so do Teams, Zoom and Meet exports."}
                    style={{ height: "auto", paddingTop: "0.6rem" }}
                  />
                  <div className="row" style={{ gap: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!paste.trim() || !!busy}
                      onClick={() =>
                        void run("transcript", async () => {
                          await backend.uploadTranscript(meetingId, paste);
                          setPaste("");
                          setPasting(false);
                        })
                      }
                    >
                      Save transcript
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasting(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {transcript.length > 0 ? (
                <>
                  {transcript.length > 12 && (
                    <label className="row" style={{ gap: "0.4rem" }}>
                      <Search size={15} aria-hidden />
                      <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the transcript" aria-label="Search the transcript" />
                    </label>
                  )}
                  {sync && (
                    <div className="stack" style={{ gap: "0.25rem" }}>
                      <audio
                        ref={player}
                        controls
                        preload="metadata"
                        src={backend.recordingUrl(meetingId, sync.rec, true)}
                        style={{ width: "100%" }}
                        aria-label="The recording, in step with the transcript"
                        onTimeUpdate={(e) => setPlayingMs(e.currentTarget.currentTime * 1000 + sync.offsetMs)}
                        onEnded={() => setPlayingMs(null)}
                      />
                      <p className="tiny muted" style={{ margin: 0 }}>Press a time to hear that part of the recording.</p>
                    </div>
                  )}
                  <div className="mt-transcript" onWheel={() => (follow.current = false)} onTouchMove={() => (follow.current = false)}>
                    {shown.map((l) => (
                      <p key={l.id} id={`line-${l.id}`} className="mt-line" data-now={l.id === currentLine ? "true" : undefined} style={{ margin: 0 }}>
                        {sync && l.atMs >= sync.offsetMs ? (
                          <button type="button" className="mt-seek" onClick={() => playFrom(l.atMs)} aria-label={`Play from ${clock(l.atMs)}`}>
                            {clock(l.atMs)}
                          </button>
                        ) : (
                          <time>{clock(l.atMs)}</time>
                        )}
                        <strong>{l.speaker}:</strong> {l.text}
                      </p>
                    ))}
                    {!shown.length && <p className="small muted">Nothing matches.</p>}
                  </div>
                </>
              ) : (
                <p className="small muted" style={{ margin: 0 }}>
                  No transcript yet. Record the call (with transcription on), or upload one from Teams, Zoom or Meet (.vtt, .srt or .txt).
                </p>
              )}
            </section>
          )}

          {team && (detail.data?.recordings.length ?? 0) > 0 && (
            <section className="mt-section">
              <h2>Recordings</h2>
              {detail.data!.recordings.map((r) => (
                <div key={r.id} className="stack" style={{ gap: "0.35rem" }}>
                  <audio controls preload="none" src={backend.recordingUrl(meetingId, r, true)} style={{ width: "100%" }} />
                  <div className="row-between wrap tiny muted" style={{ gap: "0.4rem" }}>
                    <span>
                      {new Date(r.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {Math.max(1, Math.round(r.durationSec / 60))} min ·{" "}
                      {r.status === "transcribing" ? "Transcribing…" : r.status === "transcribed" ? "Transcribed" : r.status === "failed" ? "Not transcribed" : "Saved"}
                    </span>
                    <span className="row" style={{ gap: "0.35rem" }}>
                      {backend.mode === "server" && (
                        <a href={backend.recordingUrl(meetingId, r)} download className="btn btn-ghost btn-sm">
                          <Download size={14} /> Download
                        </a>
                      )}
                      {backend.mode === "server" && r.status === "failed" && (
                        <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void run("retry", () => backend.retryTranscription(meetingId, r.id))}>
                          <RefreshCw size={14} /> Transcribe again
                        </button>
                      )}
                    </span>
                  </div>
                  {r.error && <p className="tiny muted" style={{ margin: 0 }}>{r.error}</p>}
                </div>
              ))}
            </section>
          )}
        </div>

        <section className="mt-section" style={{ minWidth: 0 }}>
          <h2>Meeting chat</h2>
          <p className="tiny muted" style={{ margin: 0 }}>
            {m.clientVisible ? "The client sees this chat." : "Only the team sees this chat."}
            {team && " Mention @Assistant to have it pick something up."}
          </p>
          <div className="mt-chat">
            {m.postId && chatList ? (
              <ThreadView backend={backend} list={chatList} postId={m.postId} meetingHref={() => "#"} />
            ) : (
              <p className="small muted" style={{ padding: "1rem" }}>{m.postId ? "Loading…" : "This meeting has no chat."}</p>
            )}
          </div>
        </section>
      </div>

      {inCall && (
        <CallRoom
          backend={backend}
          meeting={m}
          onClose={() => {
            setInCall(false);
            if (params.get("join")) router.replace(window.location.pathname);
            void detail.refresh();
          }}
        />
      )}
    </div>
  );
}
