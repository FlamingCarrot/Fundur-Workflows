"use client";

import React, { useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Check,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Plus,
  RotateCcw,
  RotateCw,
  Ruler,
  Trash2,
} from "lucide-react";
import {
  isEmptyPlan,
  m2,
  mm,
  removeItem,
  roomArea,
  setWallLength,
  setWallThickness,
  updateColumn,
  updateOpening,
  updateRoom,
  usableArea,
  wallLength,
  distance,
  type DoorStyle,
  type EditResult,
  type Plan,
  type PlanDiff,
  type PlanItem,
} from "@/lib/plan/geometry";
import {
  addLevel,
  copyLevel,
  duplicate,
  removeLevel,
  removeUnderlay,
  rotateItem,
  sortedLevels,
  updateDimension,
  updateItem,
  updateLevel,
  updateNote,
  updateUnderlay,
  updateWall,
  wallHeight,
} from "@/lib/plan/elements";
import { CATEGORIES, LIBRARY, libraryItem } from "@/lib/plan/library";
import {
  alignMany,
  describeSelection,
  distributeMany,
  duplicateMany,
  mirrorMany,
  removeMany,
  rotateMany,
  type AlignEdge,
} from "@/lib/plan/selection";
import { relativeTime } from "@/lib/studio/format";
import { ShapeList } from "./PlanCanvas";

/**
 * The side panel: the furniture library while placing, the fields of what is
 * selected, or else the floor, its rooms and areas, the tracing image and the
 * corrections log.
 */

type Edit = (result: EditResult) => string | null;

