/* eslint-disable @next/next/no-img-element -- Board images come from authenticated project routes. */

import React from "react";
import { byId, connectorMid, connectorPath, drawOrder, penPath, shapePath, type ById } from "@/lib/whiteboard/geometry";
import type { WbElement } from "@/lib/whiteboard/types";

/**
 * Draws a board's elements as SVG in board units: the live whiteboard and
 * every read-only preview of it use this, so they always look the same.
 */

export function WhiteboardScene({
  elements,
  imageUrl,
  editing,
  arrowId = "wb",
}: {
  elements: WbElement[];
  imageUrl: (documentId: string) => string | undefined;
  /** The element whose words are being typed over, which hides its own. */
  editing?: string | null;
  /** Keeps the arrowhead markers apart when several boards are on one page. */
  arrowId?: string;
}) {
  const all = byId(elements);
  const colours = [...new Set(elements.flatMap((e) => (e.kind === "connector" ? [e.stroke] : [])))];
  return (
    <>
      <defs>
        {colours.map((c) => (
          <marker key={c} id={`${arrowId}-arrow-${c.slice(1)}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse" markerUnits="strokeWidth">
            <path d="M0,0 L10,5 L0,10 Z" fill={c} />
          </marker>
        ))}
      </defs>
      {drawOrder(elements).map((e) => (
        <ElementView key={e.id} el={e} all={all} imageUrl={imageUrl} hideText={editing === e.id} arrowId={arrowId} />
      ))}
    </>
  );
}

const ElementView = React.memo(function ElementView({ el, all, imageUrl, hideText, arrowId }: { el: WbElement; all: ById; imageUrl: (id: string) => string | undefined; hideText: boolean; arrowId: string }) {
  const turn = el.rotation ? `rotate(${el.rotation} ${el.x + el.w / 2} ${el.y + el.h / 2})` : undefined;
  switch (el.kind) {
    case "frame":
      return (
        <g transform={turn} data-id={el.id}>
          <text x={el.x} y={el.y - 10} className="wb-frame-title">{hideText ? "" : el.title || "Frame"}</text>
          <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={el.fill} className="wb-frame" />
        </g>
      );
    case "sticky":
      return (
        <g transform={turn} data-id={el.id}>
          <rect x={el.x + 2} y={el.y + 5} width={el.w} height={el.h} className="wb-sticky-shadow" />
          <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={el.color} />
          {!hideText && <Words x={el.x} y={el.y} w={el.w} h={el.h} text={el.text} size={el.fontSize ?? autoSize(el.text, el.w, el.h)} pad={16} align="center" />}
        </g>
      );
    case "shape":
      return (
        <g transform={turn ? `${turn} translate(${el.x} ${el.y})` : `translate(${el.x} ${el.y})`} data-id={el.id}>
          <path d={shapePath(el.shape, el.w, el.h)} fill={el.fill === "none" ? "transparent" : el.fill} stroke={el.stroke === "none" ? "none" : el.stroke} strokeWidth={el.strokeWidth} strokeDasharray={el.dash ? `${el.strokeWidth * 3} ${el.strokeWidth * 2}` : undefined} strokeLinejoin="round" />
          {!hideText && el.text && <Words x={0} y={el.shape === "speech" ? 0 : 0} w={el.w} h={el.shape === "speech" ? el.h * 0.78 : el.h} text={el.text} size={el.fontSize ?? autoSize(el.text, el.w * 0.8, el.h * 0.7)} pad={Math.min(el.w, el.h) * 0.12} align="center" color={el.textColor} />}
        </g>
      );
    case "text":
      return (
        <g transform={turn} data-id={el.id}>
          {!hideText && <Words x={el.x} y={el.y} w={el.w} h={el.h} text={el.text || " "} size={el.fontSize} pad={0} align={el.align} color={el.color} bold={el.bold} top />}
        </g>
      );
    case "pen":
      return (
        <g transform={turn ? `${turn} translate(${el.x} ${el.y})` : `translate(${el.x} ${el.y})`} data-id={el.id}>
          <path d={penPath(el.points)} fill="none" stroke={el.stroke} strokeWidth={el.highlight ? el.strokeWidth * 4 : el.strokeWidth} strokeLinecap="round" strokeLinejoin="round" opacity={el.highlight ? 0.35 : 1} />
        </g>
      );
    case "connector": {
      const marker = `url(#${arrowId}-arrow-${el.stroke.slice(1)})`;
      const mid = el.label ? connectorMid(el, all) : null;
      return (
        <g data-id={el.id}>
          <path d={connectorPath(el, all)} fill="none" stroke={el.stroke} strokeWidth={el.strokeWidth} strokeDasharray={el.dash ? `${el.strokeWidth * 3} ${el.strokeWidth * 2.5}` : undefined} strokeLinecap="round" strokeLinejoin="round" markerStart={el.startArrow ? marker : undefined} markerEnd={el.endArrow ? marker : undefined} />
          {mid && !hideText && (
            <foreignObject x={mid.x - 90} y={mid.y - 16} width={180} height={32}>
              <div className="wb-connector-label"><span>{el.label}</span></div>
            </foreignObject>
          )}
        </g>
      );
    }
    case "card": {
      const url = el.documentId ? imageUrl(el.documentId) : undefined;
      return (
        <g transform={turn} data-id={el.id}>
          <rect x={el.x + 1} y={el.y + 4} width={el.w} height={el.h} rx={10} className="wb-sticky-shadow" />
          <foreignObject x={el.x} y={el.y} width={el.w} height={el.h}>
            <div className="wb-card" style={{ background: el.color }}>
              {url && <img src={url} alt={el.title} draggable={false} />}
              {!hideText && (el.title || el.body) && (
                <div className="wb-card-words">
                  {el.title && <strong>{el.title}</strong>}
                  {el.body && <p>{el.body}</p>}
                </div>
              )}
            </div>
          </foreignObject>
        </g>
      );
    }
  }
});

/** Words wrapped inside a box, centred or set left, at a size that fits. */
function Words({ x, y, w, h, text, size, pad, align, color, bold, top }: { x: number; y: number; w: number; h: number; text: string; size: number; pad: number; align: "left" | "center" | "right"; color?: string; bold?: boolean; top?: boolean }) {
  return (
    <foreignObject x={x} y={y} width={w} height={h}>
      <div
        className="wb-words"
        style={{ fontSize: size, padding: pad, textAlign: align, justifyContent: top ? "flex-start" : "center", color, fontWeight: bold ? 650 : undefined, alignItems: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center" }}
      >
        <span>{text}</span>
      </div>
    </foreignObject>
  );
}

/** A type size that fills a sticky or shape without spilling, as Miro shrinks long notes. */
export function autoSize(text: string, w: number, h: number): number {
  const chars = Math.max(text.length, 1);
  const lines = text.split("\n").length;
  // Roughly: area per character at a size s is 0.55 s × 1.25 s.
  const byArea = Math.sqrt((w * h * 0.62) / (chars * 0.69));
  const byLines = (h * 0.8) / (lines * 1.25);
  return Math.max(8, Math.min(48, Math.floor(Math.min(byArea, byLines, w / 4))));
}
