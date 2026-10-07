/* eslint-disable @next/next/no-img-element -- Private images must use authenticated project routes rather than a shared optimization cache. */
"use client";
import { useRef, useState, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";
import type { DesignBoard, BoardCard } from "@/lib/design/schema";

export function BoardCanvas({
  board,
  imageUrl,
  selected,
  group = "",
  onSelect,
  onMove,
  zoom = 1,
}: {
  board: DesignBoard;
  imageUrl: (id: string) => string | undefined;
  selected?: string;
  group?: string;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  zoom?: number;
}) {
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    px: number;
    py: number;
    pointer: number;
  } | null>(null);
  const latestPosition = useRef<{ id: string; x: number; y: number } | null>(
    null,
  );
  const [position, setPosition] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  function start(e: PointerEvent<HTMLButtonElement>, card: BoardCard) {
    if (!onMove) return;
    e.preventDefault();
    onSelect?.(card.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    latestPosition.current = null;
    drag.current = {
      id: card.id,
      x: card.x,
      y: card.y,
      px: e.clientX,
      py: e.clientY,
      pointer: e.pointerId,
    };
  }
  function move(e: PointerEvent<HTMLButtonElement>, card: BoardCard) {
    const d = drag.current;
    if (!d || d.id !== card.id) return;
    const next = {
      id: card.id,
      x: Math.max(
        0,
        Math.min(
          1600 - card.width,
          Math.round((d.x + (e.clientX - d.px) / zoom) / 10) * 10,
        ),
      ),
      y: Math.max(
        0,
        Math.min(800, Math.round((d.y + (e.clientY - d.py) / zoom) / 10) * 10),
      ),
    };
    latestPosition.current = next;
    setPosition(next);
  }
  function finish(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const at = latestPosition.current;
    if (at?.id === d.id) onMove?.(d.id, at.x, at.y);
    drag.current = null;
    latestPosition.current = null;
    setPosition(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div
      className="board-scroll"
      tabIndex={0}
      aria-label="Board canvas. Scroll to explore; use each card's move handle to arrange it."
    >
      <div style={{ width: 1600 * zoom, height: 1000 * zoom }}>
        <div className="board-canvas" style={{ transform: `scale(${zoom})` }}>
          {board.cards
            .filter((c) => !group || c.group === group)
            .map((c) => {
              const at = position?.id === c.id ? position : c,
                url = c.documentId ? imageUrl(c.documentId) : undefined;
              return (
                <article
                  key={c.id}
                  className="board-card"
                  data-selected={selected === c.id}
                  onClick={() => onSelect?.(c.id)}
                  style={{
                    left: at.x,
                    top: at.y,
                    width: c.width,
                    background: c.color,
                  }}
                >
                  <div className="board-card-head">
                    {onMove && (
                      <button
                        type="button"
                        className="icon-btn board-handle"
                        aria-label={`Move ${c.title || "card"}`}
                        onPointerDown={(e) => start(e, c)}
                        onPointerMove={(e) => move(e, c)}
                        onPointerUp={finish}
                        onPointerCancel={() => {
                          drag.current = null;
                          latestPosition.current = null;
                          setPosition(null);
                        }}
                      >
                        <GripVertical size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="board-card-title"
                      onClick={() => onSelect?.(c.id)}
                      disabled={!onSelect}
                    >
                      {c.title || "Untitled card"}
                    </button>
                  </div>
                  {url ? (
                    <img
                      src={url}
                      alt={c.title || "Board image"}
                      draggable={false}
                    />
                  ) : (
                    <p className="board-card-note">
                      {c.body || "Add a note or choose an image"}
                    </p>
                  )}
                  <div className="board-card-tags">
                    {c.group && <span>{c.group}</span>}
                    {c.tags.slice(0, 3).map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                </article>
              );
            })}
        </div>
      </div>
    </div>
  );
}
