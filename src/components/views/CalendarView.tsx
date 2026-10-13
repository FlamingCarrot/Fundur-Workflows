"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import {
  addDays,
  buildWeek,
  buildWeeks,
  CALENDAR_VIEWS,
  dayName,
  monthName,
  startOfMonth,
  stepDay,
  WEEKDAYS,
  weekName,
  type CalendarView as View,
  type CalendarWeek,
} from "@/lib/studio/calendar";
import { dayToDate, toDay } from "@/lib/studio/tasks";
import { shortDate } from "@/lib/studio/format";
import { usePlanner } from "@/lib/planner/client";
import { planItems, type PlanItem } from "@/lib/planner/items";
import { describeWorkWeek, isWorkDay } from "@/lib/planner/workweek";
import type { Booking } from "@/lib/planner/booking-store";
import { ItemRow } from "./TasksView";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";
import { ScheduleMeetingButton, meetingPath, useProjectMeetings } from "@/components/comms/CalendarMeetings";

const VIEW_LABEL: Record<View, string> = { day: "Day", week: "Week", month: "Month" };
const isView = oneOf(CALENDAR_VIEWS);

/**
 * Every project's tasks and their own to-dos on the dates they are due
 * (P2-04), by day, week or month (P2-05). Days outside the working week are
 * shaded. The view last picked is remembered; the calendar always opens
 * on today. Switching views keeps the day that is selected.
 */
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** A meeting on the calendar: one a client booked, or a project's video call. */
type CalendarMeeting = Pick<Booking, "id" | "title" | "start" | "end"> & { email?: string; href?: string };

/**
 * Meetings by local day, for the months around a day: what clients booked
 * through booking links (server studios only) and every project's video calls.
 */