export function Inspector({
  plan,
  levelId,
  onLevel,
  selection,
  onSelect,
  onEdit,
  placing,
  placeType,
  onPlaceType,
  corrections,
  compareRows,
  onStartOver,
  onAddUnderlay,
  onCalibrate,
  underlayBusy,
  extra,
}: {
  plan: Plan;
  levelId: string;
  onLevel: (levelId: string) => void;
  /** What is selected; the fields of one thing, or what can be done to several. */
  selection: PlanItem[];
  onSelect: (items: PlanItem[]) => void;
  onEdit: Edit;
  /** The furniture tool is on: show the library. */
  placing: boolean;
  placeType: string;
  onPlaceType: (type: string) => void;
  corrections: { id: string; summary: string; at: string; by: string }[];
  compareRows?: PlanDiff["rooms"];
  onStartOver: () => void;
  onAddUnderlay: () => void;
  onCalibrate: () => void;
  underlayBusy: boolean;
  /** Shown above the floor's overview when nothing is selected, e.g. an open option's rule checks. */
  extra?: React.ReactNode;
}) {
  const [showAllLog, setShowAllLog] = useState(false);
  const remove = (item: PlanItem) => {
    if (!onEdit(removeItem(plan, item))) onSelect([]);
  };
  const close = () => onSelect([]);

  if (placing && !selection.length) return <FurniturePicker placeType={placeType} onPick={onPlaceType} />;
  if (selection.length > 1) return <ManyPanel plan={plan} selection={selection} onEdit={onEdit} onSelect={onSelect} />;
  const one = selection[0] as PlanItem | undefined;

  if (one?.kind === "wall" && plan.walls.some((w) => w.id === one.id)) {
    return <WallPanel key={one.id} plan={plan} wallId={one.id} onEdit={onEdit} onRemove={() => remove(one)} onClose={close} />;
  }

  const opening = one?.kind === "opening" ? plan.openings.find((o) => o.id === one.id) : undefined;
  if (opening) {
    const host = plan.walls.find((w) => w.id === opening.wallId);
    const isDoor = opening.kind === "door";
    const style = opening.style ?? "single";
    const swings = isDoor && (style === "single" || style === "double");
    const set = (patch: Parameters<typeof updateOpening>[2]) => onEdit(updateOpening(plan, opening.id, patch));
    return (
      <Panel title={isDoor ? "Door" : "Window"} onClose={close} onRemove={() => remove({ kind: "opening", id: opening.id })}>
        <div className="segmented" role="group" aria-label="Kind">
          {(["door", "window"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={opening.kind === k} onClick={() => set({ kind: k })}>
              {k === "door" ? "Door" : "Window"}
            </button>
          ))}
        </div>
        {isDoor && (
          <div className="stack" style={{ gap: "0.4rem" }}>
            <span className="field-label">Type</span>
            <div className="segmented plan-wrap" role="group" aria-label="Door type">
              {(
                [
                  ["single", "Single"],
                  ["double", "Double"],
                  ["sliding", "Sliding"],
                  ["opening", "No door"],
                ] as [DoorStyle, string][]
              ).map(([k, text]) => (
                <button key={k} type="button" aria-pressed={style === k} onClick={() => set({ style: k })}>
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
        {swings && (
          <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
            {style === "single" && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ hinge: (opening.hinge ?? "start") === "start" ? "end" : "start" })}>
                <FlipHorizontal2 size={14} /> Hinge other side
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ side: (opening.side ?? 1) === 1 ? -1 : 1 })}>
              <RotateCw size={14} /> Open the other way
            </button>
          </div>
        )}
        <MeasureField key={`w-${opening.id}-${opening.width}`} label="Width" value={opening.width} onCommit={(v) => set({ width: v })} />
        <MeasureField
          key={`a-${opening.id}-${opening.at}`}
          label="From the wall's start to its middle"
          value={opening.at}
          onCommit={(v) => set({ at: v })}
        />
        <MeasureField
          key={`h-${opening.id}-${opening.height}`}
          label={isDoor ? "Height" : "Glass height"}
          value={opening.height ?? (isDoor ? 2_100 : 1_200)}
          onCommit={(v) => set({ height: v })}
        />
        {!isDoor && <MeasureField key={`s-${opening.id}-${opening.sill}`} label="Sill above the floor" value={opening.sill ?? 900} onCommit={(v) => set({ sill: v })} />}
        {host && <p className="tiny muted">On a wall {mm(wallLength(host))} long. Drag it to slide it along the wall.</p>}
      </Panel>
    );
  }

  const column = one?.kind === "column" ? plan.columns.find((c) => c.id === one.id) : undefined;
  if (column) {
    return (
      <Panel title="Column" onClose={close} onRemove={() => remove({ kind: "column", id: column.id })}>
        <label className="row-between small" style={{ gap: "1rem" }}>
          Round
          <button
            type="button"
            role="switch"
            aria-checked={!!column.round}
            className="switch"
            aria-label="Round"
            onClick={() => onEdit(updateColumn(plan, column.id, { round: !column.round }))}
          />
        </label>
        <MeasureField
          key={`w-${column.id}-${column.width}`}
          label={column.round ? "Diameter" : "Width"}
          value={column.width}
          onCommit={(v) => onEdit(updateColumn(plan, column.id, column.round ? { width: v, depth: v } : { width: v }))}
        />
        {!column.round && (
          <MeasureField key={`d-${column.id}-${column.depth}`} label="Depth" value={column.depth} onCommit={(v) => onEdit(updateColumn(plan, column.id, { depth: v }))} />
        )}
        <ItemActions plan={plan} target={{ kind: "column", id: column.id }} onEdit={onEdit} onSelect={onSelect} turn={!column.round} />
      </Panel>
    );
  }

  const room = one?.kind === "room" ? plan.rooms.find((r) => r.id === one.id) : undefined;
  if (room) {
    return (
      <Panel title="Room" onClose={close} onRemove={() => remove({ kind: "room", id: room.id })}>
        <TextField key={`n-${room.id}-${room.name}`} label="Name" value={room.name} onCommit={(v) => onEdit(updateRoom(plan, room.id, { name: v }))} />
        <div className="stack" style={{ gap: "0.15rem" }}>
          <span className="eyebrow">Area</span>
          <span className="display-s tabular">{m2(roomArea(room))}</span>
        </div>
        <label className="row-between small" style={{ gap: "1rem" }}>
          Counts towards the usable area
          <button
            type="button"
            role="switch"
            aria-checked={room.usable}
            className="switch"
            aria-label="Counts towards the usable area"
            onClick={() => onEdit(updateRoom(plan, room.id, { usable: !room.usable }))}
          />
        </label>
        <p className="tiny muted">To change its size, select a wall of the room and type its true length, or drag the wall.</p>
      </Panel>
    );
  }

  const item = one?.kind === "item" ? plan.items.find((i) => i.id === one.id) : undefined;
  if (item) {
    const set = (patch: Parameters<typeof updateItem>[2]) => onEdit(updateItem(plan, item.id, patch));
    return (
      <Panel title={libraryItem(item.type).name} removeLabel="Remove it" onClose={close} onRemove={() => remove({ kind: "item", id: item.id })}>
        <TextField key={`l-${item.id}-${item.label}`} label="Label (optional)" value={item.label ?? ""} onCommit={(v) => set({ label: v })} />
        <div className="plan-pair">
          <MeasureField key={`w-${item.id}-${item.width}`} label="Width" value={item.width} onCommit={(v) => set({ width: v })} />
          <MeasureField key={`d-${item.id}-${item.depth}`} label="Depth" value={item.depth} onCommit={(v) => set({ depth: v })} />
        </div>
        <MeasureField key={`r-${item.id}-${item.rotation}`} label="Turned" unit="°" value={item.rotation} onCommit={(v) => set({ rotation: v })} />
        <ItemActions plan={plan} target={{ kind: "item", id: item.id }} onEdit={onEdit} onSelect={onSelect} turn />
        <p className="tiny muted">Drag it to move it, Alt+drag to copy it. Arrow keys nudge it, Space turns it, Enter goes to its first field.</p>
      </Panel>
    );
  }

  const note = one?.kind === "note" ? plan.notes.find((n) => n.id === one.id) : undefined;
  if (note) {
    return (
      <Panel title="Note" onClose={close} onRemove={() => remove({ kind: "note", id: note.id })}>
        <TextField key={`t-${note.id}-${note.text}`} label="Words" value={note.text} onCommit={(v) => onEdit(updateNote(plan, note.id, v))} />
        <ItemActions plan={plan} target={{ kind: "note", id: note.id }} onEdit={onEdit} onSelect={onSelect} />
      </Panel>
    );
  }

  const dim = one?.kind === "dimension" ? plan.dimensions.find((d) => d.id === one.id) : undefined;
  if (dim) {
    return (
      <Panel title="Dimension" onClose={close} onRemove={() => remove({ kind: "dimension", id: dim.id })}>
        <div className="stack" style={{ gap: "0.15rem" }}>
          <span className="eyebrow">Measures</span>
          <span className="display-s tabular">{mm(distance(dim.a, dim.b))}</span>
        </div>
        <MeasureField key={`o-${dim.id}-${dim.offset}`} label="Set off from the points" value={dim.offset} onCommit={(v) => onEdit(updateDimension(plan, dim.id, v))} />
      </Panel>
    );
  }

  // Nothing selected: the floor and its rooms.
  const floor = plan.rooms.filter((r) => r.levelId === levelId);
  const level = plan.levels.find((l) => l.id === levelId) ?? plan.levels[0];
  const floorUsable = floor.filter((r) => r.usable).reduce((sum, r) => sum + roomArea(r), 0);
  const underlay = plan.underlays.find((u) => u.levelId === levelId);
  const log = showAllLog ? corrections : corrections.slice(0, 6);
  const warnings = plan.source?.warnings ?? [];
  const many = plan.levels.length > 1;
  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      {extra}
      <div className="stack" style={{ gap: "0.2rem" }}>
        <span className="eyebrow">Usable area{many ? `, ${level.name}` : ""}</span>
        <span className="display-m tabular">{m2(floorUsable)}</span>
        <span className="tiny muted">
          {floor.length
            ? `${floor.filter((r) => r.usable).length} of ${floor.length} rooms count towards it`
            : "Click inside closed walls with the Room tool to see their areas."}
          {many ? ` · ${m2(usableArea(plan))} on all floors` : ""}
        </span>
      </div>

      {floor.length > 0 && (
        <div className="stack" style={{ gap: "0.35rem" }}>
          <span className="eyebrow">Rooms</span>
          <ul className="plan-list">
            {[...floor]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r) => {
                const then = compareRows?.find((c) => c.name === r.name)?.before;
                return (
                  <li key={r.id}>
                    <button type="button" className="row-between small" onClick={() => onSelect([{ kind: "room", id: r.id }])}>
                      <span className="truncate" style={{ color: r.usable ? undefined : "var(--ink-3)" }}>{r.name}</span>
                      <span className="tabular muted">
                        {then != null && Math.abs(then - roomArea(r)) >= 0.005 ? <s style={{ marginRight: "0.4rem" }}>{m2(then)}</s> : null}
                        {m2(roomArea(r))}
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      <FloorSection plan={plan} levelId={levelId} onLevel={onLevel} onEdit={onEdit} />

      <div className="stack" style={{ gap: "0.5rem" }}>
        <span className="eyebrow">Image to trace over</span>
        {underlay ? (
          <>
            <span className="small truncate">{underlay.name}</span>
            <label className="stack small" style={{ gap: "0.25rem" }}>
              <span className="row-between">
                Strength <span className="tabular muted">{Math.round(underlay.opacity * 100)}%</span>
              </span>
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={Math.round(underlay.opacity * 100)}
                aria-label="Image strength"
                onChange={(e) => onEdit(updateUnderlay(plan, levelId, { opacity: Number(e.target.value) / 100 }))}
              />
            </label>
            <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onCalibrate}>
                <Ruler size={14} /> Set its scale
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(removeUnderlay(plan, levelId))}>
                <Trash2 size={14} /> Remove
              </button>
            </div>
            <span className="tiny muted">Set its scale by clicking both ends of a length you know, then typing it.</span>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={onAddUnderlay} disabled={underlayBusy}>
              <ImagePlus size={14} /> {underlayBusy ? "Adding the image…" : "Add a photo or scan"}
            </button>
            <span className="tiny muted">A photo of a hand sketch or a scanned plan, laid under this floor to draw over.</span>
          </>
        )}
      </div>

      {warnings.length > 0 && (
        <details className="plan-notes">
          <summary className="small strong">
            {warnings.length} note{warnings.length === 1 ? "" : "s"} from importing {plan.source?.name}
          </summary>
          <ul className="stack tiny" style={{ gap: "0.4rem", marginTop: "0.6rem", paddingLeft: "1rem", listStyle: "disc" }}>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}

      <div className="stack" style={{ gap: "0.35rem" }}>
        <span className="eyebrow">Corrections</span>
        {corrections.length === 0 ? (
          <p className="tiny muted">Every change you make is listed here, with who made it and when.</p>
        ) : (
          <ul className="plan-log">
            {log.map((c) => (
              <li key={c.id}>
                <span className="small">{c.summary}</span>
                <span className="tiny muted">{c.by} · {relativeTime(c.at)}</span>
              </li>
            ))}
          </ul>
        )}
        {corrections.length > 6 && (
          <button type="button" className="tiny strong" style={{ alignSelf: "flex-start", color: "var(--accent)" }} onClick={() => setShowAllLog((s) => !s)}>
            {showAllLog ? "Show fewer" : `Show all ${corrections.length}`}
          </button>
        )}
      </div>

      {!isEmptyPlan(plan) && (
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--ink-3)" }} onClick={onStartOver}>
          <RotateCcw size={14} /> Start over
        </button>
      )}
    </div>
  );
}

function FloorSection({ plan, levelId, onLevel, onEdit }: { plan: Plan; levelId: string; onLevel: (id: string) => void; onEdit: Edit }) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const level = plan.levels.find((l) => l.id === levelId) ?? plan.levels[0];
  const add = (result: EditResult) => {
    if (!onEdit(result) && result.ok && result.id) onLevel(result.id);
  };
  const removeThis = () => {
    const result = removeLevel(plan, level.id);
    if (!onEdit(result) && result.ok) {
      setConfirmRemove(false);
      onLevel(sortedLevels(result.plan)[0].id);
    }
  };
  return (
    <details className="plan-floor-details" open={plan.levels.length > 1 || undefined}>
      <summary className="eyebrow">Floor: {level.name}</summary>
      <div className="stack" style={{ gap: "0.75rem", marginTop: "0.75rem" }}>
        <TextField key={`n-${level.id}-${level.name}`} label="Name" value={level.name} onCommit={(v) => onEdit(updateLevel(plan, level.id, { name: v }))} />
        <div className="plan-pair">
          <MeasureField key={`e-${level.id}-${level.elevation}`} label="Floor level" value={level.elevation} onCommit={(v) => onEdit(updateLevel(plan, level.id, { elevation: v }))} />
          <MeasureField key={`h-${level.id}-${level.height}`} label="Ceiling height" value={level.height} onCommit={(v) => onEdit(updateLevel(plan, level.id, { height: v }))} />
        </div>
        <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => add(addLevel(plan))}>
            <Plus size={14} /> New floor
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => add(copyLevel(plan, level.id))} title="A new floor above with this floor's walls, doors, windows and columns">
            <Copy size={14} /> Copy this floor up
          </button>
          {plan.levels.length > 1 &&
            (confirmRemove ? (
              <button type="button" className="btn btn-sm" style={{ color: "var(--bad)" }} onClick={removeThis}>
                Remove {level.name} and all on it
              </button>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(true)}>
                <Trash2 size={14} /> Remove floor
              </button>
            ))}
        </div>
      </div>
    </details>
  );
}

