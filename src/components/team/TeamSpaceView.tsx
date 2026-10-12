"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Heading, Minus, Plus, StickyNote, Trash2, Type, Users, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { ProjectWorkPage } from "@/components/projects/ProjectWorkPage";
import { MissingProject } from "@/components/views/MissingProject";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";
import { relativeTime } from "@/lib/studio/format";
import { loadTeam, type TeamAccessRow } from "@/lib/team/client";
import { canUseTool } from "@/lib/team/access";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  NOTE_COLORS,
  type ChatMessage,
  type WhiteboardNote,
  type WhiteboardNoteInput,
} from "@/lib/team/space";
import type { Project } from "@/lib/studio/types";
import { useTeamBackend, usePolled } from "./useTeam";
import { TeamComments } from "./TeamComments";
import "./team.css";

export function TeamSpaceView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project && canUseTool(project.myAccess, "team") ? <TeamSpace project={project} /> : <MissingProject />}
    </WhenReady>
  );
}

const ZOOMS = ["0.5", "0.75", "1"] as const;
const isZoom = oneOf(ZOOMS);

function TeamSpace({ project }: { project: Project }) {
  const { persistence } = useStudio();
  const readOnly = project.myAccess?.level === "view";
  return (
    <ProjectWorkPage
      project={project}
      title="Team space"
      description={
        persistence === "server"
          ? "A shared whiteboard and chats for everyone on this project. Changes appear for the others within a few seconds."
          : "A whiteboard and chat for this project. In the demo they stay in this browser; teammates join once you sign in."
      }
    >
      <div className="team-space">
        <Whiteboard project={project} readOnly={readOnly} />
        <TeamChat project={project} />
      </div>
      <div style={{ marginTop: "2.5rem", maxWidth: 760 }}>
        <TeamComments projectId={project.id} anchors={[{ key: "project", label: "The whole project" }]} title="Project comments" />
      </div>
    </ProjectWorkPage>
  );
}

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

const SIZES: Record<WhiteboardNoteInput["kind"], { w: number; h: number }> = {
  note: { w: 200, h: 160 },
  text: { w: 260, h: 80 },
  heading: { w: 420, h: 70 },
};