function useBookings(around: string, version: number): Map<string, CalendarMeeting[]> {
  const { persistence, getProject } = useStudio();
  const month = around.slice(0, 7);
  const [bookings, setBookings] = useState<Booking[]>([]);
  useEffect(() => {
    if (persistence !== "server") return;
    const controller = new AbortController();
    const from = addDays(`${month}-01`, -45);
    const to = addDays(`${month}-01`, 75);
    fetch(`/api/bookings?from=${from}&to=${to}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : { bookings: [] }))
      .then((r: { bookings: Booking[] }) => setBookings(r.bookings), () => undefined);
    return () => controller.abort();
  }, [persistence, month]);
  const calls = useProjectMeetings(addDays(`${month}-01`, -45), addDays(`${month}-01`, 75), version);
  const all: CalendarMeeting[] = [
    ...bookings,
    ...calls.map((m) => ({
      id: m.id,
      title: `${m.title}${getProject(m.projectId) ? ` · ${getProject(m.projectId)!.name}` : ""}`,
      start: m.startsAt,
      end: new Date(Date.parse(m.startsAt) + m.durationMin * 60_000).toISOString(),
      href: meetingPath(m),
    })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  const byDay = new Map<string, CalendarMeeting[]>();
  for (const b of all) {
    const day = toDay(new Date(b.start));
    byDay.set(day, [...(byDay.get(day) ?? []), b]);
  }
  return byDay;
}

export function CalendarView() {
  const { projects, ready } = useStudio();
  const { planner, ready: plannerReady } = usePlanner();
  const today = toDay(new Date());
  const [view, setView] = useViewSetting<View>("calendar.view", "week", isView);
  const [selected, setSelected] = useState(today);
  const [scheduled, setScheduled] = useState(0);
  const meetings = useBookings(selected, scheduled);

  const active = projects.filter((p) => p.status === "active");
  // Done tasks stay on the calendar: what happened is as useful as what is left.
  const tasks = planItems(active, planner);
  const open = tasks.filter((t) => !t.done);
  const workDays = planner.workWeek.days;

  const weeks = view === "month" ? buildWeeks(startOfMonth(selected), 1, tasks, today) : view === "week" ? [buildWeek(selected, tasks, today)] : [];
  const title = view === "month" ? monthName(selected) : view === "week" ? weekName(selected) : dayName(selected);

  const step = (direction: number) => setSelected(stepDay(view, selected, direction));
  const selectedTasks = tasks.filter((t) => t.due === selected);
  const selectedMeetings = meetings.get(selected) ?? [];

  return (
    <main className="page">
      <WhenReady ready={ready && plannerReady}>
        <header className="rise" style={{ marginBottom: "1.5rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Across every project</p>
          <h1 className="display-l">Calendar</h1>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {open.length} open {open.length === 1 ? "task" : "tasks"} across {active.length}{" "}
            {active.length === 1 ? "project" : "projects"} and your own to-dos.{view === "month" && " A fuller week is a darker bar."}
          </p>
          <div className="row wrap" style={{ gap: "0.5rem", marginTop: "0.75rem" }}>
            <Link href="/calendar/settings" className="btn btn-ghost btn-sm">
              <Settings2 size={15} /> {describeWorkWeek(planner.workWeek)} · Calendar settings
            </Link>
            <ScheduleMeetingButton day={selected} onScheduled={() => setScheduled((n) => n + 1)} />
          </div>
        </header>

        <div className="row-between wrap rise" style={{ ["--i" as string]: 1, gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div className="row" style={{ gap: "0.5rem" }}>
            <button type="button" className="icon-btn" aria-label="Earlier" onClick={() => step(-1)}>
              <ChevronLeft size={18} />
            </button>
            <h2 className="display-s" style={{ minWidth: "11ch" }} aria-live="polite">{title}</h2>
            <button type="button" className="icon-btn" aria-label="Later" onClick={() => step(1)}>
              <ChevronRight size={18} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(today)}>
              Today
            </button>
          </div>
          <div className="segmented" role="group" aria-label="View">
            {CALENDAR_VIEWS.map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </div>
        </div>

        {weeks.length > 0 && (
          <div className="calendar rise" style={{ ["--i" as string]: 2 }}>
            <div className="calendar-head">
              {WEEKDAYS.map((d) => (
                <span key={d} className="eyebrow">{d}</span>
              ))}
            </div>
            {weeks.map((week) => (
              <Week key={week.start} week={week} tall={view === "week"} selected={selected} onSelect={setSelected} workDays={workDays} meetings={meetings} />
            ))}
          </div>
        )}

        <section className="rise" style={{ ["--i" as string]: view === "day" ? 2 : 3, marginTop: view === "day" ? 0 : "2rem" }}>
          {view !== "day" && (
            <div className="section-title">
              <h2>
                {shortDate(dayToDate(selected))}
                <span className="count">{selectedTasks.length + selectedMeetings.length}</span>
              </h2>
            </div>
          )}
          {selectedMeetings.length > 0 && (
            <div className="card checklist" style={{ marginBottom: "0.75rem" }}>
              {selectedMeetings.map((b) => (
                <div key={b.id} className="calendar-meeting">
                  <strong>{time(b.start)}–{time(b.end)}</strong>{" "}
                  {b.href ? <Link href={b.href}>{b.title}</Link> : b.title}
                  {b.email && <a className="small muted" href={`mailto:${b.email}`}>{b.email}</a>}
                </div>
              ))}
            </div>
          )}
          {selectedTasks.length === 0 ? (
            selectedMeetings.length === 0 && <p className="muted">Nothing due that day.</p>
          ) : (
            <div className="card checklist">
              {selectedTasks.map((task) => (
                <ItemRow key={task.ref} item={task} />
              ))}
            </div>
          )}
        </section>
      </WhenReady>
    </main>
  );
}

function Week({
  week,
  tall,
  selected,
  onSelect,
  workDays,
  meetings,
}: {
  week: CalendarWeek<PlanItem>;
  workDays: number[];
  meetings: Map<string, CalendarMeeting[]>;
  /** The week view: taller days with every task on them, not the first three. */
  tall: boolean;
  selected: string;
  onSelect: (day: string) => void;
}) {
  const limit = tall ? Infinity : 3;
  return (
    <div className="calendar-week" data-tall={tall}>
      <span className="calendar-density" style={{ ["--density" as string]: week.density }} aria-hidden />
      {week.days.map((day) => {
        const booked = meetings.get(day.day) ?? [];
        const count = booked.length + day.tasks.length;
        return (
        <button
          key={day.day}
          type="button"
          className="calendar-day"
          data-in-range={day.inRange}
          data-today={day.isToday}
          data-off={!isWorkDay(day.day, workDays)}
          aria-pressed={selected === day.day}
          aria-label={`${shortDate(dayToDate(day.day))}, ${day.tasks.length} due${booked.length ? `, ${booked.length} booked` : ""}`}
          onClick={() => onSelect(day.day)}
        >
          <span className="calendar-date">{Number(day.day.slice(8))}</span>
          <span className="calendar-entries">
            {booked.map((b) => (
              <span key={b.id} className="calendar-entry" data-meeting="true">
                {time(b.start)} {b.title}
              </span>
            ))}
            {day.tasks.slice(0, Math.max(0, limit - booked.length)).map((t) => (
              <span
                key={t.ref}
                className="calendar-entry"
                style={t.kind === "task" ? swatchVar(t.task.project.swatch) : { ["--swatch" as string]: "var(--ink-3)" }}
                data-done={t.done}
              >
                {t.title}
              </span>
            ))}
            {count > Math.max(limit, booked.length) && <span className="tiny muted">+{count - Math.max(limit, booked.length)} more</span>}
          </span>
        </button>
        );
      })}
    </div>
  );
}
