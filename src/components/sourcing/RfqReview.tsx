"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { rfqDraftSchema, type RfqDraft } from "@/lib/sourcing/schema";
const fieldsSchema = z
  .object({
    supplierName: z.string().max(200),
    recipientEmail: z.string().max(254),
    subject: z.string().max(500),
    body: z.string().max(60_000),
  })
  .strict();
type Fields = z.infer<typeof fieldsSchema>;
function onlyFields(d: RfqDraft): Fields {
  const { supplierName, subject, body } = d;
  return {
    supplierName,
    subject,
    body,
    recipientEmail: d.recipientEmail ?? "",
  };
}
export function recoverRfq(
  key: string,
): { initial: RfqDraft; fields: Fields } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!raw) return null;
    const initial = rfqDraftSchema.safeParse(raw.initial),
      fields = fieldsSchema.safeParse(raw.fields);
    return initial.success && fields.success
      ? { initial: initial.data, fields: fields.data }
      : null;
  } catch {
    return null;
  }
}
export function RfqReview({
  initial,
  recoveryKey,
  onSave,
  onCancel,
}: {
  initial: RfqDraft;
  recoveryKey: string;
  onSave: (d: RfqDraft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<Fields>(() => {
      const saved = recoverRfq(recoveryKey);
      return saved && JSON.stringify(saved.initial) === JSON.stringify(initial)
        ? saved.fields
        : onlyFields(initial);
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(recoveryKey, JSON.stringify({ initial, fields }));
    } catch {
      queueMicrotask(() =>
        setError(
          "This browser could not keep a recovery copy. Save this draft before leaving.",
        ),
      );
    }
  }, [initial, fields, recoveryKey]);
  const clear = () => {
    try {
      localStorage.removeItem(recoveryKey);
    } catch {
      /* Saved project remains available. */
    }
  };
  return (
    <form
      className="card rfq-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const checked = rfqDraftSchema.safeParse({
          ...initial,
          ...fields,
          recipientEmail: fields.recipientEmail.trim() || null,
        });
        if (!checked.success) {
          setError(checked.error.issues[0].message);
          return;
        }
        setBusy(true);
        setError("");
        try {
          if (await onSave(checked.data)) {
            clear();
            onCancel();
          } else
            setError(
              "The draft has not been saved. Resolve the save issue above and try again.",
            );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>Review quotation draft</h2>
      <p className="small muted">
        Check specifications, substitutions and recipient details before using
        this draft. Saving does not send it. {initial.itemIds.length}{" "}
        selection(s) are captured in this request.
      </p>
      <label className="field">
        <span className="field-label">Request supplier</span>
        <input
          className="input"
          required
          readOnly={busy}
          maxLength={200}
          value={fields.supplierName}
          onChange={(e) =>
            setFields((f) => ({ ...f, supplierName: e.target.value }))
          }
        />
      </label>
      <label className="field">
        <span className="field-label">Recipient email</span>
        <input
          className="input"
          readOnly={busy}
          type="email"
          maxLength={254}
          value={fields.recipientEmail}
          onChange={(e) =>
            setFields((f) => ({ ...f, recipientEmail: e.target.value }))
          }
        />
      </label>
      <label className="field">
        <span className="field-label">Request subject</span>
        <input
          className="input"
          required
          readOnly={busy}
          maxLength={500}
          value={fields.subject}
          onChange={(e) =>
            setFields((f) => ({ ...f, subject: e.target.value }))
          }
        />
      </label>
      <label className="field">
        <span className="field-label">Request body</span>
        <textarea
          aria-label="Request body"
          className="input"
          required
          readOnly={busy}
          rows={16}
          maxLength={60_000}
          value={fields.body}
          onChange={(e) => setFields((f) => ({ ...f, body: e.target.value }))}
        />
      </label>
      {error && (
        <p className="design-error" role="alert">
          {error}
        </p>
      )}
      <div className="row wrap">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Saving draft…" : "Save draft"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Discard this unfinished edit?")) {
              clear();
              onCancel();
            }
          }}
        >
          Discard edit
        </button>
      </div>
    </form>
  );
}
