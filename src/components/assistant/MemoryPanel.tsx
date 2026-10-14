"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Project } from "@/lib/studio/types";

/**
 * What the assistant remembers, in the chat drawer: the studio's memories and
 * the open project's, each one editable and deletable, with a way to add
 * your own, the notes it wrote after recent tasks, and the switch that stops
 * it learning. Memories go into its instructions on every reply.
 */

interface Memory {
  id: string;
  text: string;
  scope: "project" | "studio";
  source: "learned" | "person";
  updatedAt: string;
}

interface Note {
  id: string;
  summary: string;
  tools: string[];
  changes: string[];
  learned: string[];
  createdAt: string;
}

export function MemoryPanel({
  project,
  learn,
  setLearn,
  onClose,
  toast,
}: {
  project: Project | undefined;
  learn: boolean;
  setLearn: (on: boolean) => void;
  onClose: () => void;
  toast: (message: string) => void;
}) {
  const query = project ? `?project=${encodeURIComponent(project.id)}` : "";
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const [addScope, setAddScope] = useState<"project" | "studio">(project ? "project" : "studio");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/assistant/memory${query}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load what Fundur remembers");
    return body as { memories: Memory[]; notes: Note[] };
  }, [query]);

  useEffect(() => {
    let gone = false;
    load().then(
      (b) => {
        if (gone) return;
        setMemories(b.memories);
        setNotes(b.notes);
      },
      (err: Error) => !gone && setError(err.message)
    );
    return () => {
      gone = true;
    };
  }, [load]);

  const call = async (url: string, init: RequestInit) => {
    setSaving(true);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "That did not save");
      return body;
    } catch (err) {
      toast((err as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const body = await call(`/api/assistant/memory${query}`, { method: "POST", body: JSON.stringify({ text: adding, scope: addScope }) });
    if (!body?.memory) return;
    setMemories((list) => [body.memory, ...(list ?? [])]);
    setAdding("");
  };

  const save = async () => {
    if (!editing) return;
    if (!(await call(`/api/assistant/memory/${editing.id}${query}`, { method: "PATCH", body: JSON.stringify({ text: editing.text }) }))) return;
    setMemories((list) => list?.map((m) => (m.id === editing.id ? { ...m, text: editing.text.trim(), source: "person" } : m)) ?? null);
    setEditing(null);
  };

  const remove = async (m: Memory) => {
    if (!(await call(`/api/assistant/memory/${m.id}${query}`, { method: "DELETE" }))) return;
    setMemories((list) => list?.filter((x) => x.id !== m.id) ?? null);
    toast("Forgotten");
  };

  const group = (scope: Memory["scope"]) => (memories ?? []).filter((m) => m.scope === scope);
  const sections: { scope: Memory["scope"]; title: string; empty: string }[] = [
    ...(project ? [{ scope: "project" as const, title: `About ${project.name}`, empty: "Nothing yet. Client wishes, decisions and sizes from your chats will show here." }] : []),
    { scope: "studio", title: "About your studio", empty: "Nothing yet. How you like to work, your standards and suppliers will show here." },
  ];

  return (
    <div className="chat-log memory-panel">
      <div className="row" style={{ gap: "0.5rem" }}>
        <button type="button" className="icon-btn" aria-label="Back to the chat" onClick={onClose}>
          <ArrowLeft size={17} />
        </button>
        <h2 className="display-s grow" style={{ fontSize: "1.25rem" }}>What Fundur remembers</h2>
      </div>
      <p className="small muted">
        After every task Fundur writes a short note and keeps what it learned, so it fits your work better the more you use it. Memories
        stay in your workspace, your team sees them, and you can change or delete any of them.
      </p>
      <label className="row small" style={{ gap: "0.5rem", cursor: "pointer" }}>
        <button type="button" role="switch" aria-checked={learn} aria-label="Learn from our chats" className="switch" onClick={() => setLearn(!learn)} />
        {learn ? "Learning from your chats" : "Not learning: no notes, and memories are not used"}
      </label>

      {error && <div className="chat-card" data-tone="bad">{error}</div>}
      {!memories && !error && <Loader2 size={18} className="spin" />}

      {memories && (
        <form
          className="memory-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (adding.trim().length >= 2 && !saving) void add();
          }}
        >
          <input
            className="input"
            value={adding}
            maxLength={400}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Tell Fundur something to remember…"
            aria-label="Something to remember"
          />
          {project && (
            <select className="input" value={addScope} onChange={(e) => setAddScope(e.target.value as typeof addScope)} aria-label="Remember it for">
              <option value="project">This project</option>
              <option value="studio">All work</option>
            </select>
          )}
          <button type="submit" className="btn btn-primary btn-sm" disabled={adding.trim().length < 2 || saving}>
            <Plus size={14} /> Add
          </button>
        </form>
      )}

      {memories &&
        sections.map((sec) => (
          <section key={sec.scope} className="stack" style={{ gap: "0.4rem" }}>
            <h3 className="small strong">{sec.title}</h3>
            {group(sec.scope).length === 0 && <p className="tiny muted">{sec.empty}</p>}
            {group(sec.scope).map((m) =>
              editing?.id === m.id ? (
                <form
                  key={m.id}
                  className="memory-item"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <input className="input grow" autoFocus value={editing.text} maxLength={400} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} aria-label="Memory" onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                  <button type="submit" className="icon-btn" aria-label="Save" disabled={saving || editing.text.trim().length < 2}>
                    <Check size={15} />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setEditing(null)}>
                    <X size={15} />
                  </button>
                </form>
              ) : (
                <div key={m.id} className="memory-item">
                  <span className="grow small">
                    {m.text}
                    <span className="tiny muted"> · {m.source === "person" ? "you told it" : "learned"}</span>
                  </span>
                  <button type="button" className="icon-btn" aria-label="Change this memory" onClick={() => setEditing({ id: m.id, text: m.text })}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Forget this" disabled={saving} onClick={() => void remove(m)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            )}
          </section>
        ))}

      {notes.length > 0 && (
        <section className="stack" style={{ gap: "0.4rem" }}>
          <h3 className="small strong">Notes from recent tasks</h3>
          {notes.map((n) => (
            <div key={n.id} className="memory-note">
              <span className="small">{n.summary}</span>
              {n.tools.length > 0 && <span className="tiny muted">Tools: {n.tools.join(", ")}</span>}
              {n.learned.length > 0 && <span className="tiny muted">Learned: {n.learned.join(" ")}</span>}
              <span className="tiny muted">{new Date(n.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
