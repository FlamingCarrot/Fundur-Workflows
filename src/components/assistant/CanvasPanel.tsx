"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Download, FileDown, FolderInput, History, Loader2, Printer } from "lucide-react";
import { documentPage, markdownToHtml } from "@/lib/ai/markdown";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";
import type { Project } from "@/lib/studio/types";

/**
 * The canvas: a document from the chat open next to the conversation. She
 * edits it here (saved as she types, each save a version) while she can still
 * ask Fundur to change it below, and downloads it for Word, as a PDF or as
 * Markdown, or files it with the project's documents.
 */

interface Doc {
  id: string;
  kind: "document" | "research";
  title: string;
  content: string;
  version: number;
  updatedAt: string;
}

interface Version {
  version: number;
  title: string;
  savedAt: string;
}

const MODES = ["preview", "edit"] as const;

export function CanvasPanel({
  docId,
  project,
  refresh,
  onClose,
  toast,
  onProject,
}: {
  docId: string;
  project: Project | undefined;
  /** Bumped when the assistant saved this document, to show its changes. */
  refresh: number;
  onClose: () => void;
  toast: (message: string) => void;
  onProject: (project: Project) => void;
}) {
  const query = project ? `?project=${encodeURIComponent(project.id)}` : "";
  const [doc, setDoc] = useState<Doc | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useViewSetting("assistant.canvas.mode", "preview", oneOf(MODES));
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [showVersions, setShowVersions] = useState(false);
  const [filing, setFiling] = useState(false);
  const [copied, setCopied] = useState(false);
  const docRef = useRef<Doc | null>(null);
  const draftRef = useRef(draft);
  useEffect(() => {
    docRef.current = doc;
    draftRef.current = draft;
  });

  const fetchDoc = useCallback(async () => {
    const res = await fetch(`/api/assistant/documents/${docId}${query}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not open the document");
    return body as { document: Doc; versions: Version[] };
  }, [docId, query]);

  useEffect(() => {
    let gone = false;
    // Her unsaved typing is never replaced by a reload.
    if (draftRef.current) return;
    fetchDoc().then(
      (b) => {
        if (gone) return;
        setDoc(b.document);
        setVersions(b.versions);
        setError(null);
      },
      (err: Error) => !gone && setError(err.message)
    );
    return () => {
      gone = true;
    };
  }, [fetchDoc, refresh]);

  const save = useCallback(
    async (next: { title: string; content: string }) => {
      const current = docRef.current;
      if (!current) return;
      setSaving("saving");
      const res = await fetch(`/api/assistant/documents/${current.id}${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...next, expectedVersion: current.version }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (res?.status === 409 && body.document) {
        toast("Fundur changed this document while you typed. Showing its version; your last words are copied, paste them back if you need them.");
        void navigator.clipboard?.writeText(next.content).catch(() => {});
        setDoc(body.document);
        setDraft(null);
        setSaving("idle");
        return;
      }
      if (!res?.ok) {
        toast(body.error || "Could not save. Check your connection.");
        setSaving("idle");
        return;
      }
      setDoc(body.document);
      // Typing that came in while saving stays as the next draft.
      setDraft((d) => (d && d.title === next.title && d.content === next.content ? null : d));
      setSaving("saved");
      fetchDoc().then((b) => setVersions(b.versions), () => {});
    },
    [query, toast, fetchDoc]
  );

  // Saved a moment after she stops typing.
  useEffect(() => {
    if (!draft) return;
    const t = window.setTimeout(() => void save(draft), 1_200);
    return () => window.clearTimeout(t);
  }, [draft, save]);

  const title = draft?.title ?? doc?.title ?? "";
  const content = draft?.content ?? doc?.content ?? "";
  const edit = (patch: Partial<{ title: string; content: string }>) => setDraft({ title, content, ...patch });

  const fileName = (ext: string) => `${(title || "Document").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120)}.${ext}`;
  const download = (body: string, type: string, ext: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(ext);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return toast("Allow pop-ups for this site to save as PDF");
    w.document.write(documentPage(title, content));
    w.document.close();
    w.focus();
    window.setTimeout(() => w.print(), 300);
  };
  const fileInProject = async () => {
    if (!project || !doc) return;
    if (draft) await save(draft);
    setFiling(true);
    const res = await fetch(`/api/assistant/documents/${doc.id}/file${query}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setFiling(false);
    if (!res?.ok) return toast(body.error || "Could not file it. Check your connection.");
    if (body.project) onProject(body.project);
    toast(`Filed as ${body.name} in the project's documents`);
  };
  const restore = async (v: Version) => {
    const res = await fetch(`/api/assistant/documents/${docId}${query}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restore: v.version }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return toast(body.error || "Could not go back to that version");
    setDoc(body.document);
    setDraft(null);
    setShowVersions(false);
    fetchDoc().then((b) => setVersions(b.versions), () => {});
    toast(`Back to version ${v.version}. Going back is a version too, so you can undo it.`);
  };

  return (
    <div className="chat-log canvas-panel">
      <div className="row" style={{ gap: "0.4rem" }}>
        <button type="button" className="icon-btn" aria-label="Back to the chat" onClick={onClose}>
          <ArrowLeft size={17} />
        </button>
        <input className="canvas-title grow" value={title} maxLength={200} aria-label="Document title" onChange={(e) => edit({ title: e.target.value })} disabled={!doc} />
        <span className="tiny muted" aria-live="polite" style={{ flexShrink: 0 }}>
          {saving === "saving" ? "Saving…" : draft ? "Unsaved" : doc ? `v${doc.version}` : ""}
        </span>
      </div>

      {error && <div className="chat-card" data-tone="bad">{error}</div>}
      {!doc && !error && <Loader2 size={18} className="spin" />}

      {doc && (
        <>
          <div className="canvas-tools">
            <div className="segmented" role="group" aria-label="Canvas mode">
              {MODES.map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === "preview" ? "Read" : "Edit"}
                </button>
              ))}
            </div>
            <span className="grow" />
            <button
              type="button"
              className="icon-btn"
              aria-label={copied ? "Copied" : "Copy the text"}
              title="Copy"
              onClick={() => {
                void navigator.clipboard?.writeText(content).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1_500);
                });
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            <button type="button" className="icon-btn" aria-label="Download for Word" title="Download for Word (.doc)" onClick={() => download(documentPage(title, content), "application/msword", "doc")}>
              <FileDown size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Print or save as PDF" title="Print or save as PDF" onClick={print}>
              <Printer size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label="Download as Markdown" title="Download as Markdown (.md)" onClick={() => download(content, "text/markdown", "md")}>
              <Download size={16} />
            </button>
            {versions.length > 0 && (
              <button type="button" className="icon-btn" aria-label="Earlier versions" aria-expanded={showVersions} title="Earlier versions" onClick={() => setShowVersions(!showVersions)}>
                <History size={16} />
              </button>
            )}
            {project && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={filing} onClick={() => void fileInProject()} title="Save it with the project's documents as a Word file">
                {filing ? <Loader2 size={14} className="spin" /> : <FolderInput size={14} />} File it
              </button>
            )}
          </div>
          {showVersions && (
            <div className="canvas-versions">
              {versions.map((v) => (
                <button key={v.version} type="button" className="canvas-version" onClick={() => void restore(v)}>
                  <span className="small">Version {v.version}</span>
                  <span className="tiny muted">{new Date(v.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · Go back to it</span>
                </button>
              ))}
            </div>
          )}
          {mode === "edit" ? (
            <textarea className="canvas-editor" value={content} aria-label="Document text (Markdown)" onChange={(e) => edit({ content: e.target.value })} spellCheck />
          ) : (
            <article className="canvas-doc" dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }} onDoubleClick={() => setMode("edit")} />
          )}
          <p className="tiny muted">Ask Fundur below to change it, or switch to Edit and type. Every save is a version you can go back to.</p>
        </>
      )}
    </div>
  );
}
