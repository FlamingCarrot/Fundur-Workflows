"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { usePlanner } from "@/lib/planner/client";
import { DAY_NAMES, describeWorkWeek, workWeekInput, type WorkWeek } from "@/lib/planner/workweek";
import { CalendarSync } from "./CalendarSync";
import { BookingLinks } from "./BookingLinks";

/** Monday first, as a working week reads. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * Calendar settings: the working week (new projects plan their steps on
 * working days, and booking links offer times inside working hours), a feed to
 * follow in their own calendar, and links clients can book time with.
 */
export function CalendarSettingsView() {
  const { ready } = useStudio();
  const { ready: plannerReady } = usePlanner();
  return (
    <main className="page">
      <WhenReady ready={ready && plannerReady}>
        <header className="rise" style={{ marginBottom: "1.75rem" }}>
          <Link href="/calendar" className="btn btn-ghost btn-sm" style={{ marginBottom: "1rem" }}>
            <ArrowLeft size={15} /> Calendar
          </Link>
          <h1 className="display-l">Calendar settings</h1>
        </header>
        <WorkWeekForm />
        <CalendarSync />
        <BookingLinks />
      </WhenReady>
    </main>
  );
}

function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

function WorkWeekForm() {
  const { toast } = useStudio();
  const { planner, change } = usePlanner();
  const saved = planner.workWeek;
  const [draft, setDraft] = useState<WorkWeek>(saved);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => timeZones(draft.timeZone), [draft.timeZone]);
  const here = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const parsed = workWeekInput.safeParse(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const toggleDay = (d: number) =>
    setDraft((w) => ({ ...w, days: w.days.includes(d) ? w.days.filter((x) => x !== d) : [...w.days, d].sort((a, b) => a - b) }));

  const save = async () => {
    if (!parsed.success) return;
    setBusy(true);
    try {
      await change({ type: "setWorkWeek", workWeek: parsed.data });
      toast("Working week saved");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card settings-section rise" style={{ ["--i" as string]: 1 }}>
      <div>
        <h2 className="display-s">Working week</h2>
        <p className="small muted" style={{ marginTop: "0.35rem", maxWidth: 620 }}>
          New projects plan their steps on your working days only; a step that would land on a day off moves to the next working day.
          Booking links only offer times inside your working hours. Now: {describeWorkWeek(saved)}.
        </p>
      </div>
      <div className="weekday-picks" role="group" aria-label="Working days">
        {WEEK_ORDER.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={draft.days.includes(d)} onClick={() => toggleDay(d)}>
            {DAY_NAMES[d].slice(0, 3)}
          </button>
        ))}
      </div>
      <div className="row wrap" style={{ gap: "0.75rem" }}>
        <label className="field" style={{ minWidth: 130 }}>
          <span className="field-label">Day starts</span>
          <input className="input" type="time" value={draft.start} onChange={(e) => setDraft((w) => ({ ...w, start: e.target.value }))} />
        </label>
        <label className="field" style={{ minWidth: 130 }}>
          <span className="field-label">Day ends</span>
          <input className="input" type="time" value={draft.end} onChange={(e) => setDraft((w) => ({ ...w, end: e.target.value }))} />
        </label>
        <label className="field grow" style={{ minWidth: 220 }}>
          <span className="field-label">Time zone</span>
          <select className="input" value={draft.timeZone} onChange={(e) => setDraft((w) => ({ ...w, timeZone: e.target.value }))}>
            {zones.map((z) => (
              <option key={z} value={z}>{z.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
      </div>
      {here && here !== draft.timeZone && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: "start" }} onClick={() => setDraft((w) => ({ ...w, timeZone: here }))}>
          Use this device&apos;s time zone ({here.replaceAll("_", " ")})
        </button>
      )}
      {!parsed.success && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{parsed.error.issues[0]?.message}</p>}
      <div className="row" style={{ gap: "0.5rem" }}>
        <button type="button" className="btn btn-primary" disabled={!dirty || !parsed.success || busy} onClick={save}>
          Save working week
        </button>
        {dirty && (
          <button type="button" className="btn btn-ghost" onClick={() => setDraft(saved)}>
            Undo changes
          </button>
        )}
      </div>
    </section>
  );
}
