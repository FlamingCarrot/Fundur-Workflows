import { dayToDate, toDay, type ProjectTask } from "./tasks";

/**
 * The day, week and month views (P2-04, P2-05). Week and month are built from
 * the same weeks, so switching between them keeps the same tasks and the same
 * selected day.
 */

export interface CalendarDay {
  day: string;
  inRange: boolean;
  isToday: boolean;
  tasks: ProjectTask[];
}

export interface CalendarWeek {
  /** The Monday the week starts on. */
  start: string;
  days: CalendarDay[];
  /** How busy the week is next to the others shown, 0 to 1 (P2-05). */
  density: number;
}

export function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: string, months: number): string {
  const [y, m] = day.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}

export function addDays(day: string, days: number): string {
  // Noon keeps a daylight-saving change from moving the date.
  const d = dayToDate(day);
  d.setHours(12);
  d.setDate(d.getDate() + days);
  return toDay(d);
}

/** The Monday of the week a day falls in; weeks start on Monday, as a working week does. */
export function startOfWeek(day: string): string {
  const d = dayToDate(day);
  const back = (d.getDay() + 6) % 7;
  return addDays(day, -back);
}

export type CalendarView = "day" | "week" | "month";

export const CALENDAR_VIEWS: CalendarView[] = ["day", "week", "month"];

/** The same day of the month `months` months on, or the month's last day when it is shorter. */
export function shiftMonths(day: string, months: number): string {
  const first = addMonths(day, months);
  const last = addDays(addMonths(first, 1), -1);
  const date = `${first.slice(0, 8)}${day.slice(8, 10)}`;
  return date > last ? last : date;
}

/** The day one view-length earlier or later: a day, a week or a month. */
export function stepDay(view: CalendarView, day: string, direction: number): string {
  if (view === "month") return shiftMonths(day, direction);
  return addDays(day, direction * (view === "week" ? 7 : 1));
}

export function monthName(day: string): string {
  return dayToDate(day).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

export function dayName(day: string): string {
  return dayToDate(day).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** "5 to 11 October 2026", or across a month or year end as needed. */
export function weekName(day: string): string {
  const first = dayToDate(startOfWeek(day));
  const last = dayToDate(addDays(startOfWeek(day), 6));
  const sameYear = first.getFullYear() === last.getFullYear();
  const sameMonth = sameYear && first.getMonth() === last.getMonth();
  const from = first.toLocaleDateString("en-ZA", sameMonth ? { day: "numeric" } : sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" });
  const to = last.toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });
  return `${from} to ${to}`;
}

/**
 * Weeks covering whole months from `from` (inclusive) for `months` months,
 * with each task on its due date. The month view asks for one month.
 */
export function buildWeeks(
  from: string,
  months: number,
  tasks: ProjectTask[],
  today = toDay(new Date())
): CalendarWeek[] {
  const first = startOfMonth(from);
  return buildSpan(first, addMonths(first, months), tasks, today);
}

/** The one week a day falls in, Monday to Sunday, for the week view. */
export function buildWeek(day: string, tasks: ProjectTask[], today = toDay(new Date())): CalendarWeek {
  const first = startOfWeek(day);
  return buildSpan(first, addDays(first, 7), tasks, today)[0];
}

/** Whole weeks covering `first` (inclusive) to `end` (exclusive). */
function buildSpan(first: string, end: string, tasks: ProjectTask[], today: string): CalendarWeek[] {
  const byDay = new Map<string, ProjectTask[]>();
  for (const task of tasks) {
    if (!task.due || task.due < first || task.due >= end) continue;
    const list = byDay.get(task.due);
    if (list) list.push(task);
    else byDay.set(task.due, [task]);
  }

  const weeks: CalendarWeek[] = [];
  for (let start = startOfWeek(first); start < end; start = addDays(start, 7)) {
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      days.push({
        day,
        inRange: day >= first && day < end,
        isToday: day === today,
        tasks: byDay.get(day) ?? [],
      });
    }
    weeks.push({ start, days, density: 0 });
  }

  // Density is relative to the busiest week shown, so a quiet month does not look full.
  const busiest = Math.max(1, ...weeks.map((w) => w.days.reduce((n, d) => n + d.tasks.length, 0)));
  return weeks.map((w) => ({
    ...w,
    density: w.days.reduce((n, d) => n + d.tasks.length, 0) / busiest,
  }));
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
