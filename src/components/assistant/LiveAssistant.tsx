"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUp, AudioLines, Bot, Box, Check, ChevronDown, Copy, Crosshair, FileText, Loader2, Mic, Paperclip, Pencil, RotateCcw, Square, Undo2, Volume2, VolumeX, Wrench, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { assistantBridge, useBoardFocus, usePlanFocus } from "@/lib/assistant/bridge";
import type { DesignBoard } from "@/lib/design/schema";
import { refreshLibrary } from "@/lib/blueprints/client";
import type { AssistantPage } from "@/lib/ai/context";
import type { Plan } from "@/lib/plan/geometry";
import { tokens, zar } from "@/lib/studio/format";
import { uploadToProject } from "@/lib/studio/uploads";
import type { Project } from "@/lib/studio/types";
import { phaseAssistantSuggestions } from "@/lib/workflow/guidance";
import { useTextDraft } from "@/hooks/useTextDraft";
import { useVoice } from "@/hooks/useVoice";
import { isBoolean, useViewSetting } from "@/lib/view-settings/client";

/**
 * The project chat (P4-10, P4-11) once projects live on the server: one
 * conversation per project, streamed as the assistant writes, with the tools
 * it ran, work that failed review, the changes it made (each with Undo) and
 * the ones waiting for her to confirm. It knows the page she is on and what
 * she has selected on the plan, and its plan edits draw in the open editor as
 * they land. The next likely asks sit under the conversation at all times.
 * Usage shows in tokens; the Admin also sees money and each reply's calls.
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
  | { type: "error"; text: string }
  | { type: "context"; text: string }
  | { type: "autopilot"; runId: string }
  | { type: "blueprint"; id: string; name: string };

interface Proposal {
  id: string;
  summary: string;
  kind: string;
  status: "pending" | "applied" | "dismissed" | "undone";
  direct: boolean;
  undoable: boolean;
  /** A project the assistant started, once confirmed. */
  created?: { id: string; name: string };
}

