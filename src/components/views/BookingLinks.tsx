"use client";

import React, { useEffect, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { DURATIONS, bookingLinkInput } from "@/lib/planner/booking";
import type { Booking, BookingLink } from "@/lib/planner/booking-store";
import { plusDays } from "@/lib/planner/workweek";
import { toDay } from "@/lib/studio/tasks";

const todayISO = () => toDay(new Date());

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "That didn't work. Try again.");
  return body as T;
}

const length = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

function when(b: Booking): string {
  const start = new Date(b.start);
  const end = new Date(b.end);
  const dayPart = start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${dayPart}, ${time(start)}–${time(end)}`;
}

/**
 * Links a client opens to book time: the meeting's length, the dates it may
 * fall on, and only times inside working hours that are still free.
 */
export function BookingLinks() {
  const { persistence, projects, toast } = useStudio();
  const server = persistence === "server";
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!server) return;
    call<{ links: BookingLink[]; bookings: Booking[] }>("/api/booking-links").then(
      (r) => {
        setLinks(r.links);
        setBookings(r.bookings);
      },
      (err: Error) => {
        toast(err.message);
        setLinks([]);
      }
    );
  }, [server, toast]);

  const address = (l: BookingLink) => `${window.location.origin}/book/${l.token}`;
  const copy = (l: BookingLink) =>
    navigator.clipboard.writeText(address(l)).then(() => toast("Booking link copied"), () => toast(address(l)));

  const setActive = async (l: BookingLink, active: boolean) => {
    try {
      const r = await call<{ link: BookingLink }>(`/api/booking-links/${l.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      setLinks((all) => all?.map((x) => (x.id === l.id ? r.link : x)) ?? null);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const remove = async (l: BookingLink) => {
    if (!window.confirm(`Delete “${l.title}”? Clients can no longer open it. Meetings already booked stay.`)) return;
    try {
      await call(`/api/booking-links/${l.id}`, { method: "DELETE" });
      setLinks((all) => all?.filter((x) => x.id !== l.id) ?? null);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const cancel = async (b: Booking) => {
    if (!window.confirm(`Cancel ${b.title} on ${when(b)}? The time opens again. Let ${b.name} know at ${b.email}.`)) return;
    try {
      await call(`/api/bookings/${b.id}`, { method: "DELETE" });
      setBookings((all) => all.filter((x) => x.id !== b.id));
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const projectName = (id?: string) => projects.find((p) => p.id === id)?.name;
  const upcoming = bookings.filter((b) => new Date(b.end) > new Date());

  return (
    <section className="card settings-section rise" style={{ ["--i" as string]: 3 }}>
      <div>
        <h2 className="display-s">Booking links</h2>
        <p className="small muted" style={{ marginTop: "0.35rem", maxWidth: 620 }}>
          Share a link so a client can book a meeting with you. They only see free times inside your working hours, between the dates you
          choose.
        </p>
      </div>
      {!server ? (
        <p className="small muted">Booking links work once you are signed in to a studio with its own database.</p>
      ) : links === null ? (
        <p className="small muted">Loading…</p>
      ) : (
        <>
          {links.length > 0 && (
            <ul className="booking-links">
              {links.map((l) => (
                <li key={l.id} data-active={l.active}>
                  <div className="grow">
                    <strong>{l.title}</strong>
                    <div className="small muted">
                      {length(l.durationMinutes)} · {l.fromDate} to {l.toDate}
                      {projectName(l.projectId) ? ` · ${projectName(l.projectId)}` : ""}
                      {l.toDate < todayISO() ? " · ended" : ""}
                    </div>
                  </div>
                  <label className="row small" style={{ gap: "0.35rem" }}>
                    <input type="checkbox" checked={l.active} onChange={(e) => setActive(l, e.target.checked)} /> Open
                  </label>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(l)} disabled={!l.active}>
                    <Copy size={14} /> Copy link
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Delete ${l.title}`} onClick={() => remove(l)}>
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {creating ? (
            <NewLinkForm
              onDone={(link) => {
                setCreating(false);
                if (link) {
                  setLinks((all) => [link, ...(all ?? [])]);
                  void copy(link);
                }
              }}
            />
          ) : (
            <button type="button" className="btn btn-primary" style={{ justifySelf: "start" }} onClick={() => setCreating(true)}>
              New booking link
            </button>
          )}
          <div>
            <h3 className="field-label" style={{ marginBottom: "0.4rem" }}>Booked meetings</h3>
            {upcoming.length === 0 ? (
              <p className="small muted">Nothing booked yet.</p>
            ) : (
              <ul className="booking-links">
                {upcoming.map((b) => (
                  <li key={b.id}>
                    <div className="grow">
                      <strong>{when(b)}</strong>
                      <div className="small muted">
                        {b.title} · <a href={`mailto:${b.email}`}>{b.email}</a>
                        {projectName(b.projectId) ? ` · ${projectName(b.projectId)}` : ""}
                      </div>
                      {b.note && <div className="small">“{b.note}”</div>}
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancel(b)}>
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function NewLinkForm({ onDone }: { onDone: (link?: BookingLink) => void }) {
  const { projects, toast } = useStudio();
  const today = todayISO();
  const [draft, setDraft] = useState({ title: "Meeting", durationMinutes: 30, fromDate: today, toDate: plusDays(today, 13), note: "", projectId: "" });
  const [busy, setBusy] = useState(false);
  const input = { ...draft, note: draft.note || undefined, projectId: draft.projectId || null };
  const parsed = bookingLinkInput.safeParse(input);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!parsed.success || busy) return;
    setBusy(true);
    try {
      const { link } = await call<{ link: BookingLink }>("/api/booking-links", { method: "POST", body: JSON.stringify(parsed.data) });
      onDone(link);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="booking-form" onSubmit={submit}>
      <label className="field grow" style={{ minWidth: 220 }}>
        <span className="field-label">What the meeting is</span>
        <input className="input" value={draft.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} autoFocus />
      </label>
      <label className="field" style={{ minWidth: 120 }}>
        <span className="field-label">Length</span>
        <select className="input" value={draft.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })}>
          {DURATIONS.map((d) => (
            <option key={d} value={d}>{length(d)}</option>
          ))}
        </select>
      </label>
      <label className="field" style={{ minWidth: 150 }}>
        <span className="field-label">Bookable from</span>
        <input className="input" type="date" value={draft.fromDate} min={today} onChange={(e) => set({ fromDate: e.target.value })} />
      </label>
      <label className="field" style={{ minWidth: 150 }}>
        <span className="field-label">Until</span>
        <input className="input" type="date" value={draft.toDate} min={draft.fromDate} onChange={(e) => set({ toDate: e.target.value })} />
      </label>
      <label className="field" style={{ minWidth: 200 }}>
        <span className="field-label">For a project (optional)</span>
        <select className="input" value={draft.projectId} onChange={(e) => set({ projectId: e.target.value })}>
          <option value="">No project</option>
          {projects.filter((p) => p.status !== "complete").map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        <span className="field-label">Note for the client (optional)</span>
        <textarea className="input" rows={2} maxLength={1000} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {!parsed.success && <p className="small" role="alert" style={{ color: "var(--bad)", gridColumn: "1 / -1" }}>{parsed.error.issues[0]?.message}</p>}
      <div className="row" style={{ gap: "0.5rem", gridColumn: "1 / -1" }}>
        <button type="submit" className="btn btn-primary" disabled={!parsed.success || busy}>
          Create and copy link
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onDone()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
