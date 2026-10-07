"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, LifeBuoy, MessageCircleQuestion } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { ISSUE_STATUS_LABEL, ISSUE_STATUS_TAG } from "@/components/shell/IssueSheet";
import { relativeTime } from "@/lib/studio/format";
import { isActiveIssue } from "@/lib/studio/types";
import { supportApi, useSupportRequests } from "@/lib/support/client";
import { SUPPORT_TOPICS, type SupportRequest, type SupportTopic } from "@/lib/support/types";

/**
 * Help and support for everyone: ask for help (a conversation with the
 * Admin), report a problem with a part of the app, and follow the replies.
 */
export function SupportView() {
  const { persistence, setIssueSheetOpen, showMyIssues, issues } = useStudio();
  const server = persistence === "server";
  const { data: requests, mutate, error } = useSupportRequests(server);
  const [asking, setAsking] = useState(false);
  const openReports = issues.filter(isActiveIssue).length;

  const update = (saved: SupportRequest) =>
    mutate((list) => [saved, ...(list ?? []).filter((r) => r.id !== saved.id)], { revalidate: false });

  const active = requests?.filter((r) => r.status !== "closed") ?? [];
  const closed = requests?.filter((r) => r.status === "closed") ?? [];

  return (
    <main className="page page-narrow">
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Help &amp; support</p>
        <h1 className="display-l">How can we help?</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Ask a question or for a hand with anything in Fundur, and we&apos;ll reply here. Found something broken? Report it
          against the part of the app it happened in.
        </p>
      </header>

      <div className="row wrap rise" style={{ gap: "0.75rem", marginBottom: "2rem" }}>
        <button type="button" className="btn btn-primary" onClick={() => setAsking(true)} disabled={!server || asking}>
          <MessageCircleQuestion size={16} /> Ask for help
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => setIssueSheetOpen(true)}>
          <LifeBuoy size={16} /> Report a problem
        </button>
        {openReports > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => showMyIssues()}>
            Your problem reports <span className="issue-count">{openReports}</span>
          </button>
        )}
      </div>

      {!server && (
        <p className="small muted">Support requests are kept once you sign in. On this demo you can still report a problem.</p>
      )}

      {asking && (
        <AskForm
          onCancel={() => setAsking(false)}
          onSent={(r) => {
            void update(r);
            setAsking(false);
          }}
        />
      )}

      {error && !requests && <p className="small" style={{ color: "var(--bad)" }}>Couldn&apos;t load your requests. Try reloading.</p>}

      {server && requests && (
        <section style={{ marginTop: asking ? "2rem" : 0 }}>
          <h2 className="section-title">Your requests</h2>
          {active.length === 0 ? (
            <p className="muted small">Nothing open. Ask anything, any time.</p>
          ) : (
            <div className="stack" style={{ gap: "0.75rem" }}>
              {active.map((r) => (
                <RequestCard key={r.id} request={r} onSaved={update} />
              ))}
            </div>
          )}
          {closed.length > 0 && (
            <details style={{ marginTop: "1.5rem" }}>
              <summary className="small muted" style={{ cursor: "pointer" }}>Closed ({closed.length})</summary>
              <div className="stack" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
                {closed.map((r) => (
                  <RequestCard key={r.id} request={r} onSaved={update} />
                ))}
              </div>
            </details>
          )}
        </section>
      )}
    </main>
  );
}

