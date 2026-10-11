import { z } from "zod";
import { dayIn, isWorkDay, minutesOf, plusDays, zonedTime, type WorkWeek } from "./workweek";

/**
 * Booking links: a client picks a time to meet from the owner's working hours,
 * inside the dates the link allows, around what is already booked.
 */

export const DURATIONS = [15, 30, 45, 60, 90, 120];

/** The furthest a link may reach, so a forgotten link cannot be booked years out. */
export const MAX_LINK_DAYS = 180;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");

export const bookingLinkInput = z
  .object({
    title: z.string().trim().min(1, "Name the meeting").max(120),
    durationMinutes: z.number().int().refine((d) => DURATIONS.includes(d), "Pick a length"),
    fromDate: day,
    toDate: day,
    note: z.string().trim().max(1000).optional(),
    /** The project it is for, when it is for one; shown to the owner only. */
    projectId: z.string().max(120).nullable().optional(),
  })
  .refine((l) => l.fromDate <= l.toDate, { message: "The last day must be on or after the first", path: ["toDate"] })
  .refine((l) => daysBetween(l.fromDate, l.toDate) <= MAX_LINK_DAYS, {
    message: `A link can cover at most ${MAX_LINK_DAYS} days`,
    path: ["toDate"],
  });

export type BookingLinkInput = z.infer<typeof bookingLinkInput>;

export const bookingRequest = z.object({
  start: z.string().datetime({ offset: true }),
  name: z.string().trim().min(1, "Add your name").max(120),
  email: z.string().trim().email("Add a valid email").max(254),
  note: z.string().trim().max(1000).optional(),
});

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface Busy {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  workWeek: WorkWeek;
  fromDate: string;
  toDate: string;
  durationMinutes: number;
  busy: Busy[];
  now?: Date;
  /** How soon a client may book, so nobody is surprised by a meeting in ten minutes. */
  noticeMinutes?: number;
}

/**
 * Every start time a client may book: on working days inside the link's dates,
 * from the start of the working day at the meeting's length, finishing by its
 * end, in the future, and clear of anything already booked.
 */
export function availableSlots(q: SlotQuery): Date[] {
  const now = q.now ?? new Date();
  const earliest = now.getTime() + (q.noticeMinutes ?? 120) * 60_000;
  const length = q.durationMinutes * 60_000;
  const open = minutesOf(q.workWeek.start);
  const close = minutesOf(q.workWeek.end);
  const slots: Date[] = [];
  // Never look before today in the owner's time zone.
  const today = dayIn(now, q.workWeek.timeZone);
  for (let d = q.fromDate > today ? q.fromDate : today; d <= q.toDate; d = plusDays(d, 1)) {
    if (!isWorkDay(d, q.workWeek.days)) continue;
    for (let m = open; m + q.durationMinutes <= close; m += q.durationMinutes) {
      const start = zonedTime(d, m, q.workWeek.timeZone);
      const end = start.getTime() + length;
      if (start.getTime() < earliest) continue;
      if (q.busy.some((b) => start.getTime() < b.end.getTime() && end > b.start.getTime())) continue;
      slots.push(start);
    }
  }
  return slots;
}

/** Whether a requested start is one of the times on offer. */
export function isOfferedSlot(start: Date, q: SlotQuery): boolean {
  return availableSlots(q).some((s) => s.getTime() === start.getTime());
}