/** Turn and copy, for furniture, columns and notes. */
function ItemActions({
  plan,
  target,
  onEdit,
  onSelect,
  turn,
}: {
  plan: Plan;
  target: PlanItem;
  onEdit: Edit;
  onSelect: (items: PlanItem[]) => void;
  turn?: boolean;
}) {
  return (
    <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
      {turn && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(rotateItem(plan, target, 90))}>
          <RotateCcw size={14} /> Turn 90°
        </button>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          const result = duplicate(plan, target);
          if (!onEdit(result) && result.ok) onSelect([{ kind: target.kind, id: result.id! }]);
        }}
      >
        <Copy size={14} /> Copy
      </button>
    </div>
  );
}

/** The library while the furniture tool is on: pick what to place. */
function FurniturePicker({ placeType, onPick }: { placeType: string; onPick: (type: string) => void }) {
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="stack" style={{ gap: "0.2rem" }}>
        <h2 className="display-s">Furniture and fittings</h2>
        <span className="tiny muted">Pick one, then click the plan to place it. Space turns it before you click.</span>
      </div>
      {CATEGORIES.map((cat) => (
        <div key={cat} className="stack" style={{ gap: "0.4rem" }}>
          <span className="eyebrow">{cat}</span>
          <div className="plan-library">
            {LIBRARY.filter((i) => i.category === cat).map((i) => {
              const span = Math.max(i.width, i.depth) * 1.15;
              return (
                <button key={i.type} type="button" aria-pressed={placeType === i.type} onClick={() => onPick(i.type)} title={`${i.name}, ${mm(i.width)} by ${mm(i.depth)}`}>
                  <svg viewBox={`${-span / 2} ${-span / 2} ${span} ${span}`} aria-hidden className="plan-items">
                    <ShapeList shapes={i.draw(i.width, i.depth)} />
                  </svg>
                  <span className="tiny">{i.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Panel({
  title,
  removeLabel,
  onClose,
  onRemove,
  children,
}: {
  title: string;
  removeLabel?: string;
  onClose: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="row-between">
        <h2 className="display-s">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Done">
          <Check size={17} />
        </button>
      </div>
      {children}
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--bad)" }} onClick={onRemove}>
        {removeLabel ?? `Remove ${title.toLowerCase()}`}
      </button>
    </div>
  );
}

function WallPanel({
  plan,
  wallId,
  onEdit,
  onRemove,
  onClose,
}: {
  plan: Plan;
  wallId: string;
  onEdit: Edit;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [keep, setKeep] = useState<"a" | "b">("a");
  const wall = plan.walls.find((w) => w.id === wallId)!;
  const length = wallLength(wall);
  const moving = keep === "a" ? wall.b : wall.a;
  const joinedAtEnd = plan.walls.filter(
    (w) => w.id !== wallId && w.levelId === wall.levelId && [w.a, w.b].some((p) => Math.abs(p.x - moving.x) <= 1 && Math.abs(p.y - moving.y) <= 1)
  ).length;
  const title = wall.kind === "partition" ? "Partition" : "Wall";
  return (
    <Panel title={title} onClose={onClose} onRemove={onRemove}>
      <div className="segmented" role="group" aria-label="Kind">
        <button type="button" aria-pressed={wall.kind === "wall"} onClick={() => onEdit(updateWall(plan, wall.id, { kind: "wall" }))}>Wall</button>
        <button type="button" aria-pressed={wall.kind === "partition"} onClick={() => onEdit(updateWall(plan, wall.id, { kind: "partition" }))}>Partition</button>
      </div>
      <MeasureField
        key={`l-${wall.id}-${Math.round(length)}-${keep}`}
        label="True length"
        value={Math.round(length)}
        onCommit={(v) => onEdit(setWallLength(plan, wall.id, v, keep))}
      />
      <div className="stack" style={{ gap: "0.4rem" }}>
        <span className="field-label">Which end stays put</span>
        <div className="segmented" role="group" aria-label="Which end stays put">
          <button type="button" aria-pressed={keep === "a"} onClick={() => setKeep("a")}>The start</button>
          <button type="button" aria-pressed={keep === "b"} onClick={() => setKeep("b")}>The far end</button>
        </div>
        <span className="tiny muted">
          The other end moves along the wall, and everything beyond it moves too
          {joinedAtEnd ? `, including the ${joinedAtEnd} wall${joinedAtEnd === 1 ? "" : "s"} joined there` : ""}, so walls stay square
          and room areas update.
        </span>
      </div>
      <div className="plan-pair">
        <MeasureField key={`t-${wall.id}-${wall.thickness}`} label="Thickness" value={wall.thickness} onCommit={(v) => onEdit(setWallThickness(plan, wall.id, v))} />
        <MeasureField key={`h-${wall.id}-${wall.height}`} label="Height" value={wallHeight(plan, wall)} onCommit={(v) => onEdit(updateWall(plan, wall.id, { height: v }))} />
      </div>
      {wall.height != null && (
        <button type="button" className="tiny strong" style={{ alignSelf: "flex-start", color: "var(--accent)" }} onClick={() => onEdit(updateWall(plan, wall.id, { height: null }))}>
          Use the floor&apos;s ceiling height
        </button>
      )}
      <p className="tiny muted">Drag the wall to move it sideways, or drag an end to move that corner.</p>
    </Panel>
  );
}

/** A number field that applies on Enter or when it loses focus, and says why a value was refused. */
export function MeasureField({
  label: text,
  value,
  onCommit,
  autoFocus,
  unit = "mm",
}: {
  label: string;
  value: number;
  onCommit: (value: number) => string | null;
  autoFocus?: boolean;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  const [error, setError] = useState<string | null>(null);
  const skip = useRef(false);
  const commit = () => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    const n = Number.parseFloat(draft.replace(/[\s,]/g, ""));
    if (Number.isNaN(n)) {
      setError(unit === "mm" ? "Type a number of millimetres." : "Type a number.");
      return;
    }
    if (Math.round(n) === Math.round(value)) {
      setError(null);
      return;
    }
    setError(onCommit(n));
  };
  return (
    <label className="field">
      <span className="field-label">{text}</span>
      <span className="plan-measure">
        <input
          className="input tabular"
          inputMode="decimal"
          value={draft}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              // Put the value back and go back to the plan without applying anything.
              skip.current = true;
              setDraft(String(Math.round(value)));
              setError(null);
              backToPlan();
            }
          }}
        />
        <span className="small muted">{unit}</span>
      </span>
      {error && <span className="tiny" role="alert" style={{ color: "var(--bad)" }}>{error}</span>}
    </label>
  );
}

export function TextField({
  label: text,
  value,
  onCommit,
  autoFocus,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => string | null;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const skip = useRef(false);
  const commit = () => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (draft.trim() === value) return;
    setError(onCommit(draft));
  };
  return (
    <label className="field">
      <span className="field-label">{text}</span>
      <input
        className="input"
        value={draft}
        autoFocus={autoFocus}
        onFocus={(e) => autoFocus && e.target.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            skip.current = true;
            setDraft(value);
            setError(null);
            backToPlan();
          }
        }}
      />
      {error && <span className="tiny" role="alert" style={{ color: "var(--bad)" }}>{error}</span>}
    </label>
  );
}

/** Leaves a field for the plan, so the next keys act on the drawing again. */
function backToPlan() {
  document.querySelector<HTMLElement>(".plan-canvas")?.focus({ preventScroll: true });
}


const ALIGN: { edge: AlignEdge; label: string; icon: React.ReactNode }[] = [
  { edge: "left", label: "Line up left edges", icon: <AlignStartVertical size={15} /> },
  { edge: "centre", label: "Line up centres", icon: <AlignCenterVertical size={15} /> },
  { edge: "right", label: "Line up right edges", icon: <AlignEndVertical size={15} /> },
  { edge: "top", label: "Line up top edges", icon: <AlignStartHorizontal size={15} /> },
  { edge: "middle", label: "Line up middles", icon: <AlignCenterHorizontal size={15} /> },
  { edge: "bottom", label: "Line up bottom edges", icon: <AlignEndHorizontal size={15} /> },
];

/** Several things selected: what can be done to all of them at once. */
function ManyPanel({ plan, selection, onEdit, onSelect }: { plan: Plan; selection: PlanItem[]; onEdit: Edit; onSelect: (items: PlanItem[]) => void }) {
  const loose = selection.filter((t) => t.kind === "item" || t.kind === "column" || t.kind === "note").length;
  const run = (result: EditResult, select?: boolean) => {
    if (!onEdit(result) && result.ok && select) onSelect(result.created ?? []);
  };
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="row-between">
        <h2 className="display-s">{selection.length} selected</h2>
        <button type="button" className="icon-btn" onClick={() => onSelect([])} aria-label="Done">
          <Check size={17} />
        </button>
      </div>
      <p className="small muted">{describeSelection(plan, selection)}</p>
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(rotateMany(plan, selection, 90))} title="Space">
          <RotateCcw size={14} /> Turn 90°
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(mirrorMany(plan, selection, "left-right"))} title="Shift+H">
          <FlipHorizontal2 size={14} /> Mirror
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(mirrorMany(plan, selection, "up-down"))} title="Shift+V">
          <FlipVertical2 size={14} /> Flip
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run(duplicateMany(plan, selection), true)} title="Ctrl+D">
          <Copy size={14} /> Copy
        </button>
      </div>
      {loose >= 2 && (
        <div className="stack" style={{ gap: "0.4rem" }}>
          <span className="field-label">Line up furniture, columns and notes</span>
          <div className="row" style={{ gap: "0.15rem", flexWrap: "wrap" }}>
            {ALIGN.map((a) => (
              <button key={a.edge} type="button" className="icon-btn" aria-label={a.label} title={a.label} onClick={() => run(alignMany(plan, selection, a.edge))}>
                {a.icon}
              </button>
            ))}
            {loose >= 3 && (
              <>
                <button type="button" className="icon-btn" aria-label="Space evenly across" title="Space evenly across" onClick={() => run(distributeMany(plan, selection, "across"))}>
                  <AlignHorizontalSpaceAround size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label="Space evenly up and down" title="Space evenly up and down" onClick={() => run(distributeMany(plan, selection, "up"))}>
                  <AlignVerticalSpaceAround size={15} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <p className="tiny muted">
        Drag any of them to move them all, or Alt+drag to copy them. Arrow keys nudge, Delete removes. Ctrl+click takes one out.
      </p>
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--bad)" }} onClick={() => !onEdit(removeMany(plan, selection)) && onSelect([])}>
        Remove all {selection.length}
      </button>
    </div>
  );
}
