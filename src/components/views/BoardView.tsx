"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, WhenReady } from "@/components/ui/primitives";
import { dayToDate } from "@/lib/studio/tasks";
import { relativeDue, shortDate } from "@/lib/studio/format";
import { isString, useViewSetting } from "@/lib/view-settings/client";
import { newId, usePlanner } from "@/lib/planner/client";
import { boardLanes, parseScope, planItems, scopeKey, type BoardLane, type PlanItem } from "@/lib/planner/items";
import { todoRef, type BoardColumn, type PlannerOp } from "@/lib/planner/state";
import { getWorkflow } from "@/lib/workflow";
import type { ProjectTask } from "@/lib/studio/tasks";

function phaseReached(task: ProjectTask): boolean {
  const phases = getWorkflow(task.project).phases;
  const at = phases.findIndex((p) => p.key === task.project.currentPhase);
  const phase = phases.findIndex((p) => p.key === task.phaseKey);
  return task.source === "own" || phase <= at || at < 0;
}

/** Done columns can fill up over a project's life; the board shows the latest. */
const DONE_SHOWN = 30;

/**
 * The task board: project tasks and their own to-dos as cards in columns they
 * name themselves. Moving a card into a column marked done ticks it, wherever
 * else it shows; moving it out opens it again.
 */