function Whiteboard({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { backend } = useTeamBackend(project.id);
  const [zoomSetting, setZoom] = useViewSetting<(typeof ZOOMS)[number]>("teamSpace.zoom", "0.75", isZoom);
  const zoom = Number(zoomSetting);
  const { data, setData, error } = usePolled(() => backend.notes(), 5_000, [backend]);
  // Notes being moved or typed in keep their local copy until saved, so a refresh never snaps them back.
  const [local, setLocal] = useState<Record<string, WhiteboardNote>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [selected, setSelected] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const [color, setColor] = useState<(typeof NOTE_COLORS)[number]>(NOTE_COLORS[0]);
  const scroller = useRef<HTMLDivElement>(null);

  const notes = useMemo(() => {
    const byId = new Map((data ?? []).map((n) => [n.id, n]));
    for (const n of Object.values(local)) byId.set(n.id, n);
    return [...byId.values()];
  }, [data, local]);

  const save = useCallback(
    async (note: WhiteboardNote) => {
      try {
        const { updatedAt: _u, updatedBy: _b, ...input } = note;
        void _u;
        void _b;
        await backend.changeNote({ type: "put", note: input });
        setData((list) => [...(list ?? []).filter((n) => n.id !== note.id), note]);
        setLocal((prev) => {
          if (prev[note.id] !== note) return prev;
          const next = { ...prev };
          delete next[note.id];
          return next;
        });
        setProblem("");
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "The note was not saved. Please retry.");
      }
    },
    [backend, setData],
  );
  const change = useCallback(
    (note: WhiteboardNote, wait = 600) => {
      setLocal((prev) => ({ ...prev, [note.id]: note }));
      clearTimeout(timers.current.get(note.id));
      timers.current.set(note.id, setTimeout(() => void save(note), wait));
    },
    [save],
  );
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  const add = (kind: WhiteboardNoteInput["kind"]) => {
    const box = scroller.current;
    const size = SIZES[kind];
    // Start at the top left of what is in view, stepping down and across past anything already there.
    let x = Math.max(0, ((box?.scrollLeft ?? 0) + 40) / zoom);
    let y = Math.max(0, ((box?.scrollTop ?? 0) + 40) / zoom);
    const taken = (px: number, py: number) => notes.some((n) => Math.abs(n.x - px) < 60 && Math.abs(n.y - py) < 60);
    for (let i = 0; i < 40 && taken(x, y); i++) {
      x += 240;
      if (x + size.w > ((box?.scrollLeft ?? 0) + (box?.clientWidth ?? 800)) / zoom) {
        x = Math.max(0, ((box?.scrollLeft ?? 0) + 40) / zoom);
        y += 190;
      }
    }
    x = Math.min(BOARD_WIDTH - size.w, x);
    y = Math.min(BOARD_HEIGHT - size.h, y);
    const note: WhiteboardNote = {
      id: crypto.randomUUID(),
      kind,
      text: "",
      color,
      x: Math.round(x),
      y: Math.round(y),
      ...SIZES[kind],
      updatedAt: new Date().toISOString(),
      updatedBy: "",
    };
    setSelected(note.id);
    change(note, 0);
  };
  const remove = async (id: string) => {
    clearTimeout(timers.current.get(id));
    setLocal((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setData((list) => (list ?? []).filter((n) => n.id !== id));
    setSelected(null);
    try {
      await backend.changeNote({ type: "remove", id });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The note was not removed. Please retry.");
    }
  };
  const current = notes.find((n) => n.id === selected);

  return (
    <div className="whiteboard-frame">
      <div className="whiteboard-toolbar" role="toolbar" aria-label="Whiteboard">
        {!readOnly && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => add("note")}>
              <StickyNote size={14} /> Note
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => add("text")}>
              <Type size={14} /> Text
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => add("heading")}>
              <Heading size={14} /> Heading
            </button>
            <span className="row" style={{ gap: "0.3rem" }} aria-label="Colour">
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="wb-swatch"
                  style={{ background: c }}
                  aria-label={`Colour ${c}`}
                  aria-pressed={(current?.color ?? color) === c}
                  onClick={() => {
                    setColor(c);
                    if (current) change({ ...current, color: c }, 0);
                  }}
                />
              ))}
            </span>
            {current && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(current.id)}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </>
        )}
        <span className="grow" />
        <button type="button" className="icon-btn" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(zoom > 0.75 ? "0.75" : "0.5")}>
          <Minus size={15} />
        </button>
        <span className="tiny muted" style={{ minWidth: 38, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="icon-btn" aria-label="Zoom in" disabled={zoom >= 1} onClick={() => setZoom(zoom < 0.75 ? "0.75" : "1")}>
          <Plus size={15} />
        </button>
      </div>
      {(problem || error) && (
        <p className="tiny" role="status" style={{ padding: "0.4rem 0.75rem", color: "var(--bad)" }}>
          {problem || error}
        </p>
      )}
      <div className="whiteboard-scroll" ref={scroller} onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
        <div style={{ width: BOARD_WIDTH * zoom, height: BOARD_HEIGHT * zoom, position: "relative" }}>
          <div
            className="whiteboard-canvas"
            style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `scale(${zoom})` }}
            onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
          >
            {notes.map((n) => (
              <NoteCard
                key={n.id}
                note={n}
                zoom={zoom}
                selected={n.id === selected}
                readOnly={readOnly}
                onSelect={() => setSelected(n.id)}
                onChange={change}
                onRemove={() => void remove(n.id)}
              />
            ))}
            {data && !notes.length && (
              <p className="muted" style={{ position: "absolute", left: 48, top: 40, maxWidth: 420 }}>
                {readOnly
                  ? "Nothing on the whiteboard yet."
                  : "Add notes, text and headings for ideas, decisions and to-dos. Drag a note by its top edge; resize it from the corner."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteCard({
  note,
  zoom,
  selected,
  readOnly,
  onSelect,
  onChange,
  onRemove,
}: {
  note: WhiteboardNote;
  zoom: number;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onChange: (n: WhiteboardNote, wait?: number) => void;
  onRemove: () => void;
}) {
  const drag = useRef<{ x: number; y: number; start: WhiteboardNote; mode: "move" | "size" } | null>(null);
  const begin = (e: React.PointerEvent, mode: "move" | "size") => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: note, mode };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / zoom;
    const dy = (e.clientY - d.y) / zoom;
    const s = d.start;
    const next =
      d.mode === "move"
        ? {
            ...s,
            x: Math.round(Math.min(BOARD_WIDTH - s.w, Math.max(0, s.x + dx))),
            y: Math.round(Math.min(BOARD_HEIGHT - s.h, Math.max(0, s.y + dy))),
          }
        : {
            ...s,
            w: Math.round(Math.min(800, BOARD_WIDTH - s.x, Math.max(80, s.w + dx))),
            h: Math.round(Math.min(800, BOARD_HEIGHT - s.y, Math.max(40, s.h + dy))),
          };
    onChange(next, 10_000);
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    onChange(note, 0);
  };
  return (
    <div
      className="wb-note"
      data-kind={note.kind}
      data-selected={selected}
      style={{ left: note.x, top: note.y, width: note.w, height: note.h, background: note.color }}
      onPointerDown={onSelect}
    >
      <div className="wb-grip" onPointerDown={(e) => begin(e, "move")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} title={readOnly ? undefined : "Drag to move"}>
        {selected && !readOnly && (
          <button type="button" className="wb-mini" aria-label="Delete note" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>
            <X size={12} />
          </button>
        )}
      </div>
      <textarea
        aria-label={note.kind === "heading" ? "Heading" : "Note"}
        value={note.text}
        readOnly={readOnly}
        maxLength={4000}
        placeholder={readOnly ? "" : note.kind === "heading" ? "Heading" : "Write here"}
        onFocus={onSelect}
        onChange={(e) => onChange({ ...note, text: e.target.value })}
        onBlur={() => onChange(note, 0)}
      />
      {!readOnly && <span className="wb-resize" onPointerDown={(e) => begin(e, "size")} onPointerMove={move} onPointerUp={end} onPointerCancel={end} aria-hidden />}
      {note.updatedBy && selected && (
        <span className="tiny muted" style={{ position: "absolute", bottom: -20, left: 0, whiteSpace: "nowrap" }}>
          {note.updatedBy} · {relativeTime(note.updatedAt)}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

function TeamChat({ project }: { project: Project }) {
  const { backend, me, server } = useTeamBackend(project.id);
  const chats = usePolled(() => backend.chats(), 15_000, [backend]);
  const [chatId, setChatId] = useState<string | null>(null);
  const active = chats.data?.find((c) => c.id === chatId) ?? chats.data?.[0];
  const messages = usePolled(
    () => (active ? backend.messages(active.id) : Promise.resolve([] as ChatMessage[])),
    4_000,
    [backend, active?.id],
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [creating, setCreating] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const count = messages.data?.length ?? 0;
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [count, active?.id]);

  return (
    <aside className="team-chat" aria-label="Team chat">
      <div className="team-chat-tabs" role="tablist">
        {(chats.data ?? []).map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === active?.id}
            className={`btn btn-sm ${c.id === active?.id ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setChatId(c.id)}
          >
            {c.name}
          </button>
        ))}
        {server && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(!creating)} aria-expanded={creating}>
            <Users size={14} /> New group
          </button>
        )}
      </div>
      {creating && (
        <NewGroup
          projectId={project.id}
          meId={me.id}
          onCreate={async (name, memberIds) => {
            const chat = await backend.createChat({ name, memberIds });
            await chats.refresh();
            setChatId(chat.id);
            setCreating(false);
          }}
        />
      )}
      <div className="team-chat-log" ref={log} aria-live="polite">
        {(messages.data ?? []).map((m) => (
          <div key={m.id} className="team-msg" data-mine={m.authorId === me.id}>
            <span className="team-msg-meta">
              {m.authorId === me.id ? "You" : m.authorName} · {relativeTime(m.createdAt)}
            </span>
            {m.body}
          </div>
        ))}
        {messages.data && !count && <p className="small muted">No messages yet. Say hello to the team.</p>}
      </div>
      {(problem || messages.error || chats.error) && (
        <p className="tiny" role="status" style={{ padding: "0 0.75rem", color: "var(--bad)" }}>
          {problem || messages.error || chats.error}
        </p>
      )}
      <form
        className="team-chat-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!active || !text.trim()) return;
          setBusy(true);
          setProblem("");
          try {
            const sent = await backend.post(active.id, text);
            messages.setData((list) => [...(list ?? []), sent]);
            setText("");
          } catch (err) {
            setProblem(err instanceof Error ? err.message : "Not sent. Please retry.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          className="input"
          value={text}
          maxLength={5000}
          placeholder={active ? `Message ${active.name}` : "Loading chats…"}
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !active || !text.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}

function NewGroup({
  projectId,
  meId,
  onCreate,
}: {
  projectId: string;
  meId: string;
  onCreate: (name: string, memberIds: string[]) => Promise<void>;
}) {
  const [team, setTeam] = useState<TeamAccessRow[] | null>(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    loadTeam(projectId)
      .then(setTeam)
      .catch((e) => setProblem(e instanceof Error ? e.message : "Could not load the team."));
  }, [projectId]);
  const others = (team ?? []).filter((m) => m.id !== meId && m.active);
  return (
    <form
      className="stack"
      style={{ gap: "0.5rem", padding: "0.75rem", borderBottom: "1px solid var(--line)" }}
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await onCreate(name, picked);
        } catch (err) {
          setProblem(err instanceof Error ? err.message : "The chat was not created.");
        }
      }}
    >
      <input className="input" value={name} maxLength={100} placeholder="Group name, e.g. Lighting" onChange={(e) => setName(e.target.value)} aria-label="Group name" />
      {team && !others.length && <p className="tiny muted">Nobody else is on this project yet. Invite teammates from workspace settings.</p>}
      {others.map((m) => (
        <label key={m.id} className="check-line">
          <input
            type="checkbox"
            checked={picked.includes(m.id)}
            onChange={(e) => setPicked(e.target.checked ? [...picked, m.id] : picked.filter((id) => id !== m.id))}
          />
          {m.name}
        </label>
      ))}
      {problem && <p className="tiny" style={{ color: "var(--bad)" }}>{problem}</p>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim() || !picked.length}>
        Create group
      </button>
    </form>
  );
}
