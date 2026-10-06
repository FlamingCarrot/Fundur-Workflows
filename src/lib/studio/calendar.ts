import { dayToDate, toDay, type ProjectTask } from "./tasks";

/**
 * The month and quarter views (P2-04, P2-05). Both are built from the same
 * weeks, so switching between them keeps the same tasks and the same selection.
 */

const DAY = 86_400_000;

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

/** The quarter a day falls in, as its first month. */
export function startOfQuarter(day: string): string {
  const month = Number(day.slice(5, 7));
  return `${day.slice(0, 4)}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
}

/** The Monday of the week a day falls in; weeks start on Monday, as a working week does. */
export function startOfWeek(day: string): string {
  const d = dayToDate(day);
  const back = (d.getDay() + 6) % 7;
  return toDay(new Date(d.getTime() - back * DAY));
}

export function monthName(day: string): string {
  return dayToDate(day).toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
}

export function shortMonthName(day: string): string {
  return dayToDate(day).toLocaleDateString("en-ZA", { month: "short" });
}

/**
 * Weeks covering whole months from `from` (inclusive) for `months` months,
 * with each task on its due date. A month view asks for one month, a quarter
 * view for three.
 */
export function buildWeeks(
  from: string,
  months: number,
  tasks: ProjectTask[],
  today = toDay(new Date())
): CalendarWeek[] {
  const first = startOfMonth(from);
  const end = addMonths(first, months);
  const byDay = new Map<string, ProjectTask[]>();
  for (const task of tasks) {
    if (!task.due || task.due < first || task.due >= end) continue;
    const list = byDay.get(task.due);
    if (list) list.push(task);
    else byDay.set(task.due, [task]);
  }

  const weeks: CalendarWeek[] = [];
  for (let start = startOfWeek(first); start < end; start = toDay(new Date(dayToDate(start).getTime() + 7 * DAY))) {
    const days: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = toDay(new Date(dayToDate(start).getTime() + i * DAY));
      days.push({
        day,
        inRange: day >= first && day < end,
        isToday: day === today,
        tasks: byDay.get(day) ?? [],
      });
    }
    weeks.push({ start, days, density: 0 });
  }

  // Density is relative to the busiest week shown, so a quiet quarter does not look full.
  const busiest = Math.max(1, ...weeks.map((w) => w.days.reduce((n, d) => n + d.tasks.length, 0)));
  return weeks.map((w) => ({
    ...w,
    density: w.days.reduce((n, d) => n + d.tasks.length, 0) / busiest,
  }));
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