export function BoardView() {
  const { projects, ready, toast, setCheck, updateTask } = useStudio();
  const { planner, ready: plannerReady, change } = usePlanner();
  const [scopeSetting, setScope] = useViewSetting("board.scope", "all", isString);
  const [projectFilter, setProjectFilter] = useViewSetting("board.project", "", isString);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ columnId: string; index: number } | null>(null);
  const [adding, setAdding] = useState(false);

  const scope = parseScope(scopeSetting, planner);
  const active = projects.filter((p) => p.status === "active");
  const shownProjects = projectFilter && active.some((p) => p.id === projectFilter) ? active.filter((p) => p.id === projectFilter) : active;
  // Project steps join the board once their phase is reached, so a new project does not bury it.
  const items = planItems(shownProjects, planner, scope).filter((i) => i.kind === "todo" || i.ref in planner.cards || phaseReached(i.task));
  const lanes = boardLanes(planner, items);

  const run = (op: PlannerOp | PlannerOp[]) => change(op).catch((err: Error) => toast(err.message));

  /** Puts a card in a column at a place, ticking or opening it to match the column. */
  const move = (item: PlanItem, column: BoardColumn, index: number) => {
    const lane = lanes.find((l) => l.column.id === column.id)!;
    void run({ type: "placeCard", ref: item.ref, columnId: column.id, index, shown: lane.items.map((i) => i.ref) });
    if (item.kind === "task" && item.done !== column.done) {
      const task = item.task;
      if (task.source === "step") void setCheck(task.projectId, task.id, column.done);
      else updateTask(task.projectId, task.id, { done: column.done });
    }
  };

  const byRef = new Map(items.map((i) => [i.ref, i]));
  const drop = (column: BoardColumn) => {
    const item = dragging ? byRef.get(dragging) : undefined;
    if (item) move(item, column, over?.columnId === column.id ? over.index : Number.MAX_SAFE_INTEGER);
    setDragging(null);
    setOver(null);
  };

  return (
    <main className="page page-board">
      <WhenReady ready={ready && plannerReady}>
        <header className="row-between wrap rise" style={{ marginBottom: "1.5rem", alignItems: "flex-end", gap: "1rem" }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Across every project</p>
            <h1 className="display-l">Task board</h1>
            <p className="muted" style={{ marginTop: "0.75rem", maxWidth: 640 }}>
              Drag cards between columns. A card moved into a done column is ticked off everywhere. Name, add and reorder the columns to suit how you work.
            </p>
          </div>
          <Link href="/tasks" className="btn btn-ghost btn-sm">
            <ListChecks size={15} /> To-do list
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
          {scope !== "mine" && typeof scope !== "object" && active.length > 1 && (
            <select className="input" style={{ width: "auto" }} value={projectFilter} aria-label="Project" onChange={(e) => setProjectFilter(e.target.value)}>
              <option value="">Every project</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="kanban rise" style={{ ["--i" as string]: 2 }}>
          {lanes.map((lane, i) => (
            <Lane
              key={lane.column.id}
              lane={lane}
              first={i === 0}
              last={i === lanes.length - 1}
              position={i}
              listId={typeof scope === "object" ? scope.listId : null}
              dragging={dragging}
              overIndex={over?.columnId === lane.column.id ? over.index : null}
              onDragStart={setDragging}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onOver={(index) => setOver({ columnId: lane.column.id, index })}
              onDrop={() => drop(lane.column)}
              onMove={(item, column) => move(item, column, Number.MAX_SAFE_INTEGER)}
              columns={planner.columns}
              run={run}
            />
          ))}
          <div className="kanban-new">
            {adding ? (
              <NameForm
                placeholder="Column name, e.g. Waiting on client"
                onDone={(name) => {
                  setAdding(false);
                  if (name) void run({ type: "addColumn", id: newId(), name });
                }}
              />
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
                <Plus size={15} /> Add a column
              </button>
            )}
          </div>
        </div>
      </WhenReady>
    </main>
  );
}

function Lane({
  lane,
  first,
  last,
  position,
  listId,
  dragging,
  overIndex,
  onDragStart,
  onDragEnd,
  onOver,
  onDrop,
  onMove,
  columns,
  run,
}: {
  lane: BoardLane;
  first: boolean;
  last: boolean;
  position: number;
  listId: string | null;
  dragging: string | null;
  overIndex: number | null;
  onDragStart: (ref: string) => void;
  onDragEnd: () => void;
  onOver: (index: number) => void;
  onDrop: () => void;
  onMove: (item: PlanItem, column: BoardColumn) => void;
  columns: BoardColumn[];
  run: (op: PlannerOp | PlannerOp[]) => Promise<unknown>;
}) {
  const { column } = lane;
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const shown = column.done ? lane.items.slice(0, DONE_SHOWN) : lane.items;

  return (
    <section
      className="kanban-lane"
      data-done={column.done}
      data-over={overIndex !== null}
      aria-label={column.name}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        // Over the lane itself, not a card: the card goes last.
        if (e.target === e.currentTarget) onOver(lane.items.length);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <header className="kanban-head">
        {renaming ? (
          <NameForm
            initial={column.name}
            placeholder="Column name"
            onDone={(name) => {
              setRenaming(false);
              if (name && name !== column.name) void run({ type: "updateColumn", id: column.id, name });
            }}
          />
        ) : (
          <>
            <h2 className="kanban-title">
              {column.done && <CheckCircle2 size={14} aria-label="Counts as done" />}
              {column.name}
              <span className="count">{lane.items.length}</span>
            </h2>
            <span className="kanban-tools">
              <button type="button" className="icon-btn" aria-label={`Rename ${column.name}`} onClick={() => setRenaming(true)}>
                <Pencil size={13} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${column.name} left`} disabled={first} onClick={() => run({ type: "moveColumn", id: column.id, index: position - 1 })}>
                <ArrowLeft size={13} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${column.name} right`} disabled={last} onClick={() => run({ type: "moveColumn", id: column.id, index: position + 1 })}>
                <ArrowRight size={13} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Delete ${column.name}`}
                disabled={columns.length <= 1}
                onClick={() => {
                  if (window.confirm(`Delete the "${column.name}" column? Its cards move back to the first column.`)) void run({ type: "removeColumn", id: column.id });
                }}
              >
                <Trash2 size={13} />
              </button>
            </span>
          </>
        )}
      </header>
      <label className="kanban-done-toggle tiny muted">
        <input type="checkbox" checked={column.done} onChange={(e) => run({ type: "updateColumn", id: column.id, done: e.target.checked })} /> Cards here are done
      </label>

      <div className="kanban-cards">
        {shown.map((item, index) => (
          <Card
            key={item.ref}
            item={item}
            dragging={dragging === item.ref}
            dropBefore={overIndex === index && dragging !== item.ref}
            onDragStart={() => onDragStart(item.ref)}
            onDragEnd={onDragEnd}
            onOver={() => onOver(index)}
            columns={columns}
            column={column}
            onMove={(target) => onMove(item, target)}
          />
        ))}
        {overIndex !== null && overIndex >= shown.length && <span className="kanban-drop" aria-hidden />}
        {lane.items.length > shown.length && <p className="tiny muted">+{lane.items.length - shown.length} more done</p>}
      </div>

      {first &&
        (adding ? (
          <NameForm
            placeholder="What needs doing?"
            onDone={(title) => {
              setAdding(false);
              if (!title) return;
              const id = newId();
              void run([
                { type: "addTodo", id, title, listId },
                { type: "placeCard", ref: todoRef(id), columnId: column.id, index: lane.items.length, shown: lane.items.map((i) => i.ref) },
              ]);
            }}
          />
        ) : (
          <button type="button" className="kanban-add" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add a card
          </button>
        ))}
    </section>
  );
}

function Card({
  item,
  dragging,
  dropBefore,
  onDragStart,
  onDragEnd,
  onOver,
  columns,
  column,
  onMove,
}: {
  item: PlanItem;
  dragging: boolean;
  dropBefore: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOver: () => void;
  columns: BoardColumn[];
  column: BoardColumn;
  onMove: (column: BoardColumn) => void;
}) {
  const due = item.due ? (item.done ? { text: shortDate(dayToDate(item.due)), tone: "later" } : relativeDue(dayToDate(item.due))) : null;
  return (
    <>
      {dropBefore && <span className="kanban-drop" aria-hidden />}
      <article
        className="kanban-card"
        draggable
        data-dragging={dragging}
        data-done={item.done}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item.ref);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOver();
        }}
      >
        <p className="kanban-card-title">{item.title}</p>
        <div className="kanban-card-meta">
          {item.kind === "task" ? (
            <Link href={`/projects/${item.task.projectId}/phases/${item.task.phaseKey}`} className="row" style={{ gap: "0.3rem", minWidth: 0 }}>
              <Swatch swatch={item.task.project.swatch} />
              <span className="kanban-card-where">{item.task.project.name}</span>
            </Link>
          ) : (
            <span className="kanban-card-where">{item.list?.name ?? "My to-dos"}</span>
          )}
          {due && <span className={`tiny strong due-${due.tone}`}>{due.text.replace("Due ", "")}</span>}
        </div>
        {/* For touch screens and keyboards, where dragging is awkward. */}
        <select
          className="kanban-move"
          aria-label={`Move "${item.title}" to`}
          value={column.id}
          onChange={(e) => onMove(columns.find((c) => c.id === e.target.value)!)}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </article>
    </>
  );
}

function NameForm({ initial = "", placeholder, onDone }: { initial?: string; placeholder: string; onDone: (name: string) => void }) {
  const [name, setName] = useState(initial);
  // Enter and leaving the field both finish; only the first counts.
  const finished = React.useRef(false);
  const done = (value: string) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value);
  };
  return (
    <form
      className="kanban-form"
      onSubmit={(e) => {
        e.preventDefault();
        done(name.trim());
      }}
    >
      <input
        className="input"
        autoFocus
        value={name}
        maxLength={120}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && done("")}
        onBlur={() => done(name.trim())}
      />
    </form>
  );
}