interface Breakdown {
  runs: {
    model: string;
    provider: string;
    role: string;
    task: string;
    inputTokens: number;
    outputTokens: number;
    costZar: number;
    costUsd: number;
    fallback: boolean;
    ok: boolean;
  }[];
  tools: { name: string; ok: boolean; durationMs: number }[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: Attachment[];
  events: ChatEvent[];
  proposals: Proposal[];
  costZar: number;
  tokens: { input: number; output: number };
  breakdown?: Breakdown;
  /** Changes from replies this message replaced that are still in place. */
  kept?: Proposal[];
  /** Hers, so she can edit it or ask for its reply again. */
  mine?: boolean;
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
  /** Blueprints it saved, to open. */
  made: { id: string; name: string }[];
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
  // Runs of list lines become lists, table lines stay as they are, anything else is a paragraph.
  const isItem = (l: string) => /^\s*([-*•]|\d+[.)])\s+/.test(l);
  const isTable = (l: string) => l.trim().startsWith("|");
  const groups: { kind: "ul" | "ol" | "table" | "p"; lines: string[] }[] = [];
  for (const line of text.trim().split("\n")) {
    if (!line.trim()) {
      groups.push({ kind: "p", lines: [] });
      continue;
    }
    const kind = isTable(line) ? "table" : isItem(line) ? (/^\s*\d/.test(line) ? "ol" : "ul") : "p";
    const last = groups[groups.length - 1];
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(line);
    else groups.push({ kind, lines: [line] });
  }
  return (
    <>
      {groups
        .filter((g) => g.lines.length)
        .map((g, i) => {
          if (g.kind === "ul" || g.kind === "ol") {
            const items = g.lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
            return g.kind === "ol" ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          if (g.kind === "table") {
            return (
              <pre key={i} className="tiny" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {g.lines.join("\n")}
              </pre>
            );
          }
          return (
            <p key={i}>
              {g.lines.map((l, j) => (
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

export function LiveAssistant({ project, phaseKey, page, blueprintId }: { project: Project | undefined; phaseKey?: string; page: AssistantPage; blueprintId?: string }) {
  const { receiveProject, toast, assistantTask, assistantRequest, viewer } = useStudio();
  const task = assistantTask && project && assistantTask.projectId === project.id ? assistantTask : null;
  const request = assistantRequest?.projectId === project?.id ? assistantRequest : null;
  const suggestedPrompt =
    request?.prompt ?? (task ? `Help me with "${task.title}". Read the saved project context, identify missing evidence and propose the next useful work for my review.` : "");
  const focus = usePlanFocus(project?.id);
  const boardFocus = useBoardFocus(project?.id);
  const [autoApply, setAutoApply] = useViewSetting("assistant.autoApply", true, isBoolean);

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [configured, setConfigured] = useState(true);
  const [isAdmin, setIsAdmin] = useState(viewer.isAdmin);
  const [fileStorage, setFileStorage] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [pendingText, setPendingText] = useState<{ text: string; files: string[]; pointing: string } | null>(null);
  const [input, setInput] = useTextDraft(`fundur.chat.draft.${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}.${project?.id ?? "none"}`, suggestedPrompt);
  const [sendError, setSendError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // The selection goes with the message unless she took it off; a new selection puts it back.
  const [dropped, setDropped] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Editing one of her messages: it and the replies after it are replaced when she sends.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  // Voice: dictating into the box, or a hands-free conversation that reads replies aloud.
  const voice = useVoice({ onError: (m) => toast(m) });
  const [speakReplies, setSpeakReplies] = useViewSetting("assistant.voice.speak", true, isBoolean);
  const speakRepliesRef = useRef(speakReplies);
  speakRepliesRef.current = speakReplies;
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);
  const [heard, setHeard] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const dictating = voice.listening && !voiceMode;
  // Bumped when a dictation is dropped (she sent the message), so its late words are ignored.
  const dictation = useRef(0);
  // Outside a project she has a conversation of her own, with the tools that need no project.
  const base = project ? `/api/projects/${encodeURIComponent(project.id)}` : "/api/assistant";
  const selectionKey = focus ? focus.selection.map((s) => `${s.kind}:${s.id}`).join(",") : (boardFocus?.selection.join(",") ?? "");
  const pointing = selectionKey && dropped !== selectionKey ? (focus?.selectionLabel ?? boardFocus?.selectionLabel ?? "") : "";

  const fetchChat = useCallback(async () => {
    const res = await fetch(`${base}/chat?page=${page}${blueprintId ? `&blueprint=${encodeURIComponent(blueprintId)}` : ""}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Could not load the conversation");
    return body as { messages: Message[]; alerts: BudgetAlert[]; configured: boolean; isAdmin: boolean; fileStorage: boolean; suggestions: string[] };
  }, [base, page, blueprintId]);

  const show = useCallback((body: Awaited<ReturnType<typeof fetchChat>>, keepSuggestions = false) => {
    setMessages(body.messages);
    setAlerts(body.alerts);
    setConfigured(body.configured);
    setIsAdmin(body.isAdmin);
    setFileStorage(body.fileStorage);
    if (!keepSuggestions) setSuggestions(body.suggestions ?? []);
    setLoadError(null);
  }, []);

  const load = useCallback(
    (keepSuggestions = false) =>
      base ? fetchChat().then((b) => show(b, keepSuggestions), (err: Error) => setLoadError(err.message)) : Promise.resolve(),
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
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus();
  }, []);
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

  /** Hands a plan the assistant saved to the open editor, which draws it as an undoable step. */
  const drawPlan = (plan: Plan, revision: number, summary: string) => {
    if (!project) return;
    const host = assistantBridge.host(project.id);
    if (host && !host.adopt(plan, revision, summary)) toast("Fundur changed the plan while you had unsaved edits. Choose which to keep in the editor.");
  };

  /** Hands a board the assistant saved to the open board, which shows it as an undoable step. */
  const showBoard = (key: string, board: DesignBoard | null, revision: number) => {
    if (!project) return;
    const host = assistantBridge.boardHost(project.id);
    if (host && host.boardKey === key && !host.adopt(board, revision)) toast("Fundur changed the board while you had unsaved edits. Reload the board to see both.");
  };

  /**
   * Sends a message. `replaces` is her earlier message this one takes the
   * place of, with every reply after it: an edit, or asking for a reply again.
   * A spoken message leaves whatever she had typed in the box.
   */
  const send = async (text: string, opts: { replaces?: Message; spoken?: boolean } = {}) => {
    if (!base || busy) return;
    const replacing = opts.replaces;
    const ready = replacing ? [] : uploads.filter((u) => u.storageKey);
    const files = replacing
      ? replacing.attachments.map((a) => ({ storageKey: a.storageKey, name: a.name, contentType: a.contentType }))
      : ready.map((u) => ({ storageKey: u.storageKey, name: u.file.name, contentType: u.file.type || undefined }));
    if (!text.trim() && !files.length) return;
    if (dictating) {
      dictation.current++;
      voice.cancelListening();
    }
    if (!replacing) {
      if (!opts.spoken) setInput("");
      setUploads([]);
    }
    setSendError(null);
    setEditing(null);
    const before = messages;
    if (replacing) setMessages((list) => (list ? list.slice(0, Math.max(0, list.findIndex((m) => m.id === replacing.id))) : list));
    setPendingText({ text, files: files.map((f) => f.name), pointing });
    const state: Live = { text: "", tools: [], proposals: [], flags: [], made: [] };
    setLive({ ...state });
    const update = () => setLive({ ...state, tools: [...state.tools], proposals: [...state.proposals], flags: [...state.flags], made: [...state.made] });
    const controller = new AbortController();
    abortRef.current = controller;
    let accepted = false;
    try {
      // The assistant reads the plan as she sees it, so her latest edits are saved first.
      if (project) {
        await assistantBridge.host(project.id)?.flush();
        await assistantBridge.boardHost(project.id)?.flush();
      }
      const res = await fetch(`${base}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          text,
          attachments: files,
          ...(replacing ? { replaces: replacing.id } : {}),
          phaseKey: request?.phaseKey ?? phaseKey,
          taskId: task?.taskId,
          autoApply,
          context: {
            page,
            ...(phaseKey ? { phaseKey } : {}),
            ...(focus ? { levelId: focus.levelId } : {}),
            ...(focus?.view ? { view: focus.view } : {}),
            selection: pointing && focus ? focus.selection : [],
            ...(blueprintId ? { blueprintId } : {}),
            ...(boardFocus ? { boardKey: boardFocus.boardKey, ...(pointing && !focus ? { boardSelection: boardFocus.selection } : {}) } : {}),
          },
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "The assistant could not answer");
      }
      accepted = true;
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
          else if (e.type === "project") receiveProject(e.project);
          else if (e.type === "board") showBoard(e.key, e.board, e.revision);
          else if (e.type === "plan") drawPlan(e.plan, e.revision, e.changes.length === 1 ? e.changes[0] : `${e.changes.length} changes`);
          else if (e.type === "view") {
            const done = project && assistantBridge.host(project.id)?.view?.(e.command);
            if (!done) toast("Open the plan editor to see that view");
          } else if (e.type === "library") {
            void refreshLibrary();
            if (e.made && !state.made.some((m) => m.id === e.made.id)) state.made.push(e.made);
          }
          else if (e.type === "flag") state.flags.push(e.text);
          else if (e.type === "done") setSuggestions(e.suggestions ?? []);
          else if (e.type === "alert") {
            setAlerts((a) => [e.alert, ...a]);
            toast(e.alert.level === "limit" ? "This project's AI budget is used up" : "This project's AI spend passed its alert level");
          } else if (e.type === "error") state.error = e.error;
          update();
        }
        if (done) break;
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        state.error = (err as Error).message;
        update();
      }
      // Nothing reached the assistant, so her message and files go back where they were.
      if (!accepted && replacing) {
        setMessages(before);
        if (text !== replacing.content) setEditing({ id: replacing.id, text });
      } else if (!accepted && !opts.spoken) {
        setInput(text);
        setUploads(ready);
      }
    }
    abortRef.current = null;
    if (state.error) setSendError(state.error);
    // The reply's cost and anything it changed show on the project straight away.
    await Promise.all([
      load(true),
      project
        ? fetch(base, { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : null))
            .then((body) => body?.project && receiveProject(body.project))
            .catch(() => {})
        : Promise.resolve(),
    ]);
    setPendingText(null);
    setLive(null);
    // In a voice conversation the reply is read out, then it listens for her answer.
    if (voiceModeRef.current) {
      if (state.text.trim() && speakRepliesRef.current) voice.speak(state.text, () => listenTurnRef.current());
      else listenTurnRef.current();
    }
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const stop = () => abortRef.current?.abort();

  /** Listens for one thing she says in a voice conversation and sends it once she pauses. */
  const listenTurn = () => {
    if (!voiceModeRef.current) return;
    voice.listen({
      mode: "turn",
      onWords: (settled, hearing) => setHeard(`${settled} ${hearing}`.trim()),
      onDone: (said) => {
        setHeard("");
        if (voiceModeRef.current && said.trim()) void sendRef.current(said.trim(), { spoken: true });
      },
    });
  };
  const listenTurnRef = useRef(listenTurn);
  listenTurnRef.current = listenTurn;

  const startVoiceMode = () => {
    // Phones only let a page speak after a tap, so the first (silent) words are said now.
    if (voice.canSpeak) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    voice.stopSpeaking();
    setSpeakingId(null);
    voiceModeRef.current = true;
    setVoiceMode(true);
    if (!live) listenTurn();
  };
  const endVoiceMode = () => {
    voiceModeRef.current = false;
    setVoiceMode(false);
    setHeard("");
    voice.cancelListening();
    voice.stopSpeaking();
  };

  /** Speech into the box, added after what she already typed; she sends it when ready. */
  const dictate = () => {
    if (voice.listening) return voice.stopListening();
    const start = input.trim() ? `${input.replace(/\s+$/, "")} ` : "";
    const session = ++dictation.current;
    voice.listen({
      mode: "dictate",
      onWords: (settled, hearing) => session === dictation.current && setInput(`${start}${settled}${hearing ? `${settled ? " " : ""}${hearing}` : ""}`.slice(0, 20_000)),
      onDone: (said) => {
        if (session !== dictation.current) return;
        if (said) setInput(`${start}${said}`.slice(0, 20_000));
        if (!window.matchMedia("(pointer: coarse)").matches) inputRef.current?.focus();
      },
    });
  };

  const readAloud = (m: Message) => {
    if (speakingId === m.id) {
      voice.stopSpeaking();
      setSpeakingId(null);
      return;
    }
    setSpeakingId(m.id);
    voice.speak(m.content, () => setSpeakingId(null));
  };

  // The reply she can ask for again: the last one, if it answered a message of hers.
  const lastMessage = messages?.[messages.length - 1];
  const askedLast = lastMessage?.role === "assistant" && messages && messages.length > 1 ? messages[messages.length - 2] : undefined;
  const retryable = askedLast?.role === "user" && askedLast.mine && !lastMessage?.events.some((e) => e.type === "autopilot") ? askedLast : undefined;
  const lastMine = messages ? [...messages].reverse().find((m) => m.role === "user" && m.mine) : undefined;
  const voiceState = voice.listening ? "listening" : voice.transcribing ? "transcribing" : live ? "thinking" : voice.speaking ? "speaking" : "paused";
  // A request made to be sent (e.g. "Model it" on the library) goes as soon as the conversation is loaded.
  const sentRequest = useRef<string | null>(null);
  useEffect(() => {
    if (!request?.send || messages === null || !configured || sentRequest.current === request.id) return;
    sentRequest.current = request.id;
    void send(request.prompt);
    // send is a fresh closure each render; the guard above keeps this to once per request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, messages, configured]);
  const phaseHelp = project ? phaseAssistantSuggestions(project, request?.phaseKey ?? phaseKey ?? project.currentPhase) : [];

  const resolve = async (proposal: Proposal, action: "apply" | "dismiss" | "undo") => {
    if (!base) return;
    let res: Response;
    try {
      res = await fetch(`${base}/chat/proposals/${proposal.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
    } catch {
      toast("That change could not be saved. Check your connection and try again.");
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(body.error || "That did not work");
      return;
    }
    if (body.project) receiveProject(body.project);
    if (body.created) receiveProject(body.created);
    if (body.plan) drawPlan(body.plan.plan, body.plan.revision, `Undid: ${proposal.summary}`);
    if (body.board) showBoard(body.board.key, body.board.board, body.board.revision);
    const status: Proposal["status"] = action === "apply" ? "applied" : action === "undo" ? "undone" : "dismissed";
    const update = (p: Proposal): Proposal =>
      p.id === proposal.id
        ? {
            ...p,
            status,
            undoable: action === "apply" ? !!body.undoable : false,
            ...(body.created ? { created: { id: body.created.id, name: body.created.name } } : {}),
          }
        : p;
    setMessages((list) => list?.map((m) => ({ ...m, proposals: m.proposals.map(update), ...(m.kept ? { kept: m.kept.map(update) } : {}) })) ?? null);
    toast(action === "apply" ? "Done" : action === "undo" ? "Undone" : "Dismissed");
  };

  const dismissAlert = async (id: string) => {
    if (!base) return;
    setAlerts((a) => a.filter((x) => x.id !== id));
    await fetch(`${base}/ai/alerts/${id}`, { method: "DELETE" }).catch(() => {});
  };


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
                  ? `AI use on this project reached its budget${isAdmin ? ` of ${zar(a.budgetZar)}` : ""}.`
                  : `AI use on this project passed its alert level${isAdmin ? ` (${zar(a.spendZar)} of ${zar(a.budgetZar)})` : ""}.`}{" "}
                {project && <Link href={`/projects/${project.id}/ai`} style={{ textDecoration: "underline" }}>See usage</Link>}
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
          <div className="stack" style={{ gap: "1rem", margin: "auto 0", padding: "1rem 0.25rem" }}>
            <h2 className="display-s">
              {task ? <>What do you need for <em>{task.title}</em>?</> : project ? <>How can I help with <em>{project.name}</em>?</> : blueprintId ? "What shall we model?" : "How can I help?"}
            </h2>
            {!project ? (
              <p className="small muted">
                I can model furniture and objects in your design library from a description, change any blueprint, wall type or
                material, find free textures, and look across all your projects. Open a project and I can work on its plan, brief and
                tasks too.
              </p>
            ) : (
            <p className="small muted">
              I can do the work, not just talk about it: draw and change the floor plan as you watch, add and move tasks, steps and
              phases, shift the schedule, draft the brief and file what you drop in. Small changes happen straight away with an Undo;
              bigger ones wait for you. Select something on the plan and I&apos;ll know what &ldquo;this&rdquo; means.
            </p>
            )}
            {phaseHelp.length > 0 && (
              <div className="row wrap" style={{ gap: "0.5rem" }}>
                {phaseHelp.map((s) => (
                  <button key={s.label} type="button" className="chip" onClick={() => setInput(input.trim() ? `${input}\n\n${s.prompt}`.slice(0, 20_000) : s.prompt)} disabled={!configured}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages?.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="msg msg-me">
              {editing?.id === m.id ? (
                <form
                  className="bubble-edit"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(editing.text.trim(), { replaces: m });
                  }}
                >
                  <textarea
                    autoFocus
                    aria-label="Edit your message"
                    maxLength={20_000}
                    value={editing.text}
                    onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                    onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditing(null);
                        inputRef.current?.focus();
                      } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
                        e.preventDefault();
                        e.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <span className="tiny muted">The replies after this are replaced. Changes already made stay, with Undo.</span>
                  <span className="row" style={{ gap: "0.4rem", justifyContent: "flex-end" }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !configured || (!editing.text.trim() && !m.attachments.length)}>
                      Send
                    </button>
                  </span>
                </form>
              ) : (
                <>
                  <div className="bubble bubble-me">
                    {m.events.map((e, i) =>
                      e.type === "context" ? (
                        <span key={i} className="chat-pointing"><Crosshair size={11} /> {e.text}</span>
                      ) : null
                    )}
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
                  <MessageActions
                    text={m.content}
                    align="end"
                    onEdit={m.mine && !busy && configured ? () => setEditing({ id: m.id, text: m.content }) : undefined}
                  />
                </>
              )}
              {m.kept && m.kept.length > 0 && <ProposalCards proposals={m.kept} onResolve={resolve} note="Still in place from a reply you replaced" />}
            </div>
          ) : (
            <AssistantMessage
              key={m.id}
              message={m}
              isAdmin={isAdmin}
              openBlueprint={blueprintId}
              onResolve={resolve}
              speaking={speakingId === m.id && voice.speaking}
              onSpeak={voice.canSpeak && !voiceMode ? () => readAloud(m) : undefined}
              onRetry={m === lastMessage && retryable && !busy && configured ? () => void send(retryable.content, { replaces: retryable }) : undefined}
            />
          )
        )}

        {pendingText && (
          <div className="bubble bubble-me">
            {pendingText.pointing && <span className="chat-pointing"><Crosshair size={11} /> {pendingText.pointing}</span>}
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
            <MadeLinks made={live.made} openId={blueprintId} />
            {live.proposals.map((p) => (
              <div key={p.id} className="chat-card" data-done={p.direct || undefined}>
                <span className="row" style={{ gap: "0.4rem", alignItems: "flex-start" }}>
                  {p.direct && <Check size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--good)" }} />}
                  <span>{p.summary}</span>
                </span>
                {!p.direct && <span className="tiny muted">You can confirm this once the reply finishes.</span>}
              </div>
            ))}
            {live.error && <div className="chat-card" data-tone="bad">{live.error}</div>}
          </>
        )}
      </div>

      {!live && suggestions.length > 0 && configured && (
        <div className="chat-suggestions" aria-label="Suggested next steps">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {suggestedPrompt && input !== suggestedPrompt && (
        <div className="chat-card" style={{ margin: "0.5rem 1rem" }}>
          <span className="tiny muted">Your existing message draft is kept. You can use the request from this screen when ready.</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !!input.trim()} onClick={() => setInput(suggestedPrompt)}>
            Use suggested request
          </button>
        </div>
      )}
      {sendError && (
        <p className="chat-send-error small" role="alert">
          {sendError}
        </p>
      )}
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
      {pointing && (
        <div className="chat-files">
          <span className="chat-tool chat-pointing-chip" title="Sent with your message, so &ldquo;this&rdquo; means it">
            <Crosshair size={12} /> {pointing}
            <button type="button" aria-label="Don't send the selection" onClick={() => setDropped(selectionKey)} style={{ display: "inline-flex", marginLeft: 2 }}>
              <X size={12} />
            </button>
          </span>
        </div>
      )}
      {voiceMode && (
        <div className="voice-bar" data-state={voiceState} role="status" aria-live="polite">
          <span className="voice-orb" aria-hidden />
          <span className="grow stack" style={{ gap: 2, minWidth: 0 }}>
            <strong className="small">
              {voiceState === "listening"
                ? "Listening…"
                : voiceState === "transcribing"
                  ? "Turning your words into text…"
                  : voiceState === "thinking"
                    ? "Working on it…"
                    : voiceState === "speaking"
                      ? "Speaking"
                      : "Ready when you are"}
            </strong>
            <span className="tiny muted voice-heard">
              {heard ||
                (voice.support === "server"
                  ? "Your voice is sent to OpenAI to become text and is not kept. Fundur saves only the text."
                  : "Your browser turns your voice into text (Chrome uses Google, Safari uses Apple). Fundur saves only the text.")}
            </span>
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={speakReplies}
            aria-label={speakReplies ? "Stop reading replies aloud" : "Read replies aloud"}
            title={speakReplies ? "Replies are read aloud" : "Replies are not read aloud"}
            onClick={() => {
              if (speakReplies) voice.stopSpeaking();
              setSpeakReplies(!speakReplies);
            }}
          >
            {speakReplies ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          {voiceState === "listening" ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={voice.stopListening}>
              Done
            </button>
          ) : voiceState === "speaking" ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                voice.stopSpeaking();
                listenTurn();
              }}
            >
              <Mic size={14} /> Interrupt
            </button>
          ) : voiceState === "paused" ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={listenTurn}>
              <Mic size={14} /> Talk
            </button>
          ) : null}
          <button type="button" className="icon-btn" aria-label="End voice conversation" title="End voice conversation" onClick={endVoiceMode}>
            <X size={17} />
          </button>
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
          aria-label="Message the project assistant"
          maxLength={20_000}
          value={input}
          placeholder={pointing ? `Ask about ${pointing}…` : task ? `Ask about ${task.title}…` : `Ask or tell me to do something…`}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            if (fileStorage && e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia("(pointer: coarse)").matches) {
              e.preventDefault();
              void send(input);
            } else if (e.key === "ArrowUp" && !input && lastMine && !busy) {
              // Up in an empty box edits her last message, as in most chat apps.
              e.preventDefault();
              setEditing({ id: lastMine.id, text: lastMine.content });
            } else if (e.key === "Escape" && live) {
              e.preventDefault();
              stop();
            }
          }}
        />
        {(voice.support === "browser" || voice.support === "server") && !voiceMode && (
          <button
            type="button"
            className="icon-btn composer-attach composer-mic"
            data-on={dictating || undefined}
            aria-pressed={dictating}
            aria-label={dictating ? "Stop dictating" : "Dictate a message"}
            title={
              voice.support === "server"
                ? "Dictate. Your voice is sent to OpenAI to become text and is not kept."
                : "Dictate. Your browser turns your voice into text (Chrome uses Google, Safari uses Apple)."
            }
            disabled={!configured || voice.transcribing}
            onClick={dictate}
          >
            {voice.transcribing ? <Loader2 size={17} className="spin" /> : dictating ? <Square size={13} fill="currentColor" /> : <Mic size={17} />}
          </button>
        )}
        {live ? (
          <button type="button" className="btn btn-primary" style={{ width: 38, height: 38, padding: 0 }} aria-label="Stop" title="Stop" onClick={stop}>
            <Square size={14} fill="currentColor" />
          </button>
        ) : !voiceMode && !dictating && !input.trim() && !uploads.length && (voice.support === "browser" || voice.support === "server") ? (
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 38, height: 38, padding: 0 }}
            aria-label="Start a voice conversation"
            title="Talk with Fundur: it listens, answers and reads the reply aloud"
            disabled={!configured}
            onClick={startVoiceMode}
          >
            <AudioLines size={17} />
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: 38, height: 38, padding: 0 }}
            aria-label="Send"
            disabled={busy || !configured || (!input.trim() && !uploads.some((u) => u.storageKey))}
          >
            <ArrowUp size={17} />
          </button>
        )}
      </form>
      <label className="row tiny muted chat-auto">
        <button
          type="button"
          role="switch"
          aria-checked={autoApply}
          aria-label="Make small changes straight away"
          className="switch"
          onClick={() => setAutoApply(!autoApply)}
        />
        {autoApply ? "Small changes happen straight away, with Undo" : "Every change waits for you to confirm"}
      </label>
    </>
  );
}

function AssistantMessage({
  message,
  isAdmin,
  openBlueprint,
  onResolve,
  speaking,
  onSpeak,
  onRetry,
}: {
  message: Message;
  isAdmin: boolean;
  /** The blueprint open in the editor, which needs no link. */
  openBlueprint?: string;
  onResolve: (p: Proposal, action: "apply" | "dismiss" | "undo") => Promise<void>;
  speaking?: boolean;
  onSpeak?: () => void;
  /** Asks for this reply again, when it is the last one. */
  onRetry?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const tools = message.events.filter((e): e is Extract<ChatEvent, { type: "tool" }> => e.type === "tool");
  const used = message.tokens.input + message.tokens.output;
  const pilot = message.events.some((e) => e.type === "autopilot");
  return (
    <>
      {pilot && (
        <span className="chat-pointing" style={{ alignSelf: "flex-start" }}>
          <Bot size={11} /> Autopilot ran on its own
        </span>
      )}
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
      {(message.content.trim() || used > 0) && (
        <div className="bubble bubble-ai">
          {message.content.trim() && <Rich text={message.content} />}
          {used > 0 && (
            <div className="bubble-cost">
              {isAdmin ? (
                <button type="button" className="row" style={{ gap: "0.25rem" }} onClick={() => setDetails(!details)} aria-expanded={details}>
                  {zar(message.costZar)} · {tokens(used)}
                  {message.breakdown ? ` · ${message.breakdown.runs.length} call${message.breakdown.runs.length === 1 ? "" : "s"}, ${message.breakdown.tools.length} tool${message.breakdown.tools.length === 1 ? "" : "s"}` : ""}
                  <ChevronDown size={12} style={{ transform: details ? "rotate(180deg)" : undefined }} />
                </button>
              ) : (
                tokens(used)
              )}
            </div>
          )}
          {isAdmin && details && message.breakdown && <ReplyBreakdown breakdown={message.breakdown} />}
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
      <MadeLinks made={message.events.filter((e): e is Extract<ChatEvent, { type: "blueprint" }> => e.type === "blueprint")} openId={openBlueprint} />
      <ProposalCards proposals={message.proposals} onResolve={onResolve} />
      {(message.content.trim() || onRetry) && (
        <MessageActions text={message.content} align="start" speaking={speaking} onSpeak={message.content.trim() ? onSpeak : undefined} onRetry={onRetry} />
      )}
    </>
  );
}

/** Changes the assistant made or proposed, each with Confirm, Dismiss or Undo. */
function ProposalCards({
  proposals,
  onResolve,
  note,
}: {
  proposals: Proposal[];
  onResolve: (p: Proposal, action: "apply" | "dismiss" | "undo") => Promise<void>;
  /** A line under each card, e.g. where a kept change came from. */
  note?: string;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const act = async (p: Proposal, action: "apply" | "dismiss" | "undo") => {
    setWorking(p.id + action);
    await onResolve(p, action);
    setWorking(null);
  };
  if (!proposals.length) return null;
  return (
    <>
      {proposals.map((p) => (
        <div key={p.id} className="chat-card" data-done={(p.status === "applied" && p.direct) || undefined}>
          <span className="row" style={{ gap: "0.4rem", alignItems: "flex-start" }}>
            {p.status === "applied" && <Check size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--good)" }} />}
            <span style={p.status === "undone" || p.status === "dismissed" ? { textDecoration: "line-through", color: "var(--ink-3)" } : undefined}>
              {p.summary}
            </span>
          </span>
          {p.status === "pending" ? (
            <span className="row" style={{ gap: "0.4rem", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!working} onClick={() => act(p, "dismiss")}>
                Dismiss
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!!working} onClick={() => act(p, "apply")}>
                {working === p.id + "apply" ? "Saving…" : "Confirm"}
              </button>
            </span>
          ) : (
            <span className="tiny muted row" style={{ gap: "0.5rem", justifyContent: "space-between" }}>
              <span>
                {p.status === "applied" ? (p.direct ? "Done" : "Confirmed") : p.status === "undone" ? "Undone" : "Dismissed"}
                {p.created && (
                  <>
                    {" · "}
                    <Link href={`/projects/${p.created.id}`} style={{ textDecoration: "underline" }}>Open {p.created.name}</Link>
                  </>
                )}
                {note && p.status === "applied" ? ` · ${note}` : ""}
              </span>
              {p.status === "applied" && p.undoable && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!working} onClick={() => act(p, "undo")}>
                  <Undo2 size={13} /> {working === p.id + "undo" ? "Undoing…" : "Undo"}
                </button>
              )}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

/** Copy, and where they apply Edit, Read aloud and Try again, under a message. */
function MessageActions({
  text,
  align,
  onEdit,
  onSpeak,
  speaking,
  onRetry,
}: {
  text: string;
  align: "start" | "end";
  onEdit?: () => void;
  onSpeak?: () => void;
  speaking?: boolean;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <div className="msg-actions" data-align={align}>
      {text.trim() && (
        <button type="button" className="msg-action" aria-label={copied ? "Copied" : "Copy message"} title={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
      {onEdit && (
        <button type="button" className="msg-action" aria-label="Edit message" title="Edit" onClick={onEdit}>
          <Pencil size={14} />
        </button>
      )}
      {onSpeak && (
        <button type="button" className="msg-action" aria-pressed={!!speaking} aria-label={speaking ? "Stop reading aloud" : "Read aloud"} title={speaking ? "Stop" : "Read aloud"} onClick={onSpeak}>
          {speaking ? <Square size={12} fill="currentColor" /> : <Volume2 size={14} />}
        </button>
      )}
      {onRetry && (
        <button type="button" className="msg-action" aria-label="Try again" title="Try again" onClick={onRetry}>
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
}

/** Puts text on the clipboard, with the old way for browsers that block the new one. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** The Admin's view of one reply: each model call with its tokens and cost, and each tool it ran. */
function ReplyBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const ROLE: Record<string, string> = { orchestrator: "Assistant", worker: "Worker", reviewer: "Review" };
  return (
    <div className="reply-breakdown">
      {breakdown.runs.map((r, i) => (
        <div key={i} className="reply-breakdown-row" data-failed={!r.ok || undefined}>
          <span className="truncate">
            {ROLE[r.role] ?? r.role} · {r.model}
            {r.fallback ? " (fallback)" : ""}
            {!r.ok ? " (failed)" : ""}
          </span>
          <span className="tabular">
            {tokens(r.inputTokens, false)} in / {tokens(r.outputTokens, false)} out · {zar(r.costZar)} (US${r.costUsd.toFixed(4)})
          </span>
        </div>
      ))}
      {breakdown.tools.length > 0 && (
        <div className="reply-breakdown-row">
          <span>Tools</span>
          <span>
            {breakdown.tools
              .map((t) => `${t.name}${t.ok ? "" : " (failed)"} ${t.durationMs < 1000 ? `${t.durationMs} ms` : `${(t.durationMs / 1000).toFixed(1)} s`}`)
              .join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

/** Links to the blueprints a reply saved, so she can open what it modelled. */
function MadeLinks({ made, openId }: { made: { id: string; name: string }[]; openId?: string }) {
  const shown = made.filter((m) => m.id !== openId);
  if (!shown.length) return null;
  return (
    <div className="row wrap" style={{ gap: "0.4rem" }}>
      {shown.map((m) => (
        <Link key={m.id} className="chip" href={`/library/${encodeURIComponent(m.id)}`}>
          <Box size={13} /> Open {m.name}
        </Link>
      ))}
    </div>
  );
}
