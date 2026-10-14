"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, FileText, Mic, Repeat, Users, Video } from "lucide-react";
import type { CommsBackend } from "@/lib/comms/client";
import { MEETING_REPEATS, REPEAT_LABEL, joinable, type Meeting, type MeetingRepeat, type NewMeeting } from "@/lib/comms/types";
import { usePolling } from "./useComms";
import { meetingIcs } from "@/lib/comms/ics";
import "./comms.css";

const DURATIONS = [15, 30, 45, 60, 90, 120];

/** The next half hour from now, as local date and time fields. */
function nextSlot(day?: string): { date: string; time: string } {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: day ?? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: day ? "09:00" : `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

export const meetingWhen = (m: Pick<Meeting, "startsAt" | "durationMin">) => {
  const start = new Date(m.startsAt);
  const end = new Date(start.getTime() + m.durationMin * 60_000);
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}, ${time(start)} to ${time(end)}`;
};

export function downloadIcs(m: Parameters<typeof meetingIcs>[0], url: string) {
  const blob = new Blob([meetingIcs(m, url)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${m.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Meeting"}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Scheduling a meeting: a title, a day and time, how long, an agenda, and
 * whether the client is invited. "Start now" makes one for this minute and
 * goes straight into the call.
 */
export function ScheduleMeeting({
  onSchedule,
  onCancel,
  canInviteClient = true,
  day,
  allowStartNow = true,
}: {
  onSchedule: (input: NewMeeting, startNow: boolean) => Promise<void>;
  onCancel?: () => void;
  canInviteClient?: boolean;
  /** The day picked on the calendar, YYYY-MM-DD. */
  day?: string;
  allowStartNow?: boolean;
}) {
  const slot = nextSlot(day);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(slot.date);
  const [time, setTime] = useState(slot.time);
  const [duration, setDuration] = useState(30);
  const [agenda, setAgenda] = useState("");
  const [client, setClient] = useState(false);
  const [repeat, setRepeat] = useState<MeetingRepeat>("none");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const submit = async (startNow: boolean) => {
    setBusy(true);
    setProblem("");
    try {
      const startsAt = startNow ? new Date().toISOString() : new Date(`${date}T${time}`).toISOString();
      await onSchedule({ title: title.trim() || (startNow ? "Quick call" : ""), startsAt, durationMin: duration, agenda: agenda.trim() || undefined, clientVisible: client, ...(repeat !== "none" && !startNow ? { repeat } : {}) }, startNow);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The meeting was not made. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="mt-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <label className="field">
        <span className="field-label">Title</span>
        <input className="input" value={title} maxLength={200} placeholder="e.g. Concept review with the client" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="mt-form-row">
        <label className="field">
          <span className="field-label">Day</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Time</span>
          <input className="input" type="time" value={time} step={300} onChange={(e) => setTime(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Length</span>
          <select className="input" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} min` : `${Math.floor(d / 60)} h${d % 60 ? ` ${d % 60} min` : ""}`}
              </option>
            ))}
          </select>
        </label>
        <RepeatField value={repeat} onChange={setRepeat} />
      </div>
      <label className="field">
        <span className="field-label">Agenda (optional)</span>
        <textarea className="input" rows={3} value={agenda} maxLength={5000} onChange={(e) => setAgenda(e.target.value)} placeholder="What to cover" style={{ height: "auto", paddingTop: "0.6rem" }} />
      </label>
      {canInviteClient && (
        <label className="mt-check">
          <input type="checkbox" checked={client} onChange={(e) => setClient(e.target.checked)} />
          Invite the client: it shows on their project page with a Join button, and its chat goes in a client channel
        </label>
      )}
      {problem && <p className="tiny cv-problem" style={{ padding: 0 }}>{problem}</p>}
      <div className="row wrap" style={{ gap: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={busy || !title.trim()}>
          <CalendarPlus size={16} /> Schedule
        </button>
        {allowStartNow && (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void submit(true)}>
            <Video size={16} /> Start a call now
          </button>
        )}
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function RepeatField({ value, onChange }: { value: MeetingRepeat; onChange: (r: MeetingRepeat) => void }) {
  return (
    <label className="field">
      <span className="field-label">Repeats</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as MeetingRepeat)}>
        {MEETING_REPEATS.map((r) => (
          <option key={r} value={r}>
            {REPEAT_LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MeetingCard({ meeting: m, href, audience }: { meeting: Meeting; href: string; audience: "team" | "client" }) {
  const start = new Date(m.startsAt);
  const live = m.status === "live" && m.inCall > 0;
  const open = joinable(m);
  return (
    <Link href={href} className="mt-card card-link" data-status={m.status}>
      <span className="mt-date" aria-hidden>
        <span>{start.toLocaleDateString(undefined, { month: "short" })}</span>
        <strong>{start.getDate()}</strong>
      </span>
      <span className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
        <span className="strong truncate">{m.title}</span>
        <span className="small muted">{meetingWhen(m)}</span>
        <span className="row wrap tiny muted" style={{ gap: "0.6rem" }}>
          {live && (
            <span className="mt-live">
              <span className="live-dot" /> {m.inCall} in the call
            </span>
          )}
          {m.status === "cancelled" && <span>Cancelled</span>}
          {m.repeat !== "none" && (
            <span className="row" style={{ gap: "0.25rem" }}>
              <Repeat size={12} aria-hidden /> {REPEAT_LABEL[m.repeat]}
            </span>
          )}
          {m.clientVisible && audience === "team" && (
            <span className="row" style={{ gap: "0.25rem" }}>
              <Users size={12} /> Client invited
            </span>
          )}
          {m.recordings > 0 && (
            <span className="row" style={{ gap: "0.25rem" }}>
              <Mic size={12} /> Recorded
            </span>
          )}
          {m.notes && (
            <span className="row" style={{ gap: "0.25rem" }}>
              <FileText size={12} /> Notes{m.notes.actionItems.length ? `, ${m.notes.actionItems.length} actions` : ""}
            </span>
          )}
        </span>
      </span>
      {open ? (
        <span className="btn btn-primary btn-sm">
          <Video size={15} /> {live ? "Join" : "Open"}
        </span>
      ) : (
        <span className="btn btn-ghost btn-sm">{m.status === "ended" ? "Notes" : "Details"}</span>
      )}
    </Link>
  );
}

/** A project's meetings: live now, coming up and earlier, and scheduling a new one. */
export function MeetingsPanel({ backend, meetingHref }: { backend: CommsBackend; meetingHref: (id: string) => string }) {
  const router = useRouter();
  const team = backend.audience === "team";
  const meetings = usePolling(() => backend.meetings(), 15_000, [backend]);
  const [scheduling, setScheduling] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const groups = useMemo(() => {
    const all = meetings.data ?? [];
    const done = (m: Meeting) => m.status === "ended" || m.status === "cancelled" || (m.status !== "live" && Date.parse(m.startsAt) + (m.durationMin + 120) * 60_000 < now);
    return {
      live: all.filter((m) => m.status === "live" && m.inCall > 0),
      upcoming: all.filter((m) => !done(m) && !(m.status === "live" && m.inCall > 0)),
      earlier: all.filter(done).reverse(),
    };
  }, [meetings.data, now]);

  return (
    <div className="stack" style={{ gap: "1.25rem" }}>
      {team && (
        <section className="mt-section">
          <div className="row-between wrap" style={{ gap: "0.5rem" }}>
            <div>
              <h2>Meetings</h2>
              <p className="small muted">
                Video calls on this project, joined from a link by the team{" "}
                {backend.mode === "server" ? "and invited clients" : "(and invited clients, once you sign in)"}. Record and transcribe them, and the notes and action
                items land here for the assistant to carry on with.
              </p>
            </div>
            {!scheduling && (
              <button type="button" className="btn btn-primary" onClick={() => setScheduling(true)}>
                <CalendarPlus size={16} /> Schedule a meeting
              </button>
            )}
          </div>
          {scheduling && (
            <ScheduleMeeting
              canInviteClient
              onCancel={() => setScheduling(false)}
              onSchedule={async (input, startNow) => {
                const m = await backend.createMeeting(input);
                setScheduling(false);
                await meetings.refresh();
                if (startNow) router.push(`${meetingHref(m.id)}?join=1`);
              }}
            />
          )}
        </section>
      )}
      {meetings.error && <p className="tiny cv-problem">{meetings.error}</p>}
      {!meetings.data && !meetings.error && <p className="small muted">Loading meetings…</p>}
      {groups.live.length > 0 && (
        <section className="stack" style={{ gap: "0.5rem" }}>
          <p className="eyebrow">Live now</p>
          <div className="mt-list">
            {groups.live.map((m) => (
              <MeetingCard key={m.id} meeting={m} href={meetingHref(m.id)} audience={backend.audience} />
            ))}
          </div>
        </section>
      )}
      {meetings.data && (
        <section className="stack" style={{ gap: "0.5rem" }}>
          <p className="eyebrow">Coming up</p>
          {groups.upcoming.length ? (
            <div className="mt-list">
              {groups.upcoming.map((m) => (
                <MeetingCard key={m.id} meeting={m} href={meetingHref(m.id)} audience={backend.audience} />
              ))}
            </div>
          ) : (
            <p className="small muted">{team ? "Nothing scheduled. Schedule a meeting, or start a call now." : "No meetings are planned with you yet."}</p>
          )}
        </section>
      )}
      {groups.earlier.length > 0 && (
        <section className="stack" style={{ gap: "0.5rem" }}>
          <p className="eyebrow">Earlier</p>
          <div className="mt-list">
            {(showAll ? groups.earlier : groups.earlier.slice(0, 8)).map((m) => (
              <MeetingCard key={m.id} meeting={m} href={meetingHref(m.id)} audience={backend.audience} />
            ))}
          </div>
          {groups.earlier.length > 8 && !showAll && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setShowAll(true)}>
              Show all {groups.earlier.length}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
