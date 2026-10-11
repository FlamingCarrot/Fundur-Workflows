"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { PublicLink } from "@/lib/planner/booking-store";

const length = (m: number) => (m < 60 ? `${m} minutes` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m === 60 ? "1 hour" : `${m / 60} hours`);

/** The day and time of a moment in a time zone, for grouping and showing slots. */
function inZone(iso: string, timeZone: string) {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d),
    dayLabel: d.toLocaleDateString(undefined, { timeZone, weekday: "long", day: "numeric", month: "long" }),
    time: d.toLocaleTimeString(undefined, { timeZone, hour: "2-digit", minute: "2-digit" }),
  };
}

/**
 * What a client sees when they open a booking link: free times grouped by day,
 * then a short form for their name and email.
 */
export function BookingPage({ token }: { token: string }) {
  const endpoint = `/api/book/${token}`;
  const [link, setLink] = useState<PublicLink | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<{ title: string; start: string; end: string } | null>(null);
  const local = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [zone, setZone] = useState<"theirs" | "mine">("mine");

  const load = async () => {
    const res = await fetch(endpoint, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "This booking link is not available");
    return body as PublicLink;
  };

  useEffect(() => {
    load().then(setLink, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per link
  }, [endpoint]);

  const timeZone = zone === "theirs" && link ? link.timeZone : local;
  const days = useMemo(() => {
    const groups: { day: string; label: string; slots: { iso: string; time: string }[] }[] = [];
    for (const iso of link?.slots ?? []) {
      const z = inZone(iso, timeZone);
      const last = groups[groups.length - 1];
      if (last?.day === z.day) last.slots.push({ iso, time: z.time });
      else groups.push({ day: z.day, label: z.dayLabel, slots: [{ iso, time: z.time }] });
    }
    return groups;
  }, [link, timeZone]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start: picked, name: form.name, email: form.email, note: form.note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "That didn't work. Try again.");
        if (res.status === 409) {
          setPicked(null);
          setLink(await load().catch(() => link));
        }
        return;
      }
      setBooked(body.booking);
    } finally {
      setBusy(false);
    }
  };

  if (booked) {
    const s = inZone(booked.start, timeZone);
    const e = inZone(booked.end, timeZone);
    return (
      <main className="book-page">
        <div className="card book-card">
          <p className="eyebrow">Booked</p>
          <h1 className="display-m">{booked.title}</h1>
          <p>
            {s.dayLabel}, {s.time}–{e.time}
          </p>
          <p className="small muted">{link?.owner} has it in their calendar. If you need to change it, reply to them directly.</p>
        </div>
      </main>
    );
  }

  if (!link) {
    return (
      <main className="book-page">
        <div className="card book-card">
          {error ? (
            <>
              <h1 className="display-s">{error}</h1>
              <p className="small muted">The link may have been closed or replaced. Ask for a new one.</p>
            </>
          ) : (
            <p className="muted">Loading…</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="book-page">
      <div className="card book-card">
        <p className="eyebrow">{link.owner}</p>
        <h1 className="display-m">{link.title}</h1>
        <p className="small muted">{length(link.durationMinutes)}</p>
        {link.note && <p style={{ whiteSpace: "pre-wrap" }}>{link.note}</p>}

        {link.timeZone !== local && (
          <div className="row wrap small" style={{ gap: "0.5rem" }} role="group" aria-label="Show times in">
            <span className="muted">Times in</span>
            <button type="button" className="chip" aria-pressed={zone === "mine"} onClick={() => setZone("mine")}>
              Your time ({local.replaceAll("_", " ")})
            </button>
            <button type="button" className="chip" aria-pressed={zone === "theirs"} onClick={() => setZone("theirs")}>
              {link.owner}&apos;s time ({link.timeZone.replaceAll("_", " ")})
            </button>
          </div>
        )}

        {days.length === 0 ? (
          <p>No times are open on this link right now. Ask {link.owner} for another time.</p>
        ) : (
          <div className="book-days">
            {days.map((d) => (
              <section key={d.day}>
                <h2 className="field-label">{d.label}</h2>
                <div className="book-slots">
                  {d.slots.map((s) => (
                    <button key={s.iso} type="button" className="chip" aria-pressed={picked === s.iso} onClick={() => setPicked(s.iso)}>
                      {s.time}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {picked && (
          <form className="book-form" onSubmit={submit}>
            <p>
              <strong>
                {inZone(picked, timeZone).dayLabel}, {inZone(picked, timeZone).time}
              </strong>
            </p>
            <label className="field">
              <span className="field-label">Your name</span>
              <input className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
            </label>
            <label className="field">
              <span className="field-label">Your email</span>
              <input className="input" type="email" required maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
            </label>
            <label className="field">
              <span className="field-label">Anything to add (optional)</span>
              <textarea className="input" rows={3} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Book this time
            </button>
          </form>
        )}
        {error && <p role="alert" className="small" style={{ color: "var(--bad)" }}>{error}</p>}
      </div>
    </main>
  );
}
