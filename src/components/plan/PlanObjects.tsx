"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Eye, EyeOff, Layers, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { assemblyLibrary } from "@/lib/plan/assembly-client";
import {
  editFurniture,
  makeAssembly,
  placeAssembly,
  type Assembly,
} from "@/lib/plan/groups";
import {
  itemName,
  planBounds,
  onLevel,
  type EditResult,
  type Plan,
  type PlanItem,
} from "@/lib/plan/geometry";
import type { Layers as LayerState } from "./PlanCanvas";

export function PlanObjects({
  plan,
  levelId,
  selected,
  selectionIds,
  onSelect,
  onMultiSelect,
  onEdit,
  layers,
  onLayer,
}: {
  projectId: string;
  plan: Plan;
  levelId: string;
  selected: PlanItem | null;
  selectionIds: string[];
  onSelect: (
    target: PlanItem | null,
    floorId?: string,
    additive?: boolean,
  ) => void;
  onMultiSelect: (ids: string[]) => void;
  onEdit: (result: EditResult) => string | null;
  layers: LayerState;
  onLayer: (key: keyof LayerState) => void;
}) {
  const { viewer, persistence, toast } = useStudio();
  const libraryAllowed =
    !viewer.workspaceRole ||
    viewer.workspaceRole === "owner" ||
    viewer.workspaceRole === "member";
  const backend = useMemo(
    () =>
      assemblyLibrary(
        persistence === "server",
        `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}`,
      ),
    [persistence, viewer.userId, viewer.workspaceId],
  );
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [moveX, setMoveX] = useState("0");
  const [moveY, setMoveY] = useState("0");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!libraryAllowed) return;
    let cancelled = false;
    backend
      .list()
      .then((rows) => {
        if (!cancelled) {
          setAssemblies(rows);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [backend, libraryAllowed, reload]);
  const floor = onLevel(plan, levelId);
  const furniture = floor.items.filter((i) => selectionIds.includes(i.id));
  const apply = (result: EditResult) => {
    const message = onEdit(result);
    if (message) toast(message);
    return !message;
  };
  const action = (kind: Parameters<typeof editFurniture>[2]) => {
    const result = editFurniture(plan, selectionIds, kind, { name });
    if (apply(result) && result.ok) {
      if (kind === "duplicate" && result.id) {
        const group = result.plan.items.find(
          (i) => i.id === result.id,
        )?.groupId;
        onMultiSelect(
          group
            ? result.plan.items
                .filter((i) => i.groupId === group)
                .map((i) => i.id)
            : result.plan.items
                .filter((i) => !plan.items.some((p) => p.id === i.id))
                .map((i) => i.id),
        );
      }
      if (kind === "delete") onMultiSelect([]);
    }
  };
  const rows: {
    key: keyof LayerState;
    title: string;
    objects: { target: PlanItem; name: string; hidden?: boolean }[];
  }[] = [
    {
      key: "furniture",
      title: "Furniture",
      objects: floor.items.map((i) => ({
        target: { kind: "item", id: i.id },
        name: `${i.groupName ? `${i.groupName} · ` : ""}${itemName(i)}`,
        hidden: i.hidden,
      })),
    },
    {
      key: "walls",
      title: "Walls",
      objects: floor.walls.map((w, i) => ({
        target: { kind: "wall", id: w.id },
        name: `${w.kind === "partition" ? "Partition" : "Wall"} ${i + 1}`,
      })),
    },
    {
      key: "openings",
      title: "Doors and windows",
      objects: floor.openings.map((o, i) => ({
        target: { kind: "opening", id: o.id },
        name: `${o.kind === "door" ? "Door" : "Window"} ${i + 1}`,
      })),
    },
    {
      key: "columns",
      title: "Columns",
      objects: floor.columns.map((c, i) => ({
        target: { kind: "column", id: c.id },
        name: `Column ${i + 1}`,
      })),
    },
    {
      key: "rooms",
      title: "Rooms",
      objects: floor.rooms.map((r) => ({
        target: { kind: "room", id: r.id },
        name: r.name,
      })),
    },
    {
      key: "notes",
      title: "Notes",
      objects: floor.notes.map((n) => ({
        target: { kind: "note", id: n.id },
        name: n.text,
      })),
    },
    {
      key: "dimensions",
      title: "Dimensions",
      objects: floor.dimensions.map((d, i) => ({
        target: { kind: "dimension", id: d.id },
        name: `Dimension ${i + 1}`,
      })),
    },
  ];
  const styleSelection = (patch: { color?: string; hidden?: boolean }) =>
    apply({
      ok: true,
      plan: {
        ...plan,
        items: plan.items.map((i) =>
          selectionIds.includes(i.id) ? { ...i, ...patch } : i,
        ),
      },
      summary: `${selectionIds.length} furniture items ${patch.hidden !== undefined ? "hidden in the working view" : "colour coded"}`,
    });
  return (
    <div className="plan-object-controls stack">
      <details className="plan-object-tree">
        <summary className="small strong">
          <ChevronDown className="plan-disclosure" size={14} />
          <Layers size={15} /> Objects on this floor
        </summary>
        <label className="stack tiny" style={{ gap: 4 }}>
          Find an object
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or type"
          />
        </label>
        <div className="plan-tree-list">
          {rows
            .filter((r) => r.objects.length)
            .map((row) => (
              <details key={row.key} open={row.key === "furniture" || !!search}>
                <summary className="row-between small">
                  <span>
                    {row.title} ({row.objects.length})
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Toggle ${row.title.toLowerCase()} layer`}
                    aria-pressed={layers[row.key]}
                    onClick={(e) => {
                      e.preventDefault();
                      onLayer(row.key);
                    }}
                  >
                    {layers[row.key] ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                </summary>
                {row.objects
                  .filter((o) =>
                    o.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .slice(0, 200)
                  .map((object) => (
                    <div
                      className="plan-tree-row"
                      key={`${object.target.kind}.${object.target.id}`}
                    >
                      {object.target.kind === "item" && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${object.name}`}
                          checked={selectionIds.includes(object.target.id)}
                          onChange={() =>
                            onMultiSelect(
                              selectionIds.includes(object.target.id)
                                ? selectionIds.filter(
                                    (id) => id !== object.target.id,
                                  )
                                : [...selectionIds, object.target.id],
                            )
                          }
                        />
                      )}
                      <button
                        type="button"
                        className="tiny truncate grow"
                        aria-pressed={
                          object.target.kind === "item"
                            ? selectionIds.includes(object.target.id)
                            : selected?.kind === object.target.kind &&
                              selected.id === object.target.id
                        }
                        onClick={(e) => {
                          if (!layers[row.key]) onLayer(row.key);
                          onSelect(
                            object.target,
                            levelId,
                            e.ctrlKey || e.metaKey || e.shiftKey,
                          );
                        }}
                      >
                        {object.name}
                      </button>
                      {object.target.kind === "item" && (
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`${object.hidden ? "Show" : "Hide"} ${object.name}`}
                          onClick={() =>
                            apply({
                              ok: true,
                              plan: {
                                ...plan,
                                items: plan.items.map((i) =>
                                  i.id === object.target.id
                                    ? { ...i, hidden: !i.hidden }
                                    : i,
                                ),
                              },
                              summary: `${object.name} ${object.hidden ? "shown" : "hidden"} in working view`,
                            })
                          }
                        >
                          {object.hidden ? (
                            <EyeOff size={14} />
                          ) : (
                            <Eye size={14} />
                          )}
                        </button>
                      )}
                    </div>
                  ))}
                {row.objects.length > 200 && (
                  <p className="tiny muted">
                    Search to narrow this list (first 200 matches shown).
                  </p>
                )}
              </details>
            ))}
        </div>
      </details>
      {!!furniture.length && (
        <div
          className="stack plan-selection-controls"
          style={{ gap: "0.5rem" }}
        >
          <span className="eyebrow">
            {furniture.length} furniture item{furniture.length === 1 ? "" : "s"}{" "}
            selected
          </span>
          <label className="stack tiny">
            Group / library name
            <input
              className="input"
              aria-label="Arrangement name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={furniture[0]?.groupName ?? "Meeting arrangement"}
            />
          </label>
          <div className="row plan-wrap">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => action("group")}
              disabled={furniture.length < 2}
            >
              Group
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => action("ungroup")}
              disabled={!furniture.some((i) => i.groupId)}
            >
              Ungroup
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => action("rotate")}
            >
              Turn together
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => action("duplicate")}
            >
              Copy selection
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => action("delete")}
            >
              Delete selection
            </button>
          </div>
          <form
            className="stack"
            style={{ gap: "0.5rem" }}
            onSubmit={(e) => {
              e.preventDefault();
              if (
                apply(
                  editFurniture(plan, selectionIds, "move", {
                    delta: { x: Number(moveX), y: Number(moveY) },
                  }),
                )
              ) {
                setMoveX("0");
                setMoveY("0");
              }
            }}
          >
            <div className="plan-pair">
              <label className="stack tiny">
                Move X (mm)
                <input
                  className="input"
                  type="number"
                  step="any"
                  aria-label="Move selection X"
                  value={moveX}
                  onChange={(e) => setMoveX(e.target.value)}
                />
              </label>
              <label className="stack tiny">
                Move Y (mm)
                <input
                  className="input"
                  type="number"
                  step="any"
                  aria-label="Move selection Y"
                  value={moveY}
                  onChange={(e) => setMoveY(e.target.value)}
                />
              </label>
            </div>
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              disabled={Number(moveX) === 0 && Number(moveY) === 0}
            >
              Move selection
            </button>
          </form>
          <label className="row tiny" style={{ gap: 8 }}>
            Colour code
            <input
              type="color"
              aria-label="Furniture colour"
              value={furniture[0]?.color ?? "#a1ad9c"}
              onChange={(e) => styleSelection({ color: e.target.value })}
            />
          </label>
          {libraryAllowed && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy || !name.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const assembly = await backend.create(
                    makeAssembly(plan, selectionIds, name),
                  );
                  setAssemblies((rows) => [assembly, ...rows]);
                  toast("Arrangement saved to the practice library");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save to practice library
            </button>
          )}
          <p className="tiny muted">
            Colour and hidden furniture are working-view settings. Client
            publication is controlled separately.
          </p>
        </div>
      )}
      {libraryAllowed && (
        <details className="plan-assembly-library">
          <summary className="small strong">
            Practice library ({assemblies.length})
          </summary>
          <p className="tiny muted">
            Saved arrangements are visible to practice owners and members across
            projects. Group names and hidden-view flags are omitted from client
            plans.
          </p>
          {assemblies.map((assembly) => (
            <div className="plan-tree-row" key={assembly.id}>
              <button
                type="button"
                className="tiny grow"
                onClick={() => {
                  const bounds = planBounds(floor);
                  const at = bounds
                    ? {
                        x: (bounds.minX + bounds.maxX) / 2,
                        y: (bounds.minY + bounds.maxY) / 2,
                      }
                    : { x: 6_000, y: 4_000 };
                  const result = placeAssembly(plan, assembly, levelId, at);
                  if (apply(result) && result.ok && result.id) {
                    const group = result.plan.items.find(
                      (i) => i.id === result.id,
                    )!.groupId;
                    onMultiSelect(
                      result.plan.items
                        .filter((i) => i.groupId === group)
                        .map((i) => i.id),
                    );
                  }
                }}
              >
                {assembly.name}
                <span className="muted">
                  {" "}
                  · {assembly.items.length} items · Place on this floor
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                aria-label={`Remove ${assembly.name} from library`}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await backend.remove(assembly.id);
                    setAssemblies((rows) =>
                      rows.filter((a) => a.id !== assembly.id),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!assemblies.length && (
            <p className="tiny muted">
              Select furniture and save an arrangement to reuse it here.
            </p>
          )}
        </details>
      )}
      {error && (
        <div role="alert" className="small">
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setReload((r) => r + 1)}
          >
            Reload library
          </button>
        </div>
      )}
    </div>
  );
}
