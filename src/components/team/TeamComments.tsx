"use client";
import { useMemo, useState } from "react";
import { Check, CornerDownRight, MessageSquare, RotateCcw, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { relativeTime } from "@/lib/studio/format";
import type { TeamComment } from "@/lib/team/space";
import { useTeamBackend, usePolled } from "./useTeam";
import "./team.css";

export interface CommentAnchor {
  key: string;
  label: string;
}

/**
 * The team's comments on part of a project. The first anchor is where a new
 * comment goes unless the person picks another (a step of the phase, say).
 */
export function TeamComments({
  projectId,
  anchors,
  title = "Team comments",
}: {
  projectId: string;
  anchors: CommentAnchor[];
  title?: string;
}) {
  const { viewer } = useStudio();
  const { backend, me } = useTeamBackend(projectId);
  const keys = useMemo(() => new Set(anchors.map((a) => a.key)), [anchors]);
  const { data, setData, error, refresh } = usePolled(() => backend.comments(), 10_000, [backend]);
  const [anchor, setAnchor] = useState(anchors[0]?.key ?? "project");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const all = (data ?? []).filter((c) => keys.has(c.anchor));
  const threads = all.filter((c) => !c.parentId);
  const open = threads.filter((c) => !c.resolvedAt);
  const shown = showResolved ? threads : open;
  const labelOf = (key: string) => anchors.find((a) => a.key === key)?.label ?? "";

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem("");
    try {
      await work();
      await refresh();
      return true;
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't work. Please retry.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="team-comments" aria-label={title}>
      <div className="section-title">
        <h2 className="row" style={{ gap: "0.5rem" }}>
          <MessageSquare size={18} /> {title}
          {open.length > 0 && <span className="count">{open.length}</span>}
        </h2>
        {threads.length > open.length && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? "Hide resolved" : `Show resolved (${threads.length - open.length})`}
          </button>
        )}
      </div>
      {shown.map((c) => (
        <Thread
          key={c.id}
          comment={c}
          replies={all.filter((r) => r.parentId === c.id)}
          about={anchors.length > 1 ? labelOf(c.anchor) : ""}
          mine={c.authorId === me.id}
          canDelete={c.authorId === me.id || viewer.workspaceRole === "owner" || !viewer.signedIn}
          busy={busy}
          onReply={(text) => run(() => backend.addComment({ anchor: c.anchor, body: text, parentId: c.id }))}
          onResolve={(resolved) =>
            run(async () => {
              const saved = await backend.resolveComment(c.id, resolved);
              setData((list) => (list ?? []).map((x) => (x.id === saved.id ? saved : x)));
            })
          }
          onDelete={() => run(() => backend.deleteComment(c.id))}
        />
      ))}
      {!shown.length && data && <p className="small muted">No comments yet. Notes for the team go here.</p>}
      <form
        className="stack"
        style={{ gap: "0.5rem" }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          if (await run(() => backend.addComment({ anchor, body }))) setBody("");
        }}
      >
        {anchors.length > 1 && (
          <label className="row wrap" style={{ gap: "0.5rem" }}>
            <span className="tiny muted">About</span>
            <select className="input" aria-label="What the comment is about" style={{ width: "auto", maxWidth: "100%" }} value={anchor} onChange={(e) => setAnchor(e.target.value)}>
              {anchors.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <textarea
          className="input"
          rows={2}
          placeholder="Write a comment for the team"
          value={body}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit();
          }}
        />
        <div className="row-between wrap">
          <span className="tiny muted" role="status">
            {problem || error}
          </span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>
            Comment
          </button>
        </div>
      </form>
    </section>
  );
}

function Thread({
  comment,
  replies,
  about,
  mine,
  canDelete,
  busy,
  onReply,
  onResolve,
  onDelete,
}: {
  comment: TeamComment;
  replies: TeamComment[];
  about: string;
  mine: boolean;
  canDelete: boolean;
  busy: boolean;
  onReply: (text: string) => Promise<boolean>;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  return (
    <article className="team-comment" data-resolved={!!comment.resolvedAt}>
      <div className="row-between wrap" style={{ gap: "0.5rem" }}>
        <span className="tiny">
          <strong>{mine ? "You" : comment.authorName}</strong>
          <span className="muted"> · {relativeTime(comment.createdAt)}{about && ` · ${about}`}</span>
        </span>
        <span className="row" style={{ gap: "0.25rem" }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onResolve(!comment.resolvedAt)}>
            {comment.resolvedAt ? <><RotateCcw size={13} /> Reopen</> : <><Check size={13} /> Resolve</>}
          </button>
          {canDelete && (
            <button type="button" className="icon-btn" aria-label="Delete comment" disabled={busy} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          )}
        </span>
      </div>
      <p className="team-comment-body">{comment.body}</p>
      {replies.length > 0 && (
        <div className="team-replies">
          {replies.map((r) => (
            <div key={r.id}>
              <span className="tiny">
                <strong>{r.authorName}</strong> <span className="muted">· {relativeTime(r.createdAt)}</span>
              </span>
              <p className="team-comment-body">{r.body}</p>
            </div>
          ))}
        </div>
      )}
      {!comment.resolvedAt &&
        (replying ? (
          <form
            className="row"
            style={{ gap: "0.5rem", marginTop: "0.5rem" }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (text.trim() && (await onReply(text))) {
                setText("");
                setReplying(false);
              }
            }}
          >
            <input className="input" autoFocus value={text} maxLength={5000} placeholder="Reply" onChange={(e) => setText(e.target.value)} />
            <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !text.trim()}>
              Reply
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplying(true)}>
            <CornerDownRight size={13} /> Reply
          </button>
        ))}
    </article>
  );
}
