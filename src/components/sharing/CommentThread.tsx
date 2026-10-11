"use client";

import { useId, useState } from "react";
import { displayDate, shareRequest, type ShareComment } from "./client";

export function CommentThread({
  comments,
  endpoint,
  canComment,
  onComments,
  staff = false,
}: {
  comments: ShareComment[];
  endpoint: string;
  canComment: boolean;
  onComments: (comments: ShareComment[]) => void;
  staff?: boolean;
}) {
  const id = useId();
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<ShareComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  async function post(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || (!staff && !name.trim())) return;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await shareRequest<{ comment: ShareComment }>(endpoint, {
        method: "POST",
        body: JSON.stringify({
          authorName: name.trim(),
          body: body.trim(),
          ...(replyTo ? { parentId: replyTo.id } : {}),
        }),
      });
      onComments([...comments, result.comment]);
      setBody("");
      setReplyTo(null);
      setNotice("Comment added.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const roots = comments.filter(
    (comment) =>
      !comment.parentId ||
      !comments.some((parent) => parent.id === comment.parentId),
  );
  function commentRow(comment: ShareComment, reply = false) {
    return (
      <article
        key={comment.id}
        className={`share-comment${reply ? " share-comment-reply" : ""}`}
      >
        <div className="share-comment-meta">
          <strong>
            {comment.authorName}{" "}
            <span className="muted">
              · {comment.internal ? "Studio" : "Guest"}
            </span>
          </strong>
          <time dateTime={comment.createdAt}>
            {displayDate(comment.createdAt)}
          </time>
        </div>
        <p>{comment.body}</p>
        {canComment && (
          <button
            className="share-text-button"
            type="button"
            onClick={() => {
              setReplyTo(
                reply
                  ? (comments.find(
                      (parent) => parent.id === comment.parentId,
                    ) ?? comment)
                  : comment,
              );
              document.getElementById(`${id}-body`)?.focus();
            }}
          >
            Reply
          </button>
        )}
      </article>
    );
  }

  return (
    <section className="share-comments" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>
        Comments <span className="muted">({comments.length})</span>
      </h3>
      {!comments.length && (
        <p className="small muted">
          No comments yet.{canComment ? " Start the conversation below." : ""}
        </p>
      )}
      <div className="share-comment-list">
        {roots.map((comment) => (
          <div key={comment.id}>
            {commentRow(comment)}
            {comments
              .filter((reply) => reply.parentId === comment.id)
              .map((reply) => commentRow(reply, true))}
          </div>
        ))}
      </div>
      {canComment && (
        <form
          className="share-comment-form"
          onSubmit={(event) => void post(event)}
        >
          {replyTo && (
            <div className="share-reply-label small">
              Replying to {replyTo.authorName}
              <button
                className="share-text-button"
                type="button"
                onClick={() => setReplyTo(null)}
              >
                Cancel reply
              </button>
            </div>
          )}
          {!staff && (
            <label className="field" htmlFor={`${id}-name`}>
              <span className="field-label">Your name</span>
              <input
                id={`${id}-name`}
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
                autoComplete="name"
                disabled={busy}
              />
            </label>
          )}
          <label className="field" htmlFor={`${id}-body`}>
            <span className="field-label">
              {replyTo ? "Your reply" : "Add a comment"}
            </span>
            <textarea
              id={`${id}-body`}
              className="textarea"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={5000}
              rows={3}
              required
              disabled={busy}
            />
          </label>
          {!staff && (
            <p className="small muted">
              Your name and comment will be visible to everyone with this link.
            </p>
          )}
          {error && (
            <p className="share-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !body.trim() || (!staff && !name.trim())}
          >
            {busy ? "Posting…" : replyTo ? "Post reply" : "Post comment"}
          </button>
        </form>
      )}
      <p className="sr-only" role="status">
        {notice}
      </p>
    </section>
  );
}
