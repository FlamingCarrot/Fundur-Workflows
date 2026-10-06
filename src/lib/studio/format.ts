const DAY = 86_400_000;

function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.getTime();
}

/** "Today", "Tomorrow", "In 3 days", "2 days overdue", or a short date past a week. */
export function relativeDue(due: Date, now = new Date()): { text: string; tone: "overdue" | "soon" | "later" } {
  const diff = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  if (diff < 0) return { text: diff === -1 ? "Due yesterday" : `${-diff} days overdue`, tone: "overdue" };
  if (diff === 0) return { text: "Due today", tone: "soon" };
  if (diff === 1) return { text: "Due tomorrow", tone: "soon" };
  if (diff < 7) return { text: `Due in ${diff} days`, tone: "later" };
  return { text: `Due ${shortDate(due)}`, tone: "later" };
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

export function longToday(now = new Date()): string {
  return now.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function zar(amount: number): string {
  return `R ${amount.toFixed(2)}`;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
