/* eslint-disable @next/next/no-img-element -- Revocable client images must bypass optimization caches. */
import type { SharedContent } from "@/lib/sharing/types";
import { BoardPreview } from "@/components/design/BoardPreview";
import "@/components/design/design.css";
export function SharedDesign({
  content,
}: {
  content: Extract<SharedContent, { type: "board" | "schedule" }>;
}) {
  if (content.type === "board")
    return (
      <section>
        <BoardPreview
          board={content.board}
          imageUrl={(id) => content.imageUrls[id]}
        />
        <div className="shared-board-notes">
          {content.board.cards.map((c) => (
            <article key={c.id}>
              {c.documentId && content.imageUrls[c.documentId] && (
                <img src={content.imageUrls[c.documentId]} alt={c.title} />
              )}
              <h2>{c.title || "Selection"}</h2>
              {c.group && <p className="small muted">{c.group}</p>}
              <p style={{ whiteSpace: "pre-wrap" }}>{c.body}</p>
              {c.tags.length > 0 && (
                <p className="small muted">{c.tags.join(" · ")}</p>
              )}
            </article>
          ))}
        </div>
      </section>
    );
  return (
    <section className="schedule-scroll">
      <table className="design-schedule shared-schedule">
        <thead>
          <tr>
            <th>Selection</th>
            <th>Specification</th>
            <th>Dimensions</th>
            <th>Qty</th>
          </tr>
        </thead>
        <tbody>
          {content.items.map((i) => (
            <tr key={i.id}>
              <td>
                {i.documentId && content.imageUrls[i.documentId] && (
                  <img src={content.imageUrls[i.documentId]} alt={i.name} />
                )}
                <strong>{i.name}</strong>
                <p className="small muted">
                  {i.category} {i.tags.join(" · ")}
                </p>
              </td>
              <td style={{ whiteSpace: "pre-wrap" }}>
                {i.specification || "To be specified"}
              </td>
              <td>{i.dimensions || "To be confirmed"}</td>
              <td>{i.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
