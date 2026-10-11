/**
 * An iCalendar feed (RFC 5545) that Google Calendar, Apple Calendar and
 * Outlook can subscribe to: tasks and to-dos as all-day events on the day they
 * are due, and booked meetings at their times.
 */

export type FeedEvent =
  | { uid: string; title: string; day: string; description?: string; url?: string; done?: boolean }
  | { uid: string; title: string; start: Date; end: Date; description?: string; url?: string };

/** Escapes text as iCalendar wants it. */
function text(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded onto continuation lines. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (day: string) => day.replace(/-/g, "");

function nextDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function buildIcs(name: string, events: FeedEvent[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fundur//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(name)}`,
    // Calendars that honour it check back hourly.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${text(e.uid)}`, `DTSTAMP:${stamp(now)}`);
    if ("day" in e) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.day)}`, `DTEND;VALUE=DATE:${dateOnly(nextDay(e.day))}`, "TRANSP:TRANSPARENT");
      lines.push(`SUMMARY:${text(e.done ? `✓ ${e.title}` : e.title)}`);
    } else {
      lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, "TRANSP:OPAQUE", `SUMMARY:${text(e.title)}`);
    }
    if (e.description) lines.push(`DESCRIPTION:${text(e.description)}`);
    if (e.url) lines.push(`URL:${text(e.url)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
