"use client";

import { KIND_LABEL, lineCents, money, totals, type BusinessDoc } from "@/lib/business/model";
import "./business.css";

export interface SheetStudio {
  name: string;
  address: string;
  email: string;
  phone: string;
  registration: string;
  vatNumber: string;
  bankDetails: string;
}

const date = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" }) : "");

/**
 * A proposal, invoice or purchase order as the client or supplier sees it and
 * as it prints. A VAT-registered studio's invoice reads "Tax invoice" and
 * carries both VAT numbers, as South African VAT invoices must.
 */
export function DocSheet({ doc, studio }: { doc: Pick<BusinessDoc, "kind" | "status" | "number" | "title" | "party" | "lines" | "notes" | "terms" | "issueDate" | "dueDate" | "vatRate" | "currency" | "acceptedName" | "acceptedAt" | "paidCents">; studio: SheetStudio }) {
  const t = totals(doc.lines, doc.vatRate);
  const heading = doc.kind === "invoice" && doc.vatRate > 0 ? "Tax invoice" : KIND_LABEL[doc.kind];
  return (
    <article className="doc-sheet">
      <header className="doc-sheet-head">
        <div className="stack" style={{ gap: "0.2rem" }}>
          <strong className="doc-sheet-studio">{studio.name || "Your studio"}</strong>
          {studio.address && <span className="tiny muted pre">{studio.address}</span>}
          <span className="tiny muted">{[studio.email, studio.phone].filter(Boolean).join(" · ")}</span>
          {studio.registration && <span className="tiny muted">Reg. {studio.registration}</span>}
          {studio.vatNumber && <span className="tiny muted">VAT {studio.vatNumber}</span>}
        </div>
        <div className="stack doc-sheet-meta">
          <span className="doc-sheet-kind">{heading}</span>
          <span className="small strong">{doc.number ?? "Draft"}</span>
          {doc.issueDate && <span className="tiny muted">Date {date(doc.issueDate)}</span>}
          {doc.dueDate && <span className="tiny muted">{doc.kind === "proposal" ? "Valid until" : doc.kind === "invoice" ? "Due" : "Needed by"} {date(doc.dueDate)}</span>}
        </div>
      </header>

      <section className="doc-sheet-party">
        <span className="eyebrow">{doc.kind === "purchase_order" ? "Supplier" : "For"}</span>
        <strong>{doc.party.name || "—"}</strong>
        {doc.party.address && <span className="small muted pre">{doc.party.address}</span>}
        {doc.party.email && <span className="small muted">{doc.party.email}</span>}
        {doc.party.vatNumber && <span className="small muted">VAT {doc.party.vatNumber}</span>}
      </section>

      {doc.title && <h1 className="doc-sheet-title">{doc.title}</h1>}
      {doc.notes && <p className="small pre">{doc.notes}</p>}

      <table className="doc-sheet-lines">
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Unit</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td className="num">{l.quantity}</td>
              <td className="num">{money(Math.round(l.unitCents * (1 + (l.markupPct ?? 0) / 100)), doc.currency)}</td>
              <td className="num">{money(lineCents(l), doc.currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>Subtotal</td>
            <td className="num">{money(t.subtotalCents, doc.currency)}</td>
          </tr>
          {doc.vatRate > 0 && (
            <tr>
              <td colSpan={3}>VAT at {doc.vatRate}%</td>
              <td className="num">{money(t.vatCents, doc.currency)}</td>
            </tr>
          )}
          <tr className="doc-sheet-total">
            <td colSpan={3}>Total</td>
            <td className="num">{money(t.totalCents, doc.currency)}</td>
          </tr>
          {doc.kind === "invoice" && doc.paidCents > 0 && doc.status !== "paid" && (
            <tr>
              <td colSpan={3}>Paid so far</td>
              <td className="num">{money(doc.paidCents, doc.currency)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      {doc.kind === "invoice" && studio.bankDetails && (
        <section className="doc-sheet-block">
          <span className="eyebrow">How to pay</span>
          <p className="small pre">{studio.bankDetails}</p>
          {doc.number && <p className="tiny muted">Use {doc.number} as the reference.</p>}
        </section>
      )}
      {doc.terms && (
        <section className="doc-sheet-block">
          <span className="eyebrow">Terms</span>
          <p className="small pre">{doc.terms}</p>
        </section>
      )}
      {doc.status === "accepted" && doc.acceptedName && (
        <p className="small doc-sheet-accepted">
          Accepted by {doc.acceptedName}
          {doc.acceptedAt ? ` on ${new Date(doc.acceptedAt).toLocaleString("en-ZA")}` : ""}.
        </p>
      )}
      {doc.status === "paid" && <p className="small doc-sheet-accepted">Paid in full. Thank you.</p>}
    </article>
  );
}
