"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Check, Plus, Trash2, FileText, CalendarDays, Pencil, ListPlus, KanbanSquare } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, WhenReady } from "@/components/ui/primitives";
import { DUE_GROUP_LABEL, dayToDate, groupByDue, toDay, type ProjectTask } from "@/lib/studio/tasks";
import { relativeDue, shortDate } from "@/lib/studio/format";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";
import { isBoolean, isString, useViewSetting } from "@/lib/view-settings/client";
import { newId, usePlanner } from "@/lib/planner/client";
import { parseScope, planItems, scopeKey, type ItemScope, type PlanItem } from "@/lib/planner/items";
import type { PlannerOp, Todo } from "@/lib/planner/state";

/**
 * The to-do list (P2-07): every project step and project task, beside to-dos
 * of their own that belong to no project, which can be sorted into lists of
 * their own. Ticking a project step here ticks it on its phase.
 */
export function TasksView() {
  const { projects, ready, toast } = useStudio();
  const { planner, ready: plannerReady, change } = usePlanner();
  const [scopeSetting, setScope] = useViewSetting("todo.scope", "all", isString);
  const [showDone, setShowDone] = useViewSetting("tasks.showDone", false, isBoolean);
  const scope = parseScope(scopeSetting, planner);
  const active = projects.filter((p) => p.status === "active");
  const items = planItems(active, planner, scope);
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const groups = groupByDue(open);
  const list = typeof scope === "object" ? planner.lists.find((l) => l.id === scope.listId) : undefined;

  const run = (op: PlannerOp | PlannerOp[], said?: string) =>
    change(op).then(
      () => said && toast(said),
      (err: Error) => toast(err.message)
    );

  // Naming a new list, or renaming the one shown.
  const [naming, setNaming] = useState<"new" | "rename" | null>(null);
  const saveName = (name: string) => {
    const mode = naming;
    setNaming(null);
    if (!name) return;
    if (mode === "rename" && list && name !== list.name) void run({ type: "renameList", id: list.id, name });
    if (mode === "new") {
      const id = newId();
      void run({ type: "addList", id, name }, `"${name}" added`);
      setScope(scopeKey({ listId: id }));
    }
  };

  return (
    <main className="page">
      <WhenReady ready={ready && plannerReady}>
        <header className="row-between wrap rise" style={{ marginBottom: "1.5rem", alignItems: "flex-end", gap: "1rem" }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Across every project</p>
            <h1 className="display-l">To-do list</h1>
            <p className="muted" style={{ marginTop: "0.75rem" }}>
              Every phase step, every project task and every to-do of your own, soonest first. Ticking a step here ticks it on its phase.
            </p>
          </div>
          <Link href="/board" className="btn btn-ghost btn-sm">
            <KanbanSquare size={15} /> Board
          </Link>
        </header>

        <div className="row wrap rise" style={{ ["--i" as string]: 1, gap: "0.5rem", marginBottom: "1.25rem" }}>
          <div className="segmented" role="group" aria-label="Show" style={{ flexWrap: "wrap" }}>
            {(
              [
                ["all", "Everything"],
                ["projects", "Projects"],
                ["mine", "My to-dos"],
                ...planner.lists.map((l) => [scopeKey({ listId: l.id }), l.name]),
              ] as [string, string][]
            ).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={scopeKey(scope) === key} onClick={() => setScope(key)}>
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming("new")}>
            <ListPlus size={15} /> New list
          </button>
        </div>

        {naming && <NameForm key={naming} initial={naming === "rename" ? list?.name ?? "" : ""} onDone={saveName} />}

        {list && (
          <div className="row wrap" style={{ gap: "0.5rem", marginBottom: "1.25rem" }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setNaming("rename")}
            >
              <Pencil size={14} /> Rename
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const count = planner.todos.filter((t) => t.listId === list.id).length;
                if (count && !window.confirm(`Delete "${list.name}" and its ${count} ${count === 1 ? "to-do" : "to-dos"}?`)) return;
                setScope("all");
                void run({ type: "removeList", id: list.id }, `"${list.name}" deleted`);
              }}
            >
              <Trash2 size={14} /> Delete list
            </button>
          </div>
        )}

        <AddItem projects={active} scope={scope} />

        {open.length === 0 && (
          <p className="muted rise" style={{ ["--i" as string]: 2, marginTop: "1.5rem" }}>Nothing is open here. Everything is ticked off.</p>
        )}

        {groups.map(({ group, tasks }, i) => (
          <section key={group} className="rise" style={{ ["--i" as string]: i + 2, marginTop: "2rem" }}>
            <div className="section-title">
              <h2>
                {DUE_GROUP_LABEL[group]}
                <span className="count">{tasks.length}</span>
              </h2>
            </div>
            <div className="card checklist">
              {tasks.map((item) => (
                <ItemRow key={item.ref} item={item} />
              ))}
            </div>
          </section>
        ))}

        {done.length > 0 && (
          <section className="rise" style={{ marginTop: "2.5rem" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide" : "Show"} {done.length} done
            </button>
            {showDone && (
              <div className="card checklist" style={{ marginTop: "1rem" }}>
                {done.map((item) => (
                  <ItemRow key={item.ref} item={item} />
                ))}
              </div>
            )}
          </section>
        )}
      </WhenReady>
    </main>
  );
}

function NameForm({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="row"
      style={{ gap: "0.5rem", marginBottom: "1.25rem", maxWidth: 420 }}
      onSubmit={(e) => {
        e.preventDefault();
        onDone(name.trim());
      }}
    >
      <input
        className="input grow"
        autoFocus
        placeholder="Name the list, e.g. Studio admin"
        value={name}
        maxLength={120}
        aria-label="List name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone("")}
      />
      <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>Save</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDone("")}>Cancel</button>
    </form>
  );
}

