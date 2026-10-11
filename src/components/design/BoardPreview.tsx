/* eslint-disable @next/next/no-img-element -- Tokenized private images bypass the shared image optimization cache. */
import type { DesignBoard } from "@/lib/design/schema";
export function BoardPreview({
  board,
  imageUrl,
}: {
  board: DesignBoard;
  imageUrl: (id: string) => string | undefined;
}) {
  return (
    <div
      className="board-preview"
      role="img"
      aria-label="Arranged board of images and notes"
    >
      {board.cards.map((c) => {
        const url = c.documentId ? imageUrl(c.documentId) : undefined;
        return (
          <div
            key={c.id}
            className="board-preview-card"
            style={{
              left: `${c.x / 16}%`,
              top: `${c.y / 10}%`,
              width: `${c.width / 16}%`,
              height: "20%",
              background: c.color,
            }}
          >
            {url ? (
              <img src={url} alt={c.title} />
            ) : (
              <p>
                {c.title}
                <br />
                {c.body}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
