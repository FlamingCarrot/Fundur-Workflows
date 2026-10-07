/* eslint-disable @next/next/no-img-element -- Private images use authenticated project routes. */
"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { GripVertical } from "lucide-react";
import type { DesignBoard, BoardCard } from "@/lib/design/schema";

const WIDTH = 1600,
  HEIGHT = 1000;
const clampZoom = (n: number) => Math.max(0.05, Math.min(2, n));
type Pan = { signal: number; x: number; y: number };
type Touch = { x: number; y: number };

export function BoardCanvas({
  board,
  imageUrl,
  selected,
  group = "",
  onSelect,
  onMove,
  zoom = 0,
  onZoom,
  fitSignal = 0,
}: {
  board: DesignBoard;
  imageUrl: (id: string) => string | undefined;
  selected?: string;
  group?: string;
  onSelect?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  /** Zero fits the whole board into the current viewport. */
  zoom?: number;
  onZoom?: (zoom: number) => void;
  fitSignal?: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [pan, setPan] = useState<Pan>({ signal: 0, x: 0, y: 0 });
  const [position, setPosition] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const latestPosition = useRef<typeof position>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    px: number;
    py: number;
  } | null>(null);
  const touches = useRef(new Map<number, Touch>());
  const panStart = useRef<{
    x: number;
    y: number;
    px: number;
    py: number;
  } | null>(null);
  const pinch = useRef<{
    distance: number;
    scale: number;
    world: Touch;
  } | null>(null);
  const scale =
    zoom || Math.max(0.001, Math.min(size.w / WIDTH, size.h / HEIGHT));
  const p = pan.signal === fitSignal ? pan : { x: 0, y: 0 };
  const offset = {
    x: (size.w - WIDTH * scale) / 2 + p.x,
    y: (size.h - HEIGHT * scale) / 2 + p.y,
  };

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const zoomAt = useCallback(
    (next: number, at: Touch, world?: Touch) => {
      if (!onZoom) return;
      next = clampZoom(next);
      const anchor = world ?? {
        x: (at.x - offset.x) / scale,
        y: (at.y - offset.y) / scale,
      };
      setPan({
        signal: fitSignal,
        x: at.x - anchor.x * next - (size.w - WIDTH * next) / 2,
        y: at.y - anchor.y * next - (size.h - HEIGHT * next) / 2,
      });
      onZoom(next);
    },
    [onZoom, scale, offset.x, offset.y, size.w, size.h, fitSignal],
  );

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      zoomAt(scale * Math.exp(-e.deltaY * 0.002), {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [scale, zoomAt]);

  function relative(e: PointerEvent) {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function startPan(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".board-card") || e.button !== 0)
      return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    touches.current.set(e.pointerId, relative(e));
    if (touches.current.size === 2) {
      const [a, b] = [...touches.current.values()],
        at = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      pinch.current = {
        distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        scale,
        world: { x: (at.x - offset.x) / scale, y: (at.y - offset.y) / scale },
      };
      panStart.current = null;
    } else {
      panStart.current = { x: p.x, y: p.y, px: e.clientX, py: e.clientY };
    }
  }
  function movePan(e: PointerEvent<HTMLDivElement>) {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, relative(e));
    if (touches.current.size === 2 && pinch.current) {
      const [a, b] = [...touches.current.values()],
        start = pinch.current;
      zoomAt(
        (start.scale * Math.hypot(a.x - b.x, a.y - b.y)) / start.distance,
        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        start.world,
      );
    } else if (panStart.current) {
      const start = panStart.current;
      setPan({
        signal: fitSignal,
        x: start.x + e.clientX - start.px,
        y: start.y + e.clientY - start.py,
      });
    }
  }
  function endPan(e: PointerEvent<HTMLDivElement>) {
    touches.current.delete(e.pointerId);
    pinch.current = null;
    panStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function startCard(e: PointerEvent<HTMLButtonElement>, card: BoardCard) {
    if (!onMove) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(card.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    latestPosition.current = null;
    drag.current = {
      id: card.id,
      x: card.x,
      y: card.y,
      px: e.clientX,
      py: e.clientY,
    };
  }
  function moveCard(e: PointerEvent<HTMLButtonElement>, card: BoardCard) {
    const d = drag.current;
    if (!d || d.id !== card.id) return;
    const next = {
      id: card.id,
      x: Math.max(
        0,
        Math.min(
          WIDTH - card.width,
          Math.round((d.x + (e.clientX - d.px) / scale) / 10) * 10,
        ),
      ),
      y: Math.max(
        0,
        Math.min(800, Math.round((d.y + (e.clientY - d.py) / scale) / 10) * 10),
      ),
    };
    latestPosition.current = next;
    setPosition(next);
  }
  function finishCard(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current,
      at = latestPosition.current;
    if (!d) return;
    if (at?.id === d.id) onMove?.(d.id, at.x, at.y);
    drag.current = null;
    latestPosition.current = null;
    setPosition(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div
      ref={viewport}
      className="board-scroll"
      tabIndex={0}
      aria-label="Board canvas. Drag empty space to pan; pinch or use Zoom to explore. Use each card's handle to arrange it."
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const delta = {
          ArrowLeft: { x: 60, y: 0 },
          ArrowRight: { x: -60, y: 0 },
          ArrowUp: { x: 0, y: 60 },
          ArrowDown: { x: 0, y: -60 },
        }[e.key];
        if (delta) {
          e.preventDefault();
          setPan({ signal: fitSignal, x: p.x + delta.x, y: p.y + delta.y });
        }
        if (e.key === "+" || e.key === "=" || e.key === "-") {
          e.preventDefault();
          zoomAt(scale * (e.key === "-" ? 0.8 : 1.25), {
            x: size.w / 2,
            y: size.h / 2,
          });
        }
        if (e.key === "0") {
          e.preventDefault();
          setPan({ signal: fitSignal, x: 0, y: 0 });
          onZoom?.(0);
        }
      }}
    >
      <div
        className="board-canvas"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
        }}
      >
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
                      onPointerDown={(e) => startCard(e, c)}
                      onPointerMove={(e) => moveCard(e, c)}
                      onPointerUp={finishCard}
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
  );
}