export function ItemRow({ item }: { item: PlanItem }) {
  return item.kind === "task" ? <TaskRow task={item.task} /> : <TodoRow todo={item.todo} listName={item.list?.name} />;
}

function DueText({ due, done }: { due?: string; done: boolean }) {
  if (!due) return null;
  if (done) return <span className="tiny muted">{shortDate(dayToDate(due))}</span>;
  const rel = relativeDue(dayToDate(due));
  return <span className={`tiny strong due-${rel.tone}`}>{rel.text.replace("Due ", "")}</span>;
}

function TaskRow({ task }: { task: ProjectTask }) {
  const { setCheck, updateTask, deleteTask } = useStudio();
  const project = task.project;
  const document = task.outputDocumentId ? project.documents.find((d) => d.id === task.outputDocumentId) : undefined;
  const phaseName = getWorkflow(project).phases.find((p) => p.key === task.phaseKey)?.name ?? task.phaseKey;

  const toggle = () => {
    if (task.source === "step") void setCheck(project.id, task.id, !task.done);
    else updateTask(project.id, task.id, { done: !task.done });
  };

  return (
    <div className="check-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", cursor: "default" }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" done`}
        className="check-box"
        onClick={toggle}
      >
        <Check size={15} strokeWidth={3} />
      </button>
      <span className="stack" style={{ minWidth: 0, gap: "0.2rem" }}>
        <span className="check-text">{task.title}</span>
        <span className="check-meta row wrap" style={{ gap: "0.4rem" }}>
          <Link href={`/projects/${project.id}/phases/${task.phaseKey}`} className="row" style={{ gap: "0.35rem" }}>
            <Swatch swatch={project.swatch} />
            <span className="strong" style={{ color: "var(--ink-2)" }}>{project.name}</span>
            <span className="muted">· {phaseName}</span>
          </Link>
          {task.source === "own" && <span className="muted">· yours</span>}
          {document && (
            <Link href={`/projects/${project.id}/documents`} className="row muted" style={{ gap: "0.25rem" }}>
              <FileText size={12} /> {document.name}
            </Link>
          )}
        </span>
      </span>
      <span className="row" style={{ gap: "0.5rem" }}>
        <DueText due={task.due} done={task.done} />
        {task.source === "own" && (
          <button type="button" className="icon-btn" aria-label={`Delete "${task.title}"`} onClick={() => deleteTask(project.id, task.id)}>
            <Trash2 size={15} />
          </button>
        )}
      </span>
    </div>
  );
}

