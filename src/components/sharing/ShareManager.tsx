"use client";
import { useEffect, useState } from "react";
import { Link2, Copy, RefreshCw, X } from "lucide-react";
import type {
  ProjectShares,
  ShareComment,
  ShareTarget,
  ShareLink,
} from "@/lib/sharing/types";
import { shareRequest, displayDate } from "./client";
import { useStudio } from "@/components/providers/StudioProvider";
import type { Project } from "@/lib/studio/types";
import { CommentThread } from "./CommentThread";
import "./sharing.css";

export function ShareManager({
  projectId,
  documentState,
}: {
  projectId: string;
  documentState: string;
}) {
  const { saveBrief, receiveProject } = useStudio();
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/shares`;
  const [data, setData] = useState<ProjectShares | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"live" | "snapshot">("snapshot");
  const [permission, setPermission] = useState<"view" | "comment" | "edit">(
    "view",
  );
  const [expires, setExpires] = useState("");
  const [url, setUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [thread, setThread] = useState<ShareLink | null>(null);
  const [comments, setComments] = useState<ShareComment[]>([]);
  useEffect(() => {
    let live = true;
    shareRequest<ProjectShares>(endpoint).then(
      (d) => {
        if (live) {
          setData(d);
          setSelected((prev) =>
            d.targets.some((t) => `${t.type}:${t.id}` === prev)
              ? prev
              : `${d.targets[0]?.type}:${d.targets[0]?.id}`,
          );
        }
      },
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [endpoint, documentState]);
  const target = data?.targets.find((t) => `${t.type}:${t.id}` === selected);
  const phase = data?.phases.find((p) => p.key === target?.phaseKey);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function visibility(
    t: ShareTarget | { type: "phase"; id: string },
    clientVisible: boolean,
  ) {
    await run(async () => {
      setData(
        await shareRequest<ProjectShares>(endpoint, {
          method: "PATCH",
          body: JSON.stringify({
            targetType: t.type,
            targetId: t.id,
            clientVisible,
          }),
        }),
      );
      if (t.type === "document") {
        const result = await shareRequest<{ project: Project }>(
          `/api/projects/${encodeURIComponent(projectId)}`,
        );
        receiveProject(result.project);
      }
    });
  }
  async function create() {
    if (!target) return;
    await run(async () => {
      await saveBrief(projectId);
      const result = await shareRequest<{ path: string }>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          targetType: target.type,
          targetId: target.id,
          mode,
          permission,
          expiresAt: expires ? new Date(expires).toISOString() : null,
        }),
      });
      setUrl(`${window.location.origin}${result.path}`);
      setData(await shareRequest<ProjectShares>(endpoint));
      setNotice("Link created. Copy and keep it before creating another.");
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch {
      setNotice("Select and copy the link below.");
    }
  }
  async function showComments(link: ShareLink) {
    await run(async () => {
      const result = await shareRequest<{ comments: ShareComment[] }>(
        `${endpoint}/${link.id}/comments`,
      );
      setThread(link);
      setComments(result.comments);
    });
  }
  return (
    <section
      className="card share-manager rise"
      aria-labelledby="sharing-heading"
    >
      <div className="row-between wrap">
        <h2 id="sharing-heading" className="row">
          <Link2 size={20} /> Client links
        </h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setData(await shareRequest<ProjectShares>(endpoint)),
            )
          }
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>
      <p className="small muted">
        Choose exactly what to publish. A visibility switch makes work eligible
        for a link; clients receive access only when you create and send one.
      </p>
      {error && (
        <p role="alert" className="share-error">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="muted" role="status">
          Loading client links…
        </p>
      )}
      {data && (
        <>
          <div className="share-controls">
            <label className="field">
              <span className="field-label">Document</span>
              <select
                className="input"
                value={selected}
                disabled={busy}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setPermission("view");
                  setUrl("");
                }}
              >
                {data.targets.map((t) => (
                  <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>
                    {t.name}
                    {!t.available ? " · not saved yet" : ""}
                  </option>
                ))}
              </select>
            </label>
            {target && (
              <div className="stack" style={{ gap: "0.75rem" }}>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={target.clientVisible}
                    disabled={busy}
                    onChange={(e) => void visibility(target, e.target.checked)}
                  />
                  Make {target.name.toLowerCase()} client-visible
                </label>
                {phase && (
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={phase.clientVisible}
                      disabled={busy}
                      onChange={(e) =>
                        void visibility(
                          { type: "phase", id: phase.key },
                          e.target.checked,
                        )
                      }
                    />
                    Allow sharing from {phase.name}
                  </label>
                )}
                {target.type === "plan" && (
                  <p className="tiny muted">
                    The current drawing and its placed furniture are included.
                    Working notes, imported backgrounds and unchosen options
                    stay private.
                  </p>
                )}
              </div>
            )}
            <label className="field">
              <span className="field-label">Link shows</span>
              <select
                className="input"
                value={mode}
                disabled={busy}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  setPermission("view");
                }}
              >
                <option value="snapshot">
                  A frozen copy of the saved document
                </option>
                <option value="live">The latest saved document</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Client can</span>
              <select
                className="input"
                value={permission}
                disabled={busy}
                onChange={(e) =>
                  setPermission(e.target.value as typeof permission)
                }
              >
                <option value="view">View</option>
                <option value="comment">View and comment</option>
                {target?.type === "brief" && mode === "live" && (
                  <option value="edit">View, comment and edit the brief</option>
                )}
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                Expires at (optional, your local time)
              </span>
              <input
                className="input"
                type="datetime-local"
                value={expires}
                disabled={busy}
                onChange={(e) => setExpires(e.target.value)}
              />
            </label>
          </div>
          <p className="tiny muted">
            Anyone you send the link to can use its permission, including anyone
            they forward it to. Hiding the document or phase ends access to all
            of its links.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              busy ||
              !target?.available ||
              !target.clientVisible ||
              !phase?.clientVisible
            }
            onClick={() => void create()}
          >
            <Link2 size={16} />
            {busy ? "Working…" : "Create client link"}
          </button>
          {url && (
            <div className="share-created">
              <label className="field">
                <span className="field-label">Your new link</span>
                <input
                  className="input"
                  readOnly
                  value={url}
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void copy()}
                >
                  <Copy size={14} />
                  Copy link
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  Preview client view
                </a>
              </div>
              <p className="tiny muted">
                This is the only time the full link is shown. Keep a copy for
                sending; you can revoke it below at any time.
              </p>
            </div>
          )}
          <p role="status" className="small" style={{ color: "var(--accent)" }}>
            {notice}
          </p>
          <h3 style={{ marginTop: "1.5rem" }}>Link history</h3>
          {!data.links.length && (
            <p className="small muted">
              No links have been created for this project.
            </p>
          )}
          <div className="stack" style={{ gap: "1rem" }}>
            {data.links.map((l) => (
              <article key={l.id} className="share-link-row">
                <div className="stack" style={{ gap: "0.3rem" }}>
                  <strong>{l.title}</strong>
                  <span className="tiny muted">
                    {l.mode === "live" ? "Live" : "Frozen"} · {l.permission} ·{" "}
                    {l.revokedAt
                      ? "Revoked"
                      : l.available
                        ? "Active"
                        : "Unavailable"}
                  </span>
                  <span className="tiny muted">
                    Created {displayDate(l.createdAt)}
                    {l.expiresAt
                      ? ` · expires ${displayDate(l.expiresAt)}`
                      : ""}
                  </span>
                  <span className="tiny muted">
                    Opened {l.viewCount} time{l.viewCount === 1 ? "" : "s"}
                    {l.lastViewedAt
                      ? ` · last ${displayDate(l.lastViewedAt)}`
                      : ""}
                  </span>
                </div>
                <div className="row wrap">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => void showComments(l)}
                  >
                    Comments
                  </button>
                  {!l.revokedAt && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await shareRequest(`${endpoint}/${l.id}`, {
                            method: "DELETE",
                          });
                          setData(await shareRequest<ProjectShares>(endpoint));
                          setUrl("");
                          setNotice("Link revoked.");
                        })
                      }
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {thread && (
            <div className="share-created">
              <div className="row-between">
                <strong>
                  {thread.title} · {thread.mode} link
                </strong>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close comments"
                  onClick={() => setThread(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <CommentThread
                comments={comments}
                endpoint={`${endpoint}/${thread.id}/comments`}
                canComment={!thread.revokedAt}
                staff
                onComments={setComments}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
