"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUp, Check, FileText, Loader2, Paperclip, Wrench, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { zar } from "@/lib/studio/format";
import { uploadToProject } from "@/lib/studio/uploads";
import type { Project } from "@/lib/studio/types";

/**
 * The project chat (P4-10, P4-11) once projects live on the server: one
 * conversation per project, streamed as the assistant writes, with the tools
 * it ran, work that failed review, and the changes it proposes for her to
 * confirm. Files dropped in are uploaded to the project and filed by the
 * assistant once she confirms where they go.
 */

interface Attachment {
  name: string;
  sizeBytes: number;
  contentType?: string;
  storageKey: string;
}

type ChatEvent =
  | { type: "tool"; name: string; label: string; ok: boolean; note?: string }
  | { type: "flag"; text: string }
  | { type: "error"; text: string };

interface Proposal {
  id: string;
  summary: string;
  kind: string;
  status: "pending" | "applied" | "dismissed";
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: Attachment[];
  events: ChatEvent[];
  proposals: Proposal[];
  costZar: number;
  createdAt: string;
}

interface BudgetAlert {
  id: string;
  level: "threshold" | "limit";
  spendZar: number;
  budgetZar: number;
}

/** A reply as it streams in. */
interface Live {
  text: string;
  tools: { id: string; label: string; status: "running" | "done" | "failed"; note?: string }[];
  proposals: Proposal[];
  flags: string[];
  error?: string;
}

interface Upload {
  file: File;
  progress: number;
  storageKey?: string;
  error?: string;
}

