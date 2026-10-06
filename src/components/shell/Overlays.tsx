"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ArrowUp, Sparkles, Check, LifeBuoy } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getPhase, getWorkflow } from "@/lib/workflow";
import { phaseProgress } from "@/lib/studio/selectors";
import { zar } from "@/lib/studio/format";
import { Swatch } from "@/components/ui/primitives";
import type { Project } from "@/lib/studio/types";

export function Overlays() {
  const { assistantOpen, issueSheetOpen, toasts } = useStudio();
  return (
    <>
      {assistantOpen && <AssistantDrawer />}
      {issueSheetOpen && <IssueSheet />}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <Check size={15} strokeWidth={2.5} />
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m && m[1] !== "new" ? m[1] : null;
}

interface Message {
  from: "ai" | "me";
  text: React.ReactNode;
  cost?: number;
}

// Replies are simulated until the AI layer is connected; costs mirror worker-tier pricing.
function replyTo(prompt: string, project: Project | undefined): Message {
  const lower = prompt.toLowerCase();
  if (!project) {
    return {
      from: "ai",
      text: "Open a project and I'll answer with its brief, documents and checklist in view.",
    };
  }
  const phase = getPhase(project.workflowId, project.currentPhase);
  if (lower.includes("left") || lower.includes("next")) {
    const { items } = phaseProgress(project, project.currentPhase);
    const open = items.filter((i) => !project.checks[i.id]);
    return {
      from: "ai",
      cost: 0.01,
      text: open.length ? (
        <>
          {open.length} step{open.length > 1 ? "s" : ""} left in {phase?.name}:
          <ul style={{ margin: "0.4rem 0 0 1.1rem" }}>
            {open.map((i) => (
              <li key={i.id}>{i.text}</li>
            ))}
          </ul>
        </>
      ) : (
        <>Every step in {phase?.name} is done. You can complete the phase.</>
      ),
    };
  }
  if (lower.includes("brief") && lower.includes("draft")) {
    return {
      from: "ai",
      cost: 0,
      text: (
        <>
          Drop your meeting notes in and I&apos;ll fill the brief for you to review.{" "}
          <Link href={`/projects/${project.id}/brief/draft`} style={{ textDecoration: "underline" }}>
            Start a draft
          </Link>
        </>
      ),
    };
  }
  if (lower.includes("brief") || lower.includes("summar")) {
    const b = project.brief;
    return {
      from: "ai",
      cost: 0.02,
      text: b.headcount
        ? `${b.clientName}: ${b.headcount} people, ${b.spaceRequirements || "area not set"}, budget ${b.targetBudget || "not set"}. ${b.notes}`
        : "The brief is still empty. Drafting it from your meeting notes is the quickest start.",
    };
  }
  return {
    from: "ai",
    cost: 0.03,
    text: `Noted against ${project.name}. I've checked it against the brief and the ${phase?.name ?? "current"} checklist; nothing conflicts.`,
  };
}

function AssistantDrawer() {
  const { setAssistantOpen, getProject, addAiSpend } = useStudio();
  const pathname = usePathname();
  const projectId = projectIdFromPath(pathname);
  const project = projectId ? getProject(projectId) : undefined;
  const phase = project ? getPhase(project.workflowId, project.currentPhase) : undefined;

  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const key = project?.id ?? "_";
  const messages = threads[key] ?? [];

  const close = React.useCallback(() => setAssistantOpen(false), [setAssistantOpen]);
  useEscape(close);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, thinking]);

  const suggestions = project
    ? ["What's left in this phase?", "Summarise the brief", ...(phase?.ai_actions ?? []).map((a) => a.name)]
    : [];

  const send = (text: string) => {
    if (!text.trim() || thinking) return;
    setThreads((t) => ({ ...t, [key]: [...(t[key] ?? []), { from: "me", text }] }));
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const reply = replyTo(text, project);
      if (project && reply.cost) addAiSpend(project.id, reply.cost);
      setThreads((t) => ({ ...t, [key]: [...(t[key] ?? []), reply] }));
      setThinking(false);
    }, 850);
  };

  return (
    <>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-label="Assistant">
        <div className="row-between" style={{ padding: "1.1rem 1.1rem 0.9rem 1.35rem", borderBottom: "1px solid var(--line)" }}>
          <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
            <span className="row" style={{ gap: "0.45rem", fontWeight: 600 }}>
              <Sparkles size={16} color="var(--accent)" /> Ask Fundur
            </span>
            <span className="tiny muted row truncate" style={{ gap: "0.4rem" }}>
              {project ? (
                <>
                  <Swatch swatch={project.swatch} /> {project.name} · {phase?.name}
                </>
              ) : (
                "No project open"
              )}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close assistant">
            <X size={18} />
          </button>
        </div>

        <div className="chat-log" ref={logRef}>
          {messages.length === 0 && (
            <div className="stack" style={{ gap: "1.25rem", margin: "auto 0", padding: "1rem 0.25rem" }}>
              <h2 className="display-s">
                {project ? <>How can I help with <em>{project.name}</em>?</> : "Open a project to get started."}
              </h2>
              <p className="small muted">
                I see the brief, the documents and every step of this project. You approve anything I draft before it&apos;s used.
              </p>
              <div className="row wrap" style={{ gap: "0.5rem" }}>
                {suggestions.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.from === "ai" ? "bubble-ai" : "bubble-me"}`}>
              {m.text}
              {m.from === "ai" && m.cost != null && m.cost > 0 && (
                <div className="bubble-cost">Cost {zar(m.cost)}</div>
              )}
            </div>
          ))}
          {thinking && (
            <div className="bubble bubble-ai" style={{ padding: 0 }}>
              <span className="typing"><span /><span /><span /></span>
            </div>
          )}
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder={project ? `Ask about ${project.name}…` : "Ask anything…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button type="submit" className="btn btn-primary" style={{ width: 38, height: 38, padding: 0 }} aria-label="Send" disabled={!input.trim()}>
            <ArrowUp size={17} />
          </button>
        </form>
      </aside>
    </>
  );
}

function guessModule(pathname: string): string {
  if (pathname.includes("/brief")) return "structured_form";
  if (pathname.includes("/documents")) return "documents";
  if (pathname.includes("/phases/")) return "checklist";
  return "phase_bar";
}

function IssueSheet() {
  const { setIssueSheetOpen, reportIssue, toast } = useStudio();
  const pathname = usePathname();
  const [moduleKey, setModuleKey] = useState(() => guessModule(pathname));
  const [note, setNote] = useState("");
  const close = React.useCallback(() => setIssueSheetOpen(false), [setIssueSheetOpen]);
  useEscape(close);

  const modules = Object.values(MODULE_REGISTRY).filter((m) => m.key !== "report_issue");
  // Keep the workflow's own word for the brief form.
  const wf = getWorkflow("");
  const nameFor = (key: string, fallback: string) => (key === "structured_form" ? wf.labels.brief ?? fallback : fallback);

  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet" role="dialog" aria-label="Report an issue">
        <div className="row-between" style={{ marginBottom: "1.25rem" }}>
          <span className="dropzone-icon" style={{ width: 44, height: 44, margin: 0 }}>
            <LifeBuoy size={20} />
          </span>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <h2 className="display-s" style={{ marginBottom: "0.35rem" }}>Something not right?</h2>
        <p className="small muted" style={{ marginBottom: "1.4rem" }}>
          Tell us where it happened. It&apos;s pinned to this page and goes straight to the admin queue.
        </p>
        <span className="eyebrow">Where</span>
        <div className="row wrap" style={{ gap: "0.45rem", margin: "0.6rem 0 1.25rem" }}>
          {modules.map((m) => (
            <button
              key={m.key}
              type="button"
              className="chip"
              aria-pressed={moduleKey === m.key}
              onClick={() => setModuleKey(m.key)}
            >
              {nameFor(m.key, m.name)}
            </button>
          ))}
        </div>
        <textarea
          className="textarea"
          rows={4}
          autoFocus
          placeholder="What happened, and what did you expect?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: "1.25rem" }}>
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!note.trim()}
            onClick={() => {
              reportIssue(moduleKey, note.trim());
              close();
              toast("Thanks, your report is in the queue");
            }}
          >
            Send report
          </button>
        </div>
      </div>
    </>
  );
}
