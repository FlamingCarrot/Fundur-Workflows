"use client";
import { AtSign, CalendarClock, CheckCheck, FileText, MessageSquare, Reply } from "lucide-react";
import { StudioLink as Link } from "@/components/shell/StudioNavigation";
import { useStudio } from "@/components/providers/StudioProvider";
import { relativeTime } from "@/lib/studio/format";
import { useNotifications, type InboxItem } from "./useNotifications";
import "./comms.css";

const ICONS: Record<string, typeof AtSign> = { mention: AtSign, reply: Reply, post: MessageSquare, meeting: CalendarClock, notes: FileText };

/** Everything that asked for this person's attention in conversations and meetings, newest first. */
export function InboxView() {
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
          <h1 className="display-l">Inbox</h1>
          <p className="muted" style={{ marginTop: "0.75rem" }}>Mentions, replies, client messages, meetings and meeting notes, newest first.</p>
        </div>
        {server && (inbox.data?.unread ?? 0) > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void inbox.markRead()}>
            <CheckCheck size={15} /> Mark all read
          </button>
        )}
      </header>
      {!server ? (
        <p className="small muted">In the demo you are the only person here, so nothing comes in. Once you sign in, mentions, replies, client messages, meetings and meeting notes from your team arrive here.</p>
      ) : inbox.error && !inbox.data ? (
        <p className="small cv-problem">{inbox.error}</p>
      ) : !inbox.data ? (
        <p className="small muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="small muted">Nothing yet. When someone mentions you, replies to you or invites you to a meeting, it shows here.</p>
      ) : (
        <ul className="inbox-list">
          {items.map((n) => {
            const Icon = ICONS[n.kind] ?? MessageSquare;
            const project = n.projectId ? getProject(n.projectId) : undefined;
            return (
              <li key={n.id}>
                <Link href={n.href} className="inbox-item" data-read={n.read ? "true" : "false"} onClick={() => open(n)}>
                  <span className="inbox-icon" aria-hidden>
                    <Icon size={16} />
                  </span>
                  <span className="stack" style={{ gap: "0.1rem", minWidth: 0 }}>
                    <span className="small strong">{n.title}</span>
                    {n.body && <span className="small muted inbox-body">{n.body}</span>}
                    <span className="tiny muted">
                      {project ? `${project.name} · ` : ""}
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  {!n.read && <span className="inbox-dot" aria-label="New" />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