function AskForm({ onCancel, onSent }: { onCancel: () => void; onSent: (r: SupportRequest) => void }) {
  const { toast } = useStudio();
  const pathname = usePathname();
  const [topic, setTopic] = useState<SupportTopic>("how_to");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    supportApi.create({ topic, subject: subject.trim(), message: message.trim(), path: pathname }).then(
      (r) => {
        setBusy(false);
        toast("Sent. We'll reply here.");
        onSent(r);
      },
      (err: Error) => {
        setBusy(false);
        toast(`That didn't send: ${err.message}`);
      }
    );
  };

  return (
    <form className="card rise" style={{ padding: "1.3rem 1.4rem" }} onSubmit={send}>
      <span className="eyebrow">What&apos;s it about</span>
      <div className="row wrap" style={{ gap: "0.45rem", margin: "0.6rem 0 1.1rem" }}>
        {(Object.keys(SUPPORT_TOPICS) as SupportTopic[]).map((t) => (
          <button key={t} type="button" className="chip" aria-pressed={topic === t} onClick={() => setTopic(t)}>
            {SUPPORT_TOPICS[t]}
          </button>
        ))}
      </div>
      <input
        className="input"
        placeholder="A short subject"
        value={subject}
        maxLength={200}
        onChange={(e) => setSubject(e.target.value)}
        aria-label="Subject"
        autoFocus
      />
      <textarea
        className="textarea"
        rows={5}
        placeholder="Tell us what you need help with"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="Message"
        style={{ marginTop: "0.75rem" }}
      />
      <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !subject.trim() || !message.trim()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

function RequestCard({ request, onSaved }: { request: SupportRequest; onSaved: (r: SupportRequest) => void }) {
  const { toast } = useStudio();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const last = request.messages[request.messages.length - 1];
  const isClosed = request.status === "closed";

  const toggle = () => {
    setOpen((o) => !o);
    if (!open && request.unread) supportApi.seen(request.id).then(onSaved, () => undefined);
  };

  const send = () => {
    setBusy(true);
    supportApi.reply(request.id, reply.trim()).then(
      (r) => {
        setBusy(false);
        setReply("");
        onSaved(r);
      },
      (err: Error) => {
        setBusy(false);
        toast(`That didn't send: ${err.message}`);
      }
    );
  };

  const close = () =>
    supportApi.close(request.id).then(onSaved, (err: Error) => toast(`Couldn't close it: ${err.message}`));

  return (
    <article className="card" style={{ padding: "1rem 1.15rem" }}>
      <button type="button" className="row-between" style={{ width: "100%", gap: "0.75rem", textAlign: "left" }} onClick={toggle} aria-expanded={open}>
        <span className="stack" style={{ gap: "0.2rem", minWidth: 0 }}>
          <span className="strong truncate">
            {request.unread && <span className="live-dot" style={{ marginRight: "0.45rem" }} aria-label="New reply" />}
            {request.subject}
          </span>
          <span className="tiny muted">
            {SUPPORT_TOPICS[request.topic] ?? "Support"} · {last?.fromAdmin ? "replied" : "sent"} {relativeTime(request.updatedAt)}
          </span>
        </span>
        <span className="row" style={{ gap: "0.5rem", flexShrink: 0 }}>
          <span className={`tag ${ISSUE_STATUS_TAG[request.status]}`}>{ISSUE_STATUS_LABEL[request.status]}</span>
          <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 200ms" }} />
        </span>
      </button>

      {open && (
        <div style={{ marginTop: "1rem" }}>
          <div className="convo">
            {request.messages.map((m) => (
              <div key={m.id} className={`convo-msg small ${m.fromAdmin ? "" : "convo-msg-mine"}`}>
                <span className="tiny strong" style={{ display: "block", marginBottom: "0.2rem", opacity: 0.75 }}>
                  {m.fromAdmin ? "Fundur support" : "You"} · {relativeTime(m.createdAt)}
                </span>
                {m.body}
              </div>
            ))}
          </div>
          {!isClosed && (
            <>
              <textarea
                className="textarea"
                rows={2}
                placeholder="Write a reply"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                style={{ marginTop: "0.9rem" }}
                aria-label="Reply"
              />
              <div className="row-between" style={{ marginTop: "0.6rem", gap: "0.5rem" }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={close}>
                  Close, all sorted
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !reply.trim()} onClick={send}>
                  {busy ? "Sending…" : "Send reply"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