/** Short paragraphs, lists and bold: the little Markdown the assistant writes. */
function Rich({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>
    );
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
          const ordered = /^\s*\d/.test(lines[0]);
          const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        if (lines.every((l) => l.trim().startsWith("|"))) {
          return (
            <pre key={i} className="tiny" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {block}
            </pre>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

export function LiveAssistant({ project, phaseKey }: { project: Project | undefined; phaseKey?: string }) {
  const { receiveProject, toast, assistantTask, viewer } = useStudio();
  const task = assistantTask && project && assistantTask.projectId === project.id ? assistantTask : null;

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [configured, setConfigured] = useState(true);
  const [fileStorage, setFileStorage] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [pendingText, setPendingText] = useState<{ text: string; files: string[] } | null>(null);
  const [input, setInput] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = project ? `/api/projects/${encodeURIComponent(project.id)}` : null;

  const fetchChat = useCallback(async () => {
    const res = await fetch(`${base}/chat`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load the conversation");
    return body as { messages: Message[]; alerts: BudgetAlert[]; configured: boolean; fileStorage: boolean };
  }, [base]);

  const show = useCallback((body: Awaited<ReturnType<typeof fetchChat>>) => {
    setMessages(body.messages);
    setAlerts(body.alerts);
    setConfigured(body.configured);
    setFileStorage(body.fileStorage);
    setLoadError(null);
  }, []);

  const load = useCallback(
    () => (base ? fetchChat().then(show, (err: Error) => setLoadError(err.message)) : Promise.resolve()),
    [base, fetchChat, show]
  );

  // The drawer remounts this per project, so loading once is enough.
  useEffect(() => {
    if (!base) return;
    let gone = false;
    fetchChat().then(
      (body) => !gone && show(body),
      (err: Error) => !gone && setLoadError(err.message)
    );
    return () => {
      gone = true;
    };
  }, [base, fetchChat, show]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages?.length, live?.text, live?.tools.length, live?.proposals.length, pendingText]);

  const busy = !!live || uploads.some((u) => !u.storageKey && !u.error);

  const addFiles = (files: FileList | File[]) => {
    if (!project) return;
    for (const file of Array.from(files).slice(0, 10)) {
      const entry: Upload = { file, progress: 0 };
      setUploads((u) => [...u, entry]);
      uploadToProject(project.id, file, (progress) =>
        setUploads((u) => u.map((x) => (x.file === file ? { ...x, progress } : x)))
      ).then(
        (storageKey) => setUploads((u) => u.map((x) => (x.file === file ? { ...x, storageKey, progress: 1 } : x))),
        (err: Error) => setUploads((u) => u.map((x) => (x.file === file ? { ...x, error: err.message } : x)))
      );
    }
  };

  const send = async (text: string) => {
    if (!base || busy) return;
    const ready = uploads.filter((u) => u.storageKey);
    if (!text.trim() && !ready.length) return;
    setInput("");
    setUploads([]);
    setPendingText({ text, files: ready.map((u) => u.file.name) });
    const state: Live = { text: "", tools: [], proposals: [], flags: [] };
    setLive({ ...state });
    const update = () => setLive({ ...state, tools: [...state.tools], proposals: [...state.proposals], flags: [...state.flags] });
    try {
      const res = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          attachments: ready.map((u) => ({ storageKey: u.storageKey, name: u.file.name, contentType: u.file.type || undefined })),
          phaseKey,
          taskId: task?.taskId,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "The assistant could not answer");
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += value;
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "text") state.text += e.delta;
          else if (e.type === "tool") {
            const at = state.tools.findIndex((t) => t.id === e.id);
            const entry = { id: e.id, label: e.label, status: e.status, note: e.note };
            if (at >= 0) state.tools[at] = entry;
            else state.tools.push(entry);
          } else if (e.type === "proposal") state.proposals.push(e.proposal);
          else if (e.type === "flag") state.flags.push(e.text);
          else if (e.type === "alert") {
            setAlerts((a) => [e.alert, ...a]);
            toast(e.alert.level === "limit" ? "This project's AI budget is used up" : "This project's AI spend passed its alert level");
          } else if (e.type === "error") state.error = e.error;
          update();
        }
        if (done) break;
      }
    } catch (err) {
      state.error = (err as Error).message;
      update();
    }
    // The reply's cost and anything it changed show on the project straight away.
    await Promise.all([
      load(),
      fetch(base, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => body?.project && receiveProject(body.project))
        .catch(() => {}),
    ]);
    setPendingText(null);
    setLive(null);
  };

  const resolve = async (proposal: Proposal, action: "apply" | "dismiss") => {
    if (!base) return;
    const res = await fetch(`${base}/chat/proposals/${proposal.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(body.error || "That did not work");
      return;
    }
    if (body.project) receiveProject(body.project);
    setMessages((list) =>
      list?.map((m) => ({
        ...m,
        proposals: m.proposals.map((p) => (p.id === proposal.id ? { ...p, status: action === "apply" ? "applied" : "dismissed" } : p)),
      })) ?? null
    );
    toast(action === "apply" ? "Done" : "Dismissed");
  };

  const dismissAlert = async (id: string) => {
    if (!base) return;
    setAlerts((a) => a.filter((x) => x.id !== id));
    await fetch(`${base}/ai/alerts/${id}`, { method: "DELETE" }).catch(() => {});
  };

  if (!project) {
    return (
      <div className="chat-log">
        <div className="stack" style={{ gap: "1rem", margin: "auto 0", padding: "1rem 0.25rem" }}>
          <h2 className="display-s">Open a project to get started.</h2>
          <p className="small muted">The assistant works inside one project at a time, with its brief, plan and documents in view.</p>
        </div>
      </div>
    );
  }

  const suggestions = ["What's left in this phase?", "Summarise the brief", "How much floor area do we have?"];

  return (
    <>
      <div
        className="chat-log"
        ref={logRef}
        onDragOver={(e) => {
          if (!fileStorage) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!fileStorage) return;
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        style={dragging ? { outline: "2px dashed var(--ink-3)", outlineOffset: -8 } : undefined}
      >
        {alerts.map((a) => (
          <div key={a.id} className="chat-card" data-tone={a.level === "limit" ? "bad" : "warn"}>
            <span className="row" style={{ gap: "0.4rem", alignItems: "flex-start" }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span className="grow">
                {a.level === "limit"
                  ? `AI spend on this project reached its budget of ${zar(a.budgetZar)}.`
                  : `AI spend on this project passed ${zar(a.spendZar)} of its ${zar(a.budgetZar)} budget.`}{" "}
                <Link href={`/projects/${project.id}/ai`} style={{ textDecoration: "underline" }}>See spend</Link>
              </span>
              <button type="button" className="icon-btn" aria-label="Dismiss alert" onClick={() => dismissAlert(a.id)} style={{ width: 26, height: 26 }}>
                <X size={14} />
              </button>
            </span>
          </div>
        ))}

        {loadError && <div className="chat-card" data-tone="bad">{loadError}</div>}
        {!configured && (
          <div className="chat-card" data-tone="warn">
            No AI model is set up yet.{" "}
            {viewer.isAdmin ? (
              <Link href="/settings" style={{ textDecoration: "underline" }}>Choose one in Settings</Link>
            ) : (
              "The Admin chooses one in Settings."
            )}
          </div>
        )}

        {messages && messages.length === 0 && !pendingText && (
          <div className="stack" style={{ gap: "1.25rem", margin: "auto 0", padding: "1rem 0.25rem" }}>
            <h2 className="display-s">
              {task ? <>What do you need for <em>{task.title}</em>?</> : <>How can I help with <em>{project.name}</em>?</>}
            </h2>
            <p className="small muted">
              I can read the brief, the plan and your documents, draft the brief from notes, and file what you drop in here.
              Nothing changes until you confirm it.
            </p>
            <div className="row wrap" style={{ gap: "0.5rem" }}>
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={!configured}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages?.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="bubble bubble-me">
              {m.content}
              {m.attachments.length > 0 && (
                <div className="chat-files">
                  {m.attachments.map((a) => (
                    <span key={a.storageKey} className="chat-tool" style={{ background: "transparent", color: "inherit" }}>
                      <FileText size={12} /> {a.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <AssistantMessage key={m.id} message={m} onResolve={resolve} />
          )
        )}

        {pendingText && (
          <div className="bubble bubble-me">
            {pendingText.text}
            {pendingText.files.length > 0 && (
              <div className="chat-files">
                {pendingText.files.map((f) => (
                  <span key={f} className="chat-tool" style={{ background: "transparent", color: "inherit" }}>
                    <FileText size={12} /> {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {live && (
          <>
            {live.tools.length > 0 && (
              <div className="chat-activity">
                {live.tools.map((t) => (
                  <span key={t.id} className="chat-tool" data-status={t.status}>
                    {t.status === "running" ? <Loader2 size={12} className="spin" /> : t.status === "done" ? <Check size={12} /> : <X size={12} />}
                    {t.label}
                    {t.note ? `: ${t.note}` : ""}
                  </span>
                ))}
              </div>
            )}
            {live.text ? (
              <div className="bubble bubble-ai">
                <Rich text={live.text} />
              </div>
            ) : (
              !live.error && (
                <div className="bubble bubble-ai" style={{ padding: 0 }}>
                  <span className="typing"><span /><span /><span /></span>
                </div>
              )
            )}
            {live.flags.map((f, i) => (
              <div key={i} className="chat-card" data-tone="warn">{f}</div>
            ))}
            {live.proposals.map((p) => (
              <div key={p.id} className="chat-card">
                <span>{p.summary}</span>
                <span className="tiny muted">You can confirm this once the reply finishes.</span>
              </div>
            ))}
            {live.error && <div className="chat-card" data-tone="bad">{live.error}</div>}
          </>
        )}
      </div>

      {uploads.length > 0 && (
        <div className="chat-files">
          {uploads.map((u) => (
            <span key={u.file.name + u.file.size} className="chat-tool" data-status={u.error ? "failed" : undefined} title={u.error}>
              {u.storageKey ? <FileText size={12} /> : u.error ? <X size={12} /> : <Loader2 size={12} className="spin" />}
              {u.file.name}
              {!u.storageKey && !u.error && ` ${Math.round(u.progress * 100)}%`}
              <button
                type="button"
                aria-label={`Remove ${u.file.name}`}
                onClick={() => setUploads((list) => list.filter((x) => x !== u))}
                style={{ display: "inline-flex", marginLeft: 2 }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        {fileStorage && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button type="button" className="icon-btn composer-attach" aria-label="Attach files" onClick={() => fileRef.current?.click()}>
              <Paperclip size={17} />
            </button>
          </>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={task ? `Ask about ${task.title}…` : `Ask about ${project.name}…`}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            if (fileStorage && e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: 38, height: 38, padding: 0 }}
          aria-label="Send"
          disabled={busy || !configured || (!input.trim() && !uploads.some((u) => u.storageKey))}
        >
          <ArrowUp size={17} />
        </button>
      </form>
    </>
  );
}

function AssistantMessage({ message, onResolve }: { message: Message; onResolve: (p: Proposal, action: "apply" | "dismiss") => Promise<void> }) {
  const [working, setWorking] = useState<string | null>(null);
  const tools = message.events.filter((e): e is Extract<ChatEvent, { type: "tool" }> => e.type === "tool");
  return (
    <>
      {tools.length > 0 && (
        <div className="chat-activity">
          {tools.map((t, i) => (
            <span key={i} className="chat-tool" data-status={t.ok ? "done" : "failed"} title={t.note}>
              {t.ok ? <Wrench size={11} /> : <X size={12} />} {t.label}
              {t.note && t.ok ? `: ${t.note}` : ""}
            </span>
          ))}
        </div>
      )}
      {message.content.trim() && (
        <div className="bubble bubble-ai">
          <Rich text={message.content} />
          {message.costZar > 0 && <div className="bubble-cost">Cost {zar(message.costZar)}</div>}
        </div>
      )}
      {message.events.map((e, i) =>
        e.type === "flag" ? (
          <div key={i} className="chat-card" data-tone="warn">
            <span className="row" style={{ gap: "0.4rem", alignItems: "flex-start" }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> {e.text}
            </span>
          </div>
        ) : e.type === "error" ? (
          <div key={i} className="chat-card" data-tone="bad">{e.text}</div>
        ) : null
      )}
      {message.proposals.map((p) => (
        <div key={p.id} className="chat-card">
          <span>{p.summary}</span>
          {p.status === "pending" ? (
            <span className="row" style={{ gap: "0.4rem", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!!working}
                onClick={async () => {
                  setWorking(p.id);
                  await onResolve(p, "dismiss");
                  setWorking(null);
                }}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!!working}
                onClick={async () => {
                  setWorking(p.id);
                  await onResolve(p, "apply");
                  setWorking(null);
                }}
              >
                {working === p.id ? "Saving…" : "Confirm"}
              </button>
            </span>
          ) : (
            <span className="tiny muted row" style={{ gap: "0.3rem" }}>
              {p.status === "applied" ? <><Check size={12} /> Confirmed</> : "Dismissed"}
            </span>
          )}
        </div>
      ))}
    </>
  );
}
