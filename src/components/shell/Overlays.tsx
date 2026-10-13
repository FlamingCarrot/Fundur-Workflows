"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ArrowUp, Sparkles, Check } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { getForm, getPhase, getWorkflow, label } from "@/lib/workflow";
import { projectTasks } from "@/lib/studio/tasks";
import { phaseProgress } from "@/lib/studio/selectors";
import { zar } from "@/lib/studio/format";
import { Swatch } from "@/components/ui/primitives";
import { IssueSheet, projectIdFromPath } from "./IssueSheet";
import { LiveAssistant } from "@/components/assistant/LiveAssistant";
import { useMobileDialog } from "@/hooks/useMobileDialog";
import { SearchPalette } from "./SearchPalette";
import type { Project } from "@/lib/studio/types";
import type { AssistantPage } from "@/lib/ai/context";

/** The page the assistant is opened from, so it knows what she is looking at. */
export function assistantPage(pathname: string): AssistantPage {
  const m = pathname.match(/^\/projects\/[^/]+(?:\/([^/]+))?(?:\/[^/]+\/?([^/]+)?)?/);
  if (!m) return "other";
  const part = m[1];
  if (!part) return "project";
  if (part === "phases") return m[2] === "complete" ? "phase" : "phase";
  if (part === "plan" || part === "layout" || part === "brief" || part === "documents" || part === "ai") return part;
  return "other";
}

/** Screens without the app's navigation, where the assistant still needs a way in. */
const FOCUS_SCREEN = /^\/projects\/[^/]+\/(plan|layout|brief|phases\/[^/]+\/complete)/;

