import type { BoardCard, DesignBoard } from "@/lib/design/schema";
import { bounds, byId, union, type Rect } from "./geometry";
import type { BoardElement, CardEl, WbElement } from "./types";

/**
 * A mood board as a whiteboard: its cards (images and notes, kept apart so the
 * palette, sharing and concepts still find them) become card elements beside
 * the board's own stickies, shapes and lines, and split back on the way out.
 */

/** A card's height when it has none saved: an image at about 4:3 with its title under it. */
export function cardHeight(card: Pick<BoardCard, "width" | "height" | "documentId" | "title" | "body">): number {
  if (card.height) return card.height;
  if (card.documentId) return Math.round(card.width * 0.75) + (card.title || card.body ? 52 : 0);
  return Math.max(120, Math.min(320, 70 + Math.ceil((card.body.length || 1) / 32) * 18));
}

export function boardElements(board: Pick<DesignBoard, "cards" | "elements"> | undefined): WbElement[] {
  if (!board) return [];
  const cards: CardEl[] = board.cards.map((c, i) => ({
    id: c.id,
    kind: "card",
    x: c.x,
    y: c.y,
    w: c.width,
    h: cardHeight(c),
    z: c.z ?? i - board.cards.length,
    ...(c.rotation ? { rotation: c.rotation } : {}),
    ...(c.locked ? { locked: true } : {}),
    ...(c.groupId ? { groupId: c.groupId } : {}),
    title: c.title,
    body: c.body,
    tags: c.tags,
    group: c.group,
    documentId: c.documentId,
    color: c.color,
  }));
  return [...cards, ...(board.elements ?? [])];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Splits whiteboard elements back into the board's cards and its other elements. */
export function splitElements(els: WbElement[]): { cards: BoardCard[]; elements: BoardElement[] } {
  const cards: BoardCard[] = [];
  const elements: BoardElement[] = [];
  for (const e of els) {
    if (e.kind !== "card") {
      elements.push(e);
      continue;
    }
    cards.push({
      id: e.id,
      title: e.title,
      body: e.body,
      tags: e.tags,
      group: e.group,
      documentId: e.documentId,
      color: e.color,
      x: clamp(r1(e.x), -200_000, 200_000),
      y: clamp(r1(e.y), -200_000, 200_000),
      width: clamp(r1(e.w), 60, 4000),
      height: clamp(r1(e.h), 40, 4000),
      z: e.z,
      ...(e.rotation ? { rotation: e.rotation } : {}),
      ...(e.locked ? { locked: true } : {}),
      ...(e.groupId ? { groupId: e.groupId } : {}),
    });
  }
  return { cards, elements };
}

/** The board with these elements in place of what it had. */
export function withElements(board: DesignBoard, els: WbElement[]): DesignBoard {
  const { cards, elements } = splitElements(els);
  return { ...board, cards, elements };
}

/** Everything on a board, as one box, or null when it is empty. */
export function boardBounds(els: WbElement[]): Rect | null {
  const all = byId(els);
  return union(els.map((e) => bounds(e, all)));
}

/** A clear place for a new card: right of everything on the first row, or below the board when that row is long. */
export function placeCard(board: Pick<DesignBoard, "cards" | "elements"> | undefined): { x: number; y: number } {
  const els = boardElements(board);
  const box = boardBounds(els);
  if (!box) return { x: 0, y: 0 };
  if (box.w < 2400) return { x: Math.round(box.x + box.w + 40), y: Math.round(box.y) };
  return { x: Math.round(box.x), y: Math.round(box.y + box.h + 40) };
}
