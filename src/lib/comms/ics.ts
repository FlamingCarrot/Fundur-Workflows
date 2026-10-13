import type { Meeting } from "./types";

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");
const icsTime = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const RRULE: Record<string, string> = { weekly: "FREQ=WEEKLY", fortnightly: "FREQ=WEEKLY;INTERVAL=2", monthly: "FREQ=MONTHLY" };

/** A calendar file for the meeting (Outlook, Google, Apple), with its link to join. */
export function meetingIcs(m: Pick<Meeting, "id" | "title" | "agenda" | "startsAt" | "durationMin" | "status"> & { repeat?: Meeting["repeat"] }, url: string): string {
  const start = new Date(m.startsAt);
  const end = new Date(start.getTime() + m.durationMin * 60_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fundur//Meetings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${m.status === "cancelled" ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${m.id}@fundur`,
    `DTSTAMP:${icsTime(new Date())}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(end)}`,
    // A repeating meeting goes in the calendar as a series; its page links on to the next one.
    ...(m.repeat && RRULE[m.repeat] && m.status !== "cancelled" ? [`RRULE:${RRULE[m.repeat]}`] : []),
    `SUMMARY:${icsText(m.title)}`,
    `DESCRIPTION:${icsText(`${m.agenda ? `${m.agenda}\n\n` : ""}Join: ${url}`)}`,
    `URL:${url}`,
    `LOCATION:${icsText(url)}`,
    ...(m.status === "cancelled" ? ["STATUS:CANCELLED"] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT10M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(m.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // Lines longer than 75 octets fold onto the next line, as the format asks.
  return lines.map((l) => (l.length > 60 ? l.match(/.{1,60}/g)!.join("\r\n ") : l)).join("\r\n") + "\r\n";
}
