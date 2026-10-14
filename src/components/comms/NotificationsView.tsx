"use client";
import { useState } from "react";
import { AtSign, BellRing, BellOff, CalendarClock, CheckCheck, FileText, MessageSquare, Reply, AlarmClock } from "lucide-react";
import { usePlanner } from "@/lib/planner/client";
import { describeWorkWeek } from "@/lib/planner/workweek";
import { alertPermission, useAlertSettings } from "./useDeviceAlerts";
import { StudioLink as Link } from "@/components/shell/StudioNavigation";
import { useStudio } from "@/components/providers/StudioProvider";
import { relativeTime } from "@/lib/studio/format";
import { useNotifications, type InboxItem } from "./useNotifications";
import "./comms.css";

const ICONS: Record<string, typeof AtSign> = { mention: AtSign, reply: Reply, post: MessageSquare, meeting: CalendarClock, notes: FileText, reminder: AlarmClock };

/** Everything that asked for this person's attention in conversations and meetings, newest first. */
export function NotificationsView() {
  const { persistence, getProject } = useStudio();
  const server = persistence === "server";
  const inbox = useNotifications(server);
  const items = inbox.data?.notifications ?? [];
  const open = (n: InboxItem) => {
    if (!n.read) void inbox.markRead([n.id]).catch(() => undefined);
  };
  return (
    <main className="page page-narrow">
      <header className="row-between wrap rise" style={{ marginBottom: "1.5rem", alignItems: "flex-end", gap: "1rem" }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Across every project</p>
          <h1 className="display-l">Notifications</h1>
          <p className="muted" style={{ marginTop: "0.75rem" }}>Mentions, replies, client messages, meetings and meeting notes, newest first.</p>
        </div>
        {server && (inbox.data?.unread ?? 0) > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void inbox.markRead()}>
            <CheckCheck size={15} /> Mark all read
          </button>
        )}
      </header>
      {server && <AlertControls />}
      {!server ? (
        <p className="small muted">In the demo you are the only person here, so nothing comes in. Once you sign in, mentions, replies, client messages, meetings and meeting notes from your team arrive here.</p>
      ) : inbox.error && !inbox.data ? (
        <p className="small cv-problem">{inbox.error}</p>
      ) : !inbox.data ? (
        <p className="small muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="small muted">Nothing yet. When someone mentions you, replies to you or invites you to a meeting, it shows here.</p>
      ) : (
        <ul className="notice-list">
          {items.map((n) => {
            const Icon = ICONS[n.kind] ?? MessageSquare;
            const project = n.projectId ? getProject(n.projectId) : undefined;
            return (
              <li key={n.id}>
                <Link href={n.href} className="notice-item" data-read={n.read ? "true" : "false"} onClick={() => open(n)}>
                  <span className="notice-icon" aria-hidden>
                    <Icon size={16} />
                  </span>
                  <span className="stack" style={{ gap: "0.1rem", minWidth: 0 }}>
                    <span className="small strong">{n.title}</span>
                    {n.body && <span className="small muted notice-body">{n.body}</span>}
                    <span className="tiny muted">
                      {project ? `${project.name} · ` : ""}
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  {!n.read && <span className="notice-dot" aria-label="New" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/** Alerts on this device: on or off, only in working hours, or paused for a while. */
function AlertControls() {
  const [settings, setSettings] = useAlertSettings();
  const { planner } = usePlanner();
  const [permission, setPermission] = useState(alertPermission);
  // When the page opened: a pause that ran out since shows as over on the next visit.
  const [openedAt] = useState(() => Date.now());
  const paused = settings.pausedUntil && Date.parse(settings.pausedUntil) > openedAt ? settings.pausedUntil : null;
  const pause = (until: Date) => setSettings({ ...settings, pausedUntil: until.toISOString() });
  const tomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(Number(planner.workWeek.start.slice(0, 2)), Number(planner.workWeek.start.slice(3)), 0, 0);
    return d;
  };
  if (permission === "unsupported") return null;
  const on = settings.on && permission === "granted";
  return (
    <section className="nt-alerts" aria-label="Alerts on this device">
      <div className="row-between wrap" style={{ gap: "0.5rem" }}>
        <p className="small" style={{ margin: 0 }}>
          {on ? <BellRing size={15} /> : <BellOff size={15} />}{" "}
          {on ? (paused ? `Alerts paused until ${new Date(paused).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : "Alerts are on for this device") : "Get an alert on this device when something comes in"}
        </p>
        {!on ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={permission === "denied"}
            title={permission === "denied" ? "Alerts are blocked for this site in the browser's settings" : undefined}
            onClick={async () => {
              const next = permission === "granted" ? "granted" : await Notification.requestPermission();
              setPermission(next);
              if (next === "granted") setSettings({ ...settings, on: true, pausedUntil: null });
            }}
          >
            Turn on alerts
          </button>
        ) : (
          <div className="row wrap" style={{ gap: "0.35rem" }}>
            {paused ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSettings({ ...settings, pausedUntil: null })}>
                Resume
              </button>
            ) : (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pause(new Date(Date.now() + 3_600_000))}>
                  Pause 1 hour
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => pause(tomorrow())}>
                  Pause until tomorrow
                </button>
              </>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSettings({ ...settings, on: false })}>
              Turn off
            </button>
          </div>
        )}
      </div>
      {permission === "denied" && <p className="tiny muted" style={{ margin: 0 }}>This browser blocks alerts from Fundur. Allow them in the site settings, then come back.</p>}
      {on && (
        <label className="tiny muted row" style={{ gap: "0.4rem" }}>
          <input type="checkbox" checked={settings.workingHoursOnly} onChange={(e) => setSettings({ ...settings, workingHoursOnly: e.target.checked })} />
          Only in my working hours ({describeWorkWeek(planner.workWeek)}). <Link href="/calendar/settings">Change them</Link>
        </label>
      )}
    </section>
  );
}
