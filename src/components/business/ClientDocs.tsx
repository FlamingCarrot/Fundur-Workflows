import type { Db } from "@/lib/db";
import { listDocs } from "@/lib/business/store";
import { isOverdue, KIND_LABEL, money } from "@/lib/business/model";
import "./business.css";

/**
 * On the client's progress page: the proposals and invoices the studio has
 * sent them for this project, each opening its own link. Drafts and supplier
 * orders never show.
 */
export async function ClientDocs({ db, workspaceId, projectId }: { db: Db; workspaceId: string; projectId: string }) {
  const docs = (await listDocs(db, workspaceId, { projectId, origin: "" })).filter(
    (d) => (d.kind === "proposal" || d.kind === "invoice") && d.status !== "draft" && d.status !== "void" && d.link
  );
  if (!docs.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="client-progress" style={{ marginTop: "1.5rem" }}>
      <section className="card" style={{ padding: "1.1rem 1.25rem", display: "grid", gap: "0.6rem" }}>
      <h2 className="eyebrow">Proposals and invoices</h2>
      <div className="biz-list">
        {docs.map((d) => {
          const overdue = isOverdue(d, today);
          const label = overdue ? "Overdue" : d.status === "sent" ? (d.kind === "proposal" ? "Waiting for you" : d.paidCents ? "Part paid" : "To pay") : d.status[0].toUpperCase() + d.status.slice(1);
          return (
            <a key={d.id} href={d.link!} className="biz-row" style={{ padding: "0.5rem 0" }}>
              <span className="biz-row-main">
                <span className="small strong truncate">{d.title || KIND_LABEL[d.kind]}</span>
                <span className="tiny muted">{KIND_LABEL[d.kind]} {d.number}{d.dueDate && d.status === "sent" && d.kind === "invoice" ? ` · due ${d.dueDate}` : ""}</span>
              </span>
              <span className="biz-row-side">
                <span className="biz-status" data-status={overdue ? "overdue" : d.status}>{label}</span>
                <span className="biz-amount">{money(d.totals.totalCents, d.currency)}</span>
              </span>
            </a>
          );
        })}
      </div>
    </section>
    </div>
  );
}
