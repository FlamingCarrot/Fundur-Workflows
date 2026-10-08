"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { ShareApproval } from "@/lib/sharing/types";
import { shareRequest, displayDate } from "./client";
export function ApprovalPanel({
  token,
  approvals,
  onApproval,
}: {
  token: string;
  approvals: ShareApproval[];
  onApproval: (approval: ShareApproval) => void;
}) {
  const id = useId(),
    draftKey = `fundur.client-review.${token}`;
  const [name, setName] = useState(""),
    [note, setNote] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const request = useRef<{ id: string; payload: string } | null>(null),
    loaded = useRef(false);
  useEffect(() => {
    void Promise.resolve().then(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
        if (
          saved &&
          typeof saved.name === "string" &&
          typeof saved.note === "string" &&
          saved.name.length <= 100 &&
          saved.note.length <= 3000
        ) {
          setName(saved.name);
          setNote(saved.note);
        }
        if (
          saved?.request &&
          typeof saved.request.id === "string" &&
          typeof saved.request.payload === "string"
        )
          request.current = saved.request;
      } catch {}
      loaded.current = true;
    });
  }, [draftKey]);
  useEffect(() => {
    if (loaded.current)
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ name, note, request: request.current }),
        );
      } catch {}
  }, [name, note, draftKey]);
  async function decide(decision: ShareApproval["decision"]) {
    if (!reviewed || !name.trim()) {
      setError("Enter your name and confirm that you reviewed this copy.");
      return;
    }
    if (decision === "changes_requested" && !note.trim()) {
      setError("Describe the changes you need.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const payload = JSON.stringify({
      authorName: name.trim(),
      note: note.trim(),
      decision,
      reviewed: true,
    });
    if (request.current?.payload !== payload)
      request.current = { id: crypto.randomUUID(), payload };
    try {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ name, note, request: request.current }),
        );
      } catch {}
      const result = await shareRequest<{ approval: ShareApproval }>(
        `/api/shared/${token}/approval`,
        {
          method: "POST",
          body: JSON.stringify({
            ...JSON.parse(payload),
            requestId: request.current.id,
          }),
        },
      );
      onApproval(result.approval);
      request.current = null;
      setReviewed(false);
      setNote("");
      setNotice(
        decision === "approved"
          ? "Approval recorded for this frozen copy."
          : "Your requested changes were recorded for this frozen copy.",
      );
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ name, note: "", request: null }),
        );
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const latest = approvals.at(-1);
  return (
    <section className="share-approval" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Review this copy</h2>
      <p className="small muted">
        Your decision applies to the frozen copy above. It records your stated
        name; anyone holding this link can respond. The designer will review
        your response before progressing the project.
      </p>
      {latest && (
        <article className="share-decision">
          <strong>
            Latest response:{" "}
            {latest.decision === "approved" ? "Approved" : "Changes requested"}
          </strong>
          <p>
            {latest.authorName} · {displayDate(latest.createdAt)}
          </p>
          {latest.note && <p className="share-decision-note">{latest.note}</p>}
        </article>
      )}
      {approvals.length > 1 && (
        <details>
          <summary>Previous responses ({approvals.length - 1})</summary>
          {approvals
            .slice(0, -1)
            .reverse()
            .map((a) => (
              <article className="share-decision" key={a.id}>
                <strong>
                  {a.decision === "approved" ? "Approved" : "Changes requested"}
                </strong>
                <p>
                  {a.authorName} · {displayDate(a.createdAt)}
                </p>
                {a.note && <p className="share-decision-note">{a.note}</p>}
              </article>
            ))}
        </details>
      )}
      <div className="share-approval-form stack" style={{ gap: "1rem" }}>
        <label className="field" htmlFor={`${id}-name`}>
          <span className="field-label">Your name for this decision</span>
        </label>
        <input
          className="input"
          id={`${id}-name`}
          autoComplete="name"
          value={name}
          maxLength={100}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="field" htmlFor={`${id}-note`}>
          <span className="field-label">Review note or requested changes</span>
        </label>
        <textarea
          className="textarea"
          id={`${id}-note`}
          rows={4}
          maxLength={3000}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
        <label className="row">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={busy}
            onChange={(e) => setReviewed(e.target.checked)}
          />{" "}
          I have reviewed this frozen copy
        </label>
        {error && (
          <p role="alert" className="share-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="row wrap">
          <button
            className="btn btn-primary"
            disabled={busy || !reviewed || !name.trim()}
            onClick={() => void decide("approved")}
          >
            Approve this copy
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy || !reviewed || !name.trim() || !note.trim()}
            onClick={() => void decide("changes_requested")}
          >
            Request changes
          </button>
        </div>
        <p className="small muted">
          Earlier responses remain in the history when you make a new decision.
        </p>
      </div>
    </section>
  );
}
