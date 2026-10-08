"use client";
import { useState } from "react";
import {
  blankSupplier,
  DEFAULT_RFQ_TEMPLATE,
  sourcingEntryInput,
  type SourcingEntryInput,
} from "@/lib/sourcing/schema";
import type { useSourcingLibrary } from "./useSourcingLibrary";
export function PracticeLibrary({
  library,
}: {
  library: ReturnType<typeof useSourcingLibrary>;
}) {
  const [form, setForm] = useState<SourcingEntryInput | null>(null),
    [error, setError] = useState("");
  if (!library.allowed)
    return (
      <p className="small muted">
        Practice contacts and templates are available to owners and members. You
        can still create project requests using supplier details.
      </p>
    );
  const patch = (field: string, value: string) =>
    setForm((f) =>
      f
        ? ({ ...f, data: { ...f.data, [field]: value } } as SourcingEntryInput)
        : f,
    );
  return (
    <details className="card rfq-library">
      <summary>Practice suppliers & quotation templates</summary>
      <p className="small muted">
        Shared across projects with practice owners and members. Changing a
        template or contact leaves saved request text intact.
      </p>
      {library.error && (
        <div role="alert">
          <p className="design-error">{library.error}</p>
          <button
            className="btn btn-secondary"
            onClick={() => void library.reload()}
          >
            Retry library
          </button>
        </div>
      )}
      <div className="row wrap">
        <button
          className="btn btn-secondary"
          disabled={library.busy}
          onClick={() => {
            setError("");
            setForm({ kind: "supplier", data: blankSupplier() });
          }}
        >
          Add supplier
        </button>
        <button
          className="btn btn-secondary"
          disabled={library.busy}
          onClick={() => {
            setError("");
            setForm({
              kind: "template",
              data: { ...DEFAULT_RFQ_TEMPLATE, name: "New quotation template" },
            });
          }}
        >
          Add template
        </button>
      </div>
      {form && (
        <form
          className="rfq-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = sourcingEntryInput.safeParse(form);
            if (!parsed.success) {
              setError(parsed.error.issues[0].message);
              return;
            }
            try {
              await library.save(parsed.data);
              setForm(null);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h3>
            {form.id ? "Edit" : "New"} {form.kind}
          </h3>
          <label className="field">
            <span className="field-label">
              {form.kind === "supplier" ? "Supplier name" : "Template name"}
            </span>
            <input
              disabled={library.busy}
              className="input"
              required
              maxLength={200}
              value={form.data.name}
              onChange={(e) => patch("name", e.target.value)}
            />
          </label>
          {form.kind === "supplier" ? (
            <>
              <label className="field">
                <span className="field-label">Contact person</span>
                <input
                  disabled={library.busy}
                  className="input"
                  maxLength={200}
                  value={form.data.contactName}
                  onChange={(e) => patch("contactName", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Supplier email</span>
                <input
                  disabled={library.busy}
                  className="input"
                  type="email"
                  maxLength={254}
                  value={form.data.email ?? ""}
                  onChange={(e) =>
                    setForm((f) =>
                      f?.kind === "supplier"
                        ? {
                            ...f,
                            data: { ...f.data, email: e.target.value || null },
                          }
                        : f,
                    )
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">Phone</span>
                <input
                  disabled={library.busy}
                  className="input"
                  type="tel"
                  maxLength={100}
                  value={form.data.phone}
                  onChange={(e) => patch("phone", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Website (HTTPS)</span>
                <input
                  disabled={library.busy}
                  className="input"
                  type="url"
                  maxLength={2000}
                  value={form.data.website ?? ""}
                  onChange={(e) =>
                    setForm((f) =>
                      f?.kind === "supplier"
                        ? {
                            ...f,
                            data: {
                              ...f.data,
                              website: e.target.value || null,
                            },
                          }
                        : f,
                    )
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">Practice notes</span>
                <textarea
                  disabled={library.busy}
                  className="input"
                  maxLength={2000}
                  rows={3}
                  value={form.data.notes}
                  onChange={(e) => patch("notes", e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              <p className="small muted">
                Placeholders:{" "}
                {
                  "{project}, {client}, {supplier}, {practice}, {deadline}, {items}"
                }
                . Include {"{items}"} in the body.
              </p>
              <label className="field">
                <span className="field-label">Template subject</span>
                <input
                  disabled={library.busy}
                  className="input"
                  required
                  maxLength={500}
                  value={form.data.subject}
                  onChange={(e) => patch("subject", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Template body</span>
                <textarea
                  aria-label="Template body"
                  disabled={library.busy}
                  className="input"
                  required
                  rows={12}
                  maxLength={8000}
                  value={form.data.body}
                  onChange={(e) => patch("body", e.target.value)}
                />
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="design-error">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button className="btn btn-primary" disabled={library.busy}>
              Save {form.kind}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={library.busy}
              onClick={() => setForm(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      <div className="rfq-library-grid">
        {(["supplier", "template"] as const).map((kind) => (
          <section key={kind}>
            <h3>{kind === "supplier" ? "Suppliers" : "Templates"}</h3>
            {!library.entries.some((r) => r.kind === kind) && (
              <p className="small muted">
                No saved {kind === "supplier" ? "suppliers" : "templates"} yet.
              </p>
            )}
            {library.entries
              .filter((r) => r.kind === kind)
              .map((entry) => (
                <article key={entry.id} className="rfq-library-entry">
                  <strong>{entry.data.name}</strong>
                  {entry.kind === "supplier" && (
                    <p className="small muted">
                      {[
                        entry.data.contactName,
                        entry.data.email,
                        entry.data.phone,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No contact details"}
                    </p>
                  )}
                  <div className="row wrap">
                    <button
                      className="btn btn-secondary"
                      disabled={library.busy}
                      onClick={() => {
                        setError("");
                        setForm({
                          kind: entry.kind,
                          id: entry.id,
                          data: entry.data,
                        } as SourcingEntryInput);
                      }}
                    >
                      Edit {entry.data.name}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={library.busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${entry.data.name} from the practice library? Saved project requests stay intact.`,
                          )
                        )
                          void library.remove(entry.id);
                      }}
                    >
                      Remove {entry.data.name}
                    </button>
                  </div>
                </article>
              ))}
          </section>
        ))}
      </div>
    </details>
  );
}