export function Overlays() {
  const { assistantOpen, setAssistantOpen, issueSheet, searchOpen, toasts, viewer } = useStudio();
  const pathname = usePathname();
  const inProject = !!projectIdFromPath(pathname);
  const aiAllowed = viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";

  // Ctrl+J (⌘J on a Mac) opens and closes the assistant from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (aiAllowed && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpen(!assistantOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aiAllowed, assistantOpen, setAssistantOpen]);

  return (
    <>
      {assistantOpen && aiAllowed && <AssistantDrawer />}
      {!assistantOpen && aiAllowed && inProject && FOCUS_SCREEN.test(pathname) && (
        <button type="button" className="fab fab-focus" aria-label="Ask Fundur" onClick={() => setAssistantOpen(true)} title="Ask Fundur (Ctrl+J)">
          <Sparkles size={17} />
          <span className="fab-text">Ask Fundur</span>
        </button>
      )}
      {searchOpen && <SearchPalette />}
      {issueSheet && <IssueSheet />}
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

function useEscape(onClose: () => void, onlyInside = false) {
  useEffect(() => {
    // Docked beside the plan, Escape belongs to the editor unless she is in the chat.
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && (!onlyInside || (e.target as HTMLElement | null)?.closest?.(".drawer")) && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onlyInside]);
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
  const phase = getPhase(project, project.currentPhase);
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
    const briefLabel = label(project, "brief", "Brief");
    const filled = (getForm(project, "brief")?.fields ?? []).filter((f) => project.brief[f.key]?.trim());
    return {
      from: "ai",
      cost: 0.02,
      text: filled.length ? (
        <ul style={{ margin: "0 0 0 1.1rem" }}>
          {filled.map((f) => (
            <li key={f.key}>
              <strong>{f.label}:</strong> {project.brief[f.key]}
            </li>
          ))}
        </ul>
      ) : (
        `The ${briefLabel.toLowerCase()} is still empty. Drafting it from your meeting notes is the quickest start.`
      ),
    };
  }
  return {
    from: "ai",
    cost: 0.03,
    text: `Noted against ${project.name}. I've checked it against the brief and the ${phase?.name ?? "current"} checklist; nothing conflicts.`,
  };
}

function AssistantDrawer() {
  const mobileStyle = useMobileDialog();
  const { setAssistantOpen, getProject, persistence, assistantTask, assistantRequest, viewer } = useStudio();
  const pathname = usePathname();
  const projectId = assistantRequest?.projectId ?? assistantTask?.projectId ?? projectIdFromPath(pathname) ?? null;
  const project = projectId ? getProject(projectId) : undefined;
  // The phase she is looking at, else the project's current one.
  const viewedPhase = pathname.match(/^\/projects\/[^/]+\/phases\/([^/]+)/)?.[1];
  const boardKey = pathname.match(/^\/projects\/[^/]+\/boards\/([^/]+)/)?.[1];
  const itemKey = pathname.match(/^\/projects\/[^/]+\/items\/([^/]+)/)?.[1];
  const focusModule = /\/plan(?:\/|$)/.test(pathname) ? "floor_plan_editor" : /\/layout(?:\/|$)/.test(pathname) ? "layout_generator" : boardKey ? `canvas_board:${boardKey}` : itemKey ? `item_register:${itemKey}` : null;
  const focusPhase = project && focusModule ? getWorkflow(project).phases.find((p) => p.modules.some((m) => m === focusModule || m.startsWith(`${focusModule}:`)))?.key : undefined;
  const taskPhase = project && assistantTask?.projectId === project.id ? projectTasks(project).find(t => t.id === assistantTask.taskId)?.phaseKey : undefined;
  const phase = project ? getPhase(project, assistantRequest?.phaseKey ?? taskPhase ?? viewedPhase ?? focusPhase ?? project.currentPhase) : undefined;
  const task = assistantTask && assistantTask.projectId === project?.id ? assistantTask : null;
  const live = persistence === "server";

  const page = assistantPage(pathname);
  // On the plan and layouts the drawer sits beside the drawing, so she can watch it being drawn and keep selecting.
  const docked = page === "plan" || page === "layout";

  const close = React.useCallback(() => setAssistantOpen(false), [setAssistantOpen]);
  useEscape(close, docked);

  return (
    <>
      {!docked && <div className="scrim" onClick={close} />}
      <aside className={`drawer${docked ? " drawer-docked" : ""}`} role={docked ? "complementary" : "dialog"} aria-modal={docked ? undefined : true} aria-label="Assistant" style={mobileStyle}>
        <div className="row-between" style={{ padding: "1.1rem 1.1rem 0.9rem 1.35rem", borderBottom: "1px solid var(--line)" }}>
          <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
            <span className="row" style={{ gap: "0.45rem", fontWeight: 600 }}>
              <Sparkles size={16} color="var(--accent)" /> Ask Fundur
            </span>
            <span className="tiny muted row truncate" style={{ gap: "0.4rem" }}>
              {project ? (
                <>
                  <Swatch swatch={project.swatch} /> {project.name} · {task ? task.title : phase?.name}
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
        {live ? <LiveAssistant key={`${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}.${project?.id ?? "none"}.${assistantRequest?.id ?? assistantTask?.taskId ?? "general"}`} project={project} phaseKey={phase?.key} page={page} /> : <DemoAssistant key={`${project?.id}.${assistantRequest?.id ?? assistantTask?.taskId ?? "general"}`} project={project} />}
      </aside>
    </>
  );
}

/** The demo's assistant: replies are simulated from the project in the browser, with pretend costs. */
function DemoAssistant({ project }: { project: Project | undefined }) {
  const { addAiSpend, assistantRequest, assistantTask } = useStudio();
  const phase = project ? getPhase(project, project.currentPhase) : undefined;

  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState(() => assistantRequest && assistantRequest.projectId === project?.id ? assistantRequest.prompt : assistantTask && assistantTask.projectId === project?.id ? `Help me with ${assistantTask.title}` : "");
  const [thinking, setThinking] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const key = project?.id ?? "_";
  const messages = threads[key] ?? [];

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
    </>
  );
}
