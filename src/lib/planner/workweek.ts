import { z } from "zod";

/**
 * The days and hours someone works. Project steps fall due on working days
 * only, and booking links offer times inside working hours only.
 *
 * Days are numbered as JavaScript numbers them: 0 is Sunday, 6 is Saturday.
 * Dates are calendar days as YYYY-MM-DD; times are HH:MM on a 24-hour clock in
 * the person's own time zone.
 */

export interface WorkWeek {
  days: number[];
  start: string;
  end: string;
  /** An IANA time zone, e.g. Africa/Johannesburg. */
  timeZone: string;
}

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

export const DEFAULT_WORK_WEEK: WorkWeek = {
  days: DEFAULT_WORK_DAYS,
  start: "08:00",
  end: "17:00",
  timeZone: "Africa/Johannesburg",
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:30");

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const workWeekInput = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one working day").max(7),
    start: time,
    end: time,
    timeZone: z.string().min(1).max(64).refine(isTimeZone, "Unknown time zone"),
  })
  .refine((w) => w.start < w.end, { message: "The day must end after it starts", path: ["end"] })
  .transform((w) => ({ ...w, days: [...new Set(w.days)].sort((a, b) => a - b) }));

/** The weekday of a calendar day, 0 for Sunday. */
export function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The calendar day `days` after `day`, counted in whole days. */
export function plusDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isWorkDay(day: string, workDays: readonly number[] = DEFAULT_WORK_DAYS): boolean {
  return workDays.length === 0 || workDays.includes(weekday(day));
}

/** The day itself when it is a working day, else the next one. */
export function onOrNextWorkDay(day: string, workDays: readonly number[] = DEFAULT_WORK_DAYS): string {
  let d = day;
  for (let i = 0; i < 7 && !isWorkDay(d, workDays); i++) d = plusDays(d, 1);
  return d;
}

/** The working day `count` working days after `day` (before it when negative). */
export function addWorkDays(day: string, count: number, workDays: readonly number[] = DEFAULT_WORK_DAYS): string {
  if (!workDays.length) return plusDays(day, count);
  let d = day;
  const step = count < 0 ? -1 : 1;
  for (let left = Math.abs(count); left > 0; ) {
    d = plusDays(d, step);
    if (isWorkDay(d, workDays)) left--;
  }
  return d;
}

/** Minutes since midnight for HH:MM. */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** How far ahead of UTC a time zone is at a moment, in minutes. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The moment a wall-clock time on a day in a time zone happens. */
export function zonedTime(day: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minutes);
  // Twice, so a time near a daylight-saving change settles on the right offset.
  let at = new Date(wall - offsetMinutes(new Date(wall), timeZone) * 60_000);
  at = new Date(wall - offsetMinutes(at, timeZone) * 60_000);
  return at;
}

/** The calendar day a moment falls on in a time zone. */
export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** "Mon to Fri, 08:00 to 17:00" */
export function describeWorkWeek(week: WorkWeek): string {
  const short = (d: number) => DAY_NAMES[d].slice(0, 3);
  const days = [...week.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const run = days.length > 2 && days.every((d, i) => i === 0 || (days[i - 1] + 1) % 7 === d);
  const list = run ? `${short(days[0])} to ${short(days[days.length - 1])}` : days.map(short).join(", ");
  return `${list}, ${week.start} to ${week.end}`;
}
