/* eslint-disable @next/next/no-img-element -- Private tokenized images must bypass the shared optimization cache so revocation is checked on every read. */
"use client";
import { useEffect, useState } from "react";
import { Printer, Download, RefreshCw } from "lucide-react";
import type { SharedPage } from "@/lib/sharing/types";
import { shareRequest, displayDate } from "./client";
import { CommentThread } from "./CommentThread";
import { SharedPlan } from "./SharedPlan";
import { SharedDesign } from "./SharedDesign";
import "./sharing.css";
import "./reader.css";

export function SharedReader({ token }: { token: string }) {
  const endpoint = `/api/shared/${token}`;
  const [page, setPage] = useState<SharedPage | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [patch, setPatch] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    shareRequest<SharedPage>(endpoint, { signal: controller.signal }).then(
      setPage,
      (e) => {
        if (!controller.signal.aborted) setError(e.message);
      },
    );
    return () => controller.abort();
  }, [endpoint]);
  async function reload() {
    setBusy(true);
    setError("");
    try {
      setPage(await shareRequest<SharedPage>(endpoint));
      setPatch({});
    } catch (e) {
      setPage(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      setPage(
        await shareRequest<SharedPage>(endpoint, {
          method: "PATCH",
          body: JSON.stringify({ patch }),
        }),
      );
      setPatch({});
      setNotice("Changes saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="shared-reader">
      {!page ? (
        <section className="shared-paper shared-unavailable">
          <h1>{error ? "Link unavailable" : "Opening document…"}</h1>
          <p>
            {error
              ? "This link may have expired, been revoked, or the document may no longer be shared."
              : "Please wait a moment."}
          </p>
          {error && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void reload()}
              disabled={busy}
            >
              Try again
            </button>
          )}
        </section>
      ) : (
        <>
          <div className="shared-toolbar">
            <span>
              {page.share.mode === "snapshot"
                ? `Frozen copy · ${displayDate(page.share.createdAt)}`
                : "Live document · latest saved version"}
            </span>
            <div className="row">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={busy}
                onClick={() => void reload()}
              >
                <RefreshCw size={15} />
                Refresh
              </button>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => window.print()}
              >
                <Printer size={15} />
                Print
              </button>
            </div>
          </div>
          <article className="shared-paper">
            {page.brand?.name && (
              <p className="shared-brand">{page.brand.name}</p>
            )}
            {page.brand?.logoUrl && (
              <img
                className="shared-logo"
                src={page.brand.logoUrl}
                alt={page.brand.name ?? "Practice logo"}
                referrerPolicy="no-referrer"
              />
            )}
            <header>
              <p className="eyebrow">{page.share.projectName}</p>
              <h1>{page.share.title}</h1>
              {page.share.expiresAt && (
                <p className="small muted">
                  Link expires {displayDate(page.share.expiresAt)}
                </p>
              )}
            </header>
            {error && (
              <p className="share-error" role="alert">
                {error}
              </p>
            )}
            {page.content.type === "brief" && (
              <div className="shared-fields">
                {page.content.fields.map((f) => (
                  <section key={f.key}>
                    <h2>{f.label}</h2>
                    {page.share.permission === "edit" ? (
                      <label className="field">
                        <span className="sr-only">{f.label}</span>
                        <textarea
                          className="textarea"
                          value={patch[f.key] ?? f.value}
                          onChange={(e) =>
                            setPatch((p) => ({ ...p, [f.key]: e.target.value }))
                          }
                          maxLength={20000}
                          rows={3}
                          disabled={busy}
                        />
                      </label>
                    ) : (
                      <p style={{ whiteSpace: "pre-wrap" }}>{f.value || "—"}</p>
                    )}
                  </section>
                ))}
                {page.share.permission === "edit" && (
                  <div className="shared-edit-actions">
                    <p className="small muted">
                      Edits change the studio&apos;s live brief. Review your
                      changes before saving.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || !Object.keys(patch).length}
                      onClick={() => void save()}
                    >
                      {busy ? "Saving…" : "Save changes"}
                    </button>
                    <p role="status" className="small">
                      {notice}
                    </p>
                  </div>
                )}
              </div>
            )}
            {page.content.type === "plan" && (
              <SharedPlan plan={page.content.plan} />
            )}
            {(page.content.type === "board" ||
              page.content.type === "schedule") && (
              <SharedDesign content={page.content} />
            )}
            {page.content.type === "document" && (
              <section className="shared-file">
                <p>
                  {page.content.name} · version {page.content.version}
                </p>
                {page.content.fileUrl && (
                  <>
                    <a
                      className="btn btn-primary"
                      href={page.content.fileUrl}
                      rel="noreferrer"
                    >
                      <Download size={16} />
                      Download document
                    </a>
                    {/^(png|jpg|jpeg|gif|webp)$/i.test(
                      page.content.fileType,
                    ) && (
                      <img
                        className="shared-image"
                        src={`${page.content.fileUrl}?preview=1`}
                        alt={page.content.name}
                      />
                    )}
                  </>
                )}
                <p className="small muted">
                  {(page.content.sizeBytes / 1024 / 1024).toFixed(1)} MB
                </p>
              </section>
            )}
            <CommentThread
              comments={page.comments}
              endpoint={`${endpoint}/comments`}
              canComment={page.share.permission !== "view"}
              onComments={(comments) =>
                setPage((p) => (p ? { ...p, comments } : p))
              }
            />
          </article>
        </>
      )}
    </main>
  );
}
