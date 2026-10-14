import type { WorkWeek } from "@/lib/planner/workweek";

/**
 * Alerts on this device for new notifications (mentions, replies, client
 * messages, meeting reminders): on or off, paused for a while, or only in the
 * person's working hours, as Slack's "Pause notifications" and quiet hours.
 */
export interface AlertSettings {
  on: boolean;
  /** No alerts until then (an ISO time). */
  pausedUntil: string | null;
  /** No alerts outside the working days and hours of the person's week. */
  workingHoursOnly: boolean;
}

export const DEFAULT_ALERTS: AlertSettings = { on: false, pausedUntil: null, workingHoursOnly: true };

export function isAlertSettings(v: unknown): v is AlertSettings {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return typeof a.on === "boolean" && typeof a.workingHoursOnly === "boolean" && (a.pausedUntil === null || (typeof a.pausedUntil === "string" && !Number.isNaN(Date.parse(a.pausedUntil))));
}

/** Whether a moment falls on a working day, inside working hours, in the week's own time zone. */
export function inWorkingHours(week: WorkWeek, at: Date): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: week.timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  } catch {
    return true;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const time = `${get("hour")}:${get("minute")}`;
  return week.days.includes(day) && time >= week.start && time < week.end;
}

/** Whether to alert now. */
export function shouldAlert(s: AlertSettings, week: WorkWeek, at: Date): boolean {
  if (!s.on) return false;
  if (s.pausedUntil && Date.parse(s.pausedUntil) > at.getTime()) return false;
  return !s.workingHoursOnly || inWorkingHours(week, at);
}
