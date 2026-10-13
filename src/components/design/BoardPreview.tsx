import type { DesignBoard } from "@/lib/design/schema";
import { WhiteboardScene } from "@/components/whiteboard/WhiteboardScene";
import { boardBounds, boardElements } from "@/lib/whiteboard/board";
import "@/components/whiteboard/whiteboard.css";

/** A board drawn small and read-only, exactly as it looks on the whiteboard. */
export function BoardPreview({
  board,
  imageUrl,
}: {
  board: DesignBoard;
  imageUrl: (id: string) => string | undefined;
}) {
  const els = boardElements(board);
  const box = boardBounds(els) ?? { x: 0, y: 0, w: 1600, h: 1000 };
  const pad = Math.max(box.w, box.h) * 0.03 + 20;
  return (
    <div
      className="board-preview"
      role="img"
      aria-label="Arranged board of images and notes"
    >
      <svg
        viewBox={`${box.x - pad} ${box.y - pad - 30} ${box.w + pad * 2} ${box.h + pad * 2 + 30}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
      >
        <WhiteboardScene elements={els} imageUrl={imageUrl} arrowId={`pv-${board.id.slice(0, 8)}`} />
      </svg>
    </div>
  );
}
