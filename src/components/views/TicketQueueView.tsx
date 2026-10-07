"use client";

import React, { useEffect, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { ISSUE_STATUS_LABEL, ISSUE_STATUS_TAG, moduleName } from "@/components/shell/IssueSheet";
import { relativeTime } from "@/lib/studio/format";
import { isActiveIssue, type IssueStatus } from "@/lib/studio/types";
import type { Ticket } from "@/lib/issues/store";
import { SUPPORT_TOPICS, type SupportTopic } from "@/lib/support/types";
import { SettingsTabs } from "./SettingsTabs";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";

/** How often the queue checks for new reports. */
const POLL_MS = 5_000;

const FILTER_KEYS = ["active", "resolved", "closed", "all"] as const;
type Filter = (typeof FILTER_KEYS)[number];

const KINDS = ["all", "support", "issue"] as const;
type KindFilter = (typeof KINDS)[number];
const KIND_LABEL: Record<KindFilter, string> = { all: "Everything", support: "Support requests", issue: "Issue reports" };

const FILTERS: { key: Filter; label: string; match: (t: Ticket) => boolean }[] = [
  { key: "active", label: "Open", match: isActiveIssue },
  { key: "resolved", label: "Resolved", match: (t) => t.status === "resolved" },
  { key: "closed", label: "Closed by reporter", match: (t) => t.status === "closed" },
  { key: "all", label: "All", match: () => true },
];

const isFilter = oneOf(FILTER_KEYS);
const isKind = oneOf(KINDS);

const ADMIN_STATUSES: Exclude<IssueStatus, "closed">[] = ["open", "in_progress", "resolved"];

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

/**
 * The Admin's ticket queue (P1-19): every issue report on the platform, with
 * its module, page and note. New reports arrive within a few seconds.
 */
export function TicketQueueView() {
  const { toast } = useStudio();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useViewSetting<Filter>("tickets.filter", "active", isFilter);
  const [kind, setKind] = useViewSetting<KindFilter>("tickets.kind", "all", isKind);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      call<{ tickets: Ticket[] }>("/api/admin/issues").then(
        ({ tickets: list }) => {
          if (cancelled) return;
          setTickets(list);
          setLoadError(null);
        },
        (err: Error) => !cancelled && setLoadError(err.message)
      ).finally(() => {
        if (!cancelled) timer = setTimeout(poll, POLL_MS);
      });
    };
    poll();
    document.addEventListener("visibilitychange", poll);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  const save = (id: string, change: { status?: IssueStatus; adminNote?: string }) => {
    setTickets((list) => list?.map((t) => (t.id === id ? { ...t, ...change } : t)) ?? null);
    return call<{ ticket: Ticket }>(`/api/admin/issues/${id}`, { method: "PATCH", body: JSON.stringify(change) }).then(
      ({ ticket }) => {
        setTickets((list) => list?.map((t) => (t.id === id ? ticket : t)) ?? null);
        return true;
      },
      (err: Error) => {
        toast(`That didn't save: ${err.message}`);
        return false;
      }
    );
  };

  const reply = (id: string, body: string) =>
    call<{ ticket: Ticket }>(`/api/admin/issues/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }).then(
      ({ ticket }) => {
        setTickets((list) => list?.map((t) => (t.id === id ? ticket : t)) ?? null);
        return true;
      },
      (err: Error) => {
        toast(`That didn't send: ${err.message}`);
        return false;
      }
    );

  const active = FILTERS.find((f) => f.key === filter)!;
  const ofKind = tickets?.filter((t) => kind === "all" || t.kind === kind) ?? [];
  const shown = ofKind.filter(active.match);

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin</p>
        <h1 className="display-l">Tickets</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Support requests and reported issues from everyone. Issues show the part of the app and the page they came
          from. Your replies show to the person who sent them.
        </p>
      </header>

      {loadError && !tickets && (
        <div className="card" style={{ padding: "1.25rem 1.4rem", color: "var(--bad)" }}>{loadError}</div>
      )}

      {tickets && (
        <>
          <div className="segmented segmented-sm rise" role="group" aria-label="Kind" style={{ marginBottom: "0.75rem", flexWrap: "wrap" }}>
            {KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="segmented rise" role="group" aria-label="Show" style={{ marginBottom: "1.5rem", flexWrap: "wrap", display: "flex", width: "fit-content" }}>
            {FILTERS.map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label} {ofKind.filter(f.match).length}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="muted">{filter === "active" ? "Nothing open. All clear." : "Nothing here."}</p>
          ) : (
            <div className="stack" style={{ gap: "1rem" }}>
              {shown.map((t) => (
                t.kind === "support" ? (
                  <SupportTicketCard key={t.id} ticket={t} onSave={(change) => save(t.id, change)} onReply={(body) => reply(t.id, body)} />
                ) : (
                  <TicketCard key={t.id} ticket={t} onSave={(change) => save(t.id, change)} />
                )
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function TicketCard({
  ticket,
  onSave,
}: {
  ticket: Ticket;
  onSave: (change: { status?: IssueStatus; adminNote?: string }) => Promise<boolean>;
}) {
  // Null until the Admin starts typing, so a refresh of the queue never overwrites a reply in progress.
  const [reply, setReply] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shownReply = reply ?? ticket.adminNote ?? "";
  const changed = reply !== null && reply.trim() !== (ticket.adminNote ?? "");

  return (
    <article className="card" style={{ padding: "1.15rem 1.3rem" }}>
      <div className="row-between wrap" style={{ gap: "0.5rem", marginBottom: "0.4rem" }}>
        <span className="small strong">
          {moduleName(ticket.moduleKey)}
          {ticket.projectName && <span className="muted"> · {ticket.projectName}</span>}
        </span>
        <span className={`tag ${ISSUE_STATUS_TAG[ticket.status]}`}>{ISSUE_STATUS_LABEL[ticket.status]}</span>
      </div>
      <p className="tiny muted" style={{ marginBottom: "0.75rem" }}>
        {ticket.reporter.name || ticket.reporter.email}
        {ticket.reporter.name ? ` (${ticket.reporter.email})` : ""} · {ticket.workspace} ·{" "}
        {relativeTime(ticket.createdAt)}
        {ticket.updatedAt && ticket.updatedAt !== ticket.createdAt ? ` · changed ${relativeTime(ticket.updatedAt)}` : ""}
        <br />
        <code>{ticket.path || "/"}</code>
      </p>
      <p style={{ whiteSpace: "pre-wrap", marginBottom: "1rem" }}>{ticket.note}</p>

      <div className="segmented" role="group" aria-label="Status" style={{ marginBottom: "0.85rem", flexWrap: "wrap" }}>
        {ADMIN_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={ticket.status === s}
            onClick={() => ticket.status !== s && onSave({ status: s })}
          >
            {ISSUE_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <textarea
        className="textarea"
        rows={2}
        placeholder="Reply to the person who reported it"
        value={shownReply}
        onChange={(e) => setReply(e.target.value)}
      />
      {changed && (
        <div className="row" style={{ justifyContent: "flex-end", gap: "0.4rem", marginTop: "0.6rem" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReply(null)}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void onSave({ adminNote: reply!.trim() }).then((ok) => {
                setSaving(false);
                if (ok) setReply(null);
              });
            }}
          >
            Save note
          </button>
        </div>
      )}
    </article>
  );
}

function StatusButtons({ ticket, onSave }: { ticket: Ticket; onSave: (change: { status?: IssueStatus }) => Promise<boolean> }) {
  return (
    <div className="segmented" role="group" aria-label="Status" style={{ marginBottom: "0.85rem", flexWrap: "wrap" }}>
      {ADMIN_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={ticket.status === s}
          disabled={ticket.status === "closed"}
          onClick={() => ticket.status !== s && onSave({ status: s })}
        >
          {ISSUE_STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  );
}

/** A support request: the conversation so far, and the Admin's reply box. */
function SupportTicketCard({
  ticket,
  onSave,
  onReply,
}: {
  ticket: Ticket;
  onSave: (change: { status?: IssueStatus }) => Promise<boolean>;
  onReply: (body: string) => Promise<boolean>;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const topic = SUPPORT_TOPICS[(ticket.topic ?? "other") as SupportTopic] ?? "Support";

  return (
    <article className="card" style={{ padding: "1.15rem 1.3rem" }}>
      <div className="row-between wrap" style={{ gap: "0.5rem", marginBottom: "0.4rem" }}>
        <span className="small strong">
          <span className="tag tag-client" style={{ marginRight: "0.5rem" }}>Support</span>
          {ticket.subject || topic}
        </span>
        <span className={`tag ${ISSUE_STATUS_TAG[ticket.status]}`}>{ISSUE_STATUS_LABEL[ticket.status]}</span>
      </div>
      <p className="tiny muted" style={{ marginBottom: "0.85rem" }}>
        {topic} · {ticket.reporter.name || ticket.reporter.email}
        {ticket.reporter.name ? ` (${ticket.reporter.email})` : ""} · {ticket.workspace} · {relativeTime(ticket.createdAt)}
      </p>

      <div className="convo" style={{ marginBottom: "1rem" }}>
        {ticket.messages.map((m) => (
          <div key={m.id} className={`convo-msg small ${m.fromAdmin ? "convo-msg-mine" : ""}`}>
            <span className="tiny strong" style={{ display: "block", marginBottom: "0.2rem", opacity: 0.75 }}>
              {m.fromAdmin ? `${m.author ?? "Admin"} (you)` : m.author ?? "They"} · {relativeTime(m.createdAt)}
            </span>
            {m.body}
          </div>
        ))}
      </div>

      <StatusButtons ticket={ticket} onSave={onSave} />

      {ticket.status === "closed" ? (
        <p className="tiny muted">Closed by the person who asked.</p>
      ) : (
        <>
          <textarea
            className="textarea"
            rows={2}
            placeholder="Reply to them"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: "0.6rem" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={sending || !reply.trim()}
              onClick={() => {
                setSending(true);
                void onReply(reply.trim()).then((ok) => {
                  setSending(false);
                  if (ok) setReply("");
                });
              }}
            >
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}
