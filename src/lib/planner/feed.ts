import type { Project } from "@/lib/studio/types";
import type { Booking } from "./booking-store";
import { planItems } from "./items";
import type { PlannerState } from "./state";
import type { FeedEvent } from "./ics";

/** How far back done work stays in the feed; open work stays until it is done. */
const DONE_KEPT_DAYS = 30;

/** The events in someone's calendar feed: dated tasks and to-dos, and booked meetings. */
export function feedEvents(projects: Project[], planner: PlannerState, bookings: Booking[], origin: string, now = new Date()): FeedEvent[] {
  const since = new Date(now.getTime() - DONE_KEPT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const events: FeedEvent[] = [];
  for (const item of planItems(projects, planner)) {
    if (!item.due || (item.done && item.due < since)) continue;
    if (item.kind === "task") {
      const t = item.task;
      events.push({
        uid: `${item.ref}@fundur`,
        title: `${t.title} · ${t.project.name}`,
        day: item.due,
        done: item.done,
        url: `${origin}/projects/${t.projectId}/phases/${t.phaseKey}`,
      });
    } else if (item.kind === "todo") {
      events.push({ uid: `${item.ref}@fundur`, title: item.title, day: item.due, done: item.done, url: `${origin}/tasks`, ...(item.todo.notes ? { description: item.todo.notes } : {}) });
    }
  }
  for (const b of bookings) {
    events.push({
      uid: `booking:${b.id}@fundur`,
      title: b.title,
      start: new Date(b.start),
      end: new Date(b.end),
      description: [`${b.name} <${b.email}>`, b.note].filter(Boolean).join("\n"),
    });
  }
  return events;
}