export function TodoRow({ todo, listName }: { todo: Todo; listName?: string }) {
  const { toast } = useStudio();
  const { change } = usePlanner();
  const [editing, setEditing] = useState<"title" | "due" | null>(null);
  const [draft, setDraft] = useState(todo.title);
  const update = (patch: Omit<Extract<PlannerOp, { type: "updateTodo" }>, "type" | "id">) =>
    change({ type: "updateTodo", id: todo.id, ...patch }).catch((err: Error) => toast(err.message));

  return (
    <div className="check-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", cursor: "default" }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `Mark "${todo.title}" as not done` : `Mark "${todo.title}" done`}
        className="check-box"
        onClick={() => update({ done: !todo.done })}
      >
        <Check size={15} strokeWidth={3} />
      </button>
      <span className="stack" style={{ minWidth: 0, gap: "0.2rem" }}>
        {editing === "title" ? (
          <input
            className="input"
            autoFocus
            value={draft}
            maxLength={500}
            aria-label="To-do"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              setEditing(null);
              if (draft.trim() && draft.trim() !== todo.title) void update({ title: draft.trim() });
              else setDraft(todo.title);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(todo.title);
                setEditing(null);
              }
            }}
          />
        ) : (
          <button type="button" className="check-text" style={{ textAlign: "left" }} onClick={() => setEditing("title")} title="Click to edit">
            {todo.title}
          </button>
        )}
        <span className="check-meta row wrap" style={{ gap: "0.4rem" }}>
          <span className="muted">{listName ?? "My to-dos"}</span>
        </span>
      </span>
      <span className="row" style={{ gap: "0.35rem" }}>
        {editing === "due" ? (
          <input
            className="input"
            type="date"
            autoFocus
            aria-label="Due"
            defaultValue={todo.due ?? ""}
            onBlur={(e) => {
              setEditing(null);
              const value = e.target.value || null;
              if (value !== (todo.due ?? null)) void update({ due: value });
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        ) : (
          <button type="button" className="row" style={{ gap: "0.3rem" }} aria-label="Change the date" onClick={() => setEditing("due")}>
            {todo.due ? <DueText due={todo.due} done={todo.done} /> : <CalendarDays size={15} className="muted" />}
          </button>
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={`Delete "${todo.title}"`}
          onClick={() => change({ type: "removeTodo", id: todo.id }).catch((err: Error) => toast(err.message))}
        >
          <Trash2 size={15} />
        </button>
      </span>
    </div>
  );
}

/** One line to add a to-do: where it goes follows what is being looked at. */
function AddItem({ projects, scope }: { projects: Project[]; scope: ItemScope }) {
  const { addTask, toast } = useStudio();
  const { planner, change } = usePlanner();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const fallback = typeof scope === "object" ? `list:${scope.listId}` : scope === "projects" && projects[0] ? `project:${projects[0].id}` : "mine";
  const [picked, setPicked] = useState<string | null>(null);
  const valid = (v: string) =>
    v === "mine" || planner.lists.some((l) => `list:${l.id}` === v) || projects.some((p) => `project:${p.id}` === v);
  const where = picked && valid(picked) ? picked : fallback;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) return;
    if (where.startsWith("project:")) {
      const project = projects.find((p) => `project:${p.id}` === where)!;
      // It belongs to the phase the project is on, which is where its work sits.
      addTask(project.id, { phaseKey: project.currentPhase, title: text, due: due || undefined });
    } else {
      const listId = where.startsWith("list:") ? where.slice(5) : null;
      change({ type: "addTodo", id: newId(), title: text, listId, due: due || null }).catch((err: Error) => toast(err.message));
    }
    setTitle("");
  };

  return (
    <form className="card rise todo-add" style={{ ["--i" as string]: 1 }} onSubmit={submit}>
      <Plus size={18} className="muted" aria-hidden />
      <input
        className="input todo-add-title"
        placeholder="Add a to-do and press Enter"
        value={title}
        maxLength={500}
        aria-label="New to-do"
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="input todo-add-due"
        type="date"
        value={due}
        min={toDay(new Date())}
        aria-label="Due"
        onChange={(e) => setDue(e.target.value)}
      />
      <select className="input todo-add-where" value={where} aria-label="Add to" onChange={(e) => setPicked(e.target.value)}>
        <option value="mine">My to-dos</option>
        {planner.lists.map((l) => (
          <option key={l.id} value={`list:${l.id}`}>{l.name}</option>
        ))}
        {projects.length > 0 && (
          <optgroup label="Projects">
            {projects.map((p) => (
              <option key={p.id} value={`project:${p.id}`}>{p.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <button type="submit" className="btn btn-primary btn-sm" disabled={!title.trim()}>
        Add
      </button>
    </form>
  );
}
