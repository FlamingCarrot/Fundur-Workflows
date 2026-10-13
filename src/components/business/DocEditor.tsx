"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy, Plus, Printer, Send, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { KIND_LABEL, lineCents, money, totals, type BusinessDoc, type BusinessSettings, type DocInput, type DocLine } from "@/lib/business/model";
import { DocSheet, type SheetStudio } from "./DocSheet";
import { send, useDoc } from "./useBusiness";
import "./business.css";

const studioOf = (s: BusinessSettings): SheetStudio => ({
  name: s.studioName,
  address: s.address,
  email: s.email,
  phone: s.phone,
  registration: s.registration,
  vatNumber: s.vatRegistered ? s.vatNumber : "",
  bankDetails: s.bankDetails,
});

const editable = (d: BusinessDoc): DocInput => ({ title: d.title, party: d.party, lines: d.lines, notes: d.notes, terms: d.terms, issueDate: d.issueDate, dueDate: d.dueDate });

/**
 * One proposal, invoice or order: edit it while it is a draft, then send it
 * (it gets its number and a link for the client), and record what happens.
 */
export function DocEditor({ id }: { id: string }) {
  const { data, error, mutate } = useDoc(id);
  const { toast, receiveProject } = useStudio();
  const router = useRouter();
  const [draft, setDraft] = React.useState<DocInput | null>(null);
  const [saving, setSaving] = React.useState(false);

  if (error) return <main className="page"><p className="small" style={{ color: "var(--bad)" }}>{error.message}</p></main>;
  if (!data) return <main className="page"><p className="small muted">Loading…</p></main>;
  const { doc, settings } = data;
  const value = draft ?? editable(doc);
  const isDraft = doc.status === "draft";
  const preview = { ...doc, ...value };
  const sums = totals(value.lines, doc.vatRate);

  const set = <K extends keyof DocInput>(k: K, v: DocInput[K]) => setDraft({ ...value, [k]: v });
  const setLine = (i: number, patch: Partial<DocLine>) => set("lines", value.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const addLine = () =>
    set("lines", [...value.lines, { id: `line-${Date.now().toString(36)}`, description: "", quantity: 1, unitCents: 0, kind: doc.kind === "purchase_order" ? "item" : "fee", markupPct: 0 }]);

  const save = async (): Promise<boolean> => {
    if (!draft) return true;
    if (draft.lines.some((l) => !l.description.trim())) {
      toast("Every line needs a description");
      return false;
    }
    setSaving(true);
    try {
      await send(`/api/business/docs/${id}`, "PATCH", draft);
      setDraft(null);
      await mutate();
      return true;
    } catch (err) {
      toast((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  const act = async (body: Record<string, unknown>, done?: string) => {
    if (!(await save())) return;
    try {
      await send(`/api/business/docs/${id}/status`, "POST", body);
      await mutate();
      if (done) toast(done);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm("Delete this draft?")) return;
    try {
      await send(`/api/business/docs/${id}`, "DELETE");
      router.push("/business");
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const startProject = async () => {
    if (!doc.leadId) return;
    try {
      const out = await send<{ project: { id: string } }>(`/api/business/leads/${doc.leadId}/project`, "POST", {});
      receiveProject(out.project as never);
      router.push(`/projects/${out.project.id}`);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const copyLink = () => doc.link && navigator.clipboard?.writeText(doc.link).then(() => toast("Link copied"));
  const mail = doc.link && doc.party.email
    ? `mailto:${encodeURIComponent(doc.party.email)}?subject=${encodeURIComponent(`${KIND_LABEL[doc.kind]} ${doc.number ?? ""} from ${settings.studioName || "the studio"}`)}&body=${encodeURIComponent(`Hello ${doc.party.name},\n\nHere is your ${KIND_LABEL[doc.kind].toLowerCase()}: ${doc.link}\n\nKind regards\n${settings.studioName}`)}`
    : null;

  return (
    <main className="page biz-editor">
      <div className="row-between no-print" style={{ marginBottom: "1rem", gap: "0.5rem", flexWrap: "wrap" }}>
        <Link href="/business" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Business</Link>
        <div className="row wrap" style={{ gap: "0.4rem" }}>
          {isDraft && <button type="button" className="btn btn-ghost btn-sm" onClick={remove}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()}><Printer size={14} /> Print or PDF</button>
          {isDraft && draft && <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={save}>Save draft</button>}
          {isDraft && (
            <button type="button" className="btn btn-primary btn-sm" disabled={saving || !value.lines.length} onClick={() => act({ action: "send" }, "Sent. Copy the link or email it to them.")}>
              <Send size={14} /> Mark as sent
            </button>
          )}
        </div>
      </div>

      {doc.aiDrafted && isDraft && <p className="card small no-print" style={{ padding: "0.75rem 1rem", marginBottom: "1rem" }}>The AI drafted this. Check every line before you send it.</p>}

      {!isDraft && (
        <section className="card biz-form no-print" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <div className="row wrap" style={{ gap: "0.5rem", alignItems: "center" }}>
            <span className="small strong">{doc.number}</span>
            <span className="biz-status" data-status={doc.status}>{doc.status}</span>
            {doc.link && (
              <>
                <input className="input" readOnly value={doc.link} style={{ flex: "1 1 240px", width: "auto" }} onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={copyLink}><Copy size={14} /> Copy link</button>
                {mail && <a className="btn btn-secondary btn-sm" href={mail}>Email it</a>}
              </>
            )}
          </div>
          <div className="row wrap" style={{ gap: "0.4rem" }}>
            {doc.kind === "invoice" && doc.status === "sent" && (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => act({ action: "paid" }, "Marked as paid")}>Mark paid</button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const r = prompt(`How much has been paid in total? (${money(doc.paidCents, doc.currency)} so far)`);
                    const n = r ? Number(r.replace(/[^0-9.]/g, "")) : NaN;
                    if (Number.isFinite(n) && n >= 0) act({ action: "payment", paidCents: Math.round(n * 100) }, "Payment recorded");
                  }}
                >
                  Record a part payment
                </button>
              </>
            )}
            {doc.kind === "proposal" && doc.status === "sent" && (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const name = prompt("Who accepted it? (as they signed or wrote it)");
                    if (name && name.trim().length > 1) act({ action: "accepted", name: name.trim() }, "Marked as accepted");
                  }}
                >
                  They accepted
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => act({ action: "declined" })}>They declined</button>
              </>
            )}
            {doc.kind === "proposal" && doc.status === "accepted" && doc.leadId && !doc.projectId && (
              <button type="button" className="btn btn-primary btn-sm" onClick={startProject}>Start the project</button>
            )}
            {doc.projectSlug && <Link className="btn btn-ghost btn-sm" href={`/projects/${doc.projectSlug}`}>Open {doc.projectName}</Link>}
            {doc.status !== "void" && doc.status !== "paid" && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => confirm("Void this? It stays on record, marked void.") && act({ action: "void" })}>Void</button>
            )}
          </div>
        </section>
      )}

      {isDraft && (
        <section className="card biz-form no-print" style={{ padding: "1rem", marginBottom: "1rem" }}>
          <label className="field">
            <span className="field-label">Title</span>
            <input className="input" value={value.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <div className="biz-form-grid">
            <label className="field">
              <span className="field-label">{doc.kind === "purchase_order" ? "Supplier" : "Client"}</span>
              <input className="input" value={value.party.name} onChange={(e) => set("party", { ...value.party, name: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" value={value.party.email} onChange={(e) => set("party", { ...value.party, email: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">Their VAT number</span>
              <input className="input" value={value.party.vatNumber} onChange={(e) => set("party", { ...value.party, vatNumber: e.target.value })} />
            </label>
            {doc.kind !== "proposal" && (
              <label className="field">
                <span className="field-label">Due</span>
                <input className="input" type="date" value={value.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
              </label>
            )}
          </div>
          <label className="field">
            <span className="field-label">Address</span>
            <textarea className="textarea" rows={2} value={value.party.address} onChange={(e) => set("party", { ...value.party, address: e.target.value })} />
          </label>

          <div className="stack" style={{ gap: "0.4rem" }}>
            <span className="field-label">Lines</span>
            {value.lines.map((l, i) => (
              <div key={l.id} className="biz-line" data-markup={doc.kind === "invoice" ? "" : undefined}>
                <input className="input" placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Description" />
                <input className="input" type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} aria-label="Quantity" />
                <input className="input" type="number" min={0} step="any" value={l.unitCents / 100} onChange={(e) => setLine(i, { unitCents: Math.round(Number(e.target.value) * 100) })} aria-label="Price each (R)" />
                {doc.kind === "invoice" && <input className="input" type="number" min={0} step="any" value={l.markupPct} onChange={(e) => setLine(i, { markupPct: Number(e.target.value) })} aria-label="Markup %" title="Markup %" />}
                <span className="small biz-amount">{money(lineCents(l), doc.currency)}</span>
                <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => set("lines", value.lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="row-between">
              <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}><Plus size={14} /> Add a line</button>
              <span className="small">
                {doc.vatRate ? `${money(sums.subtotalCents, doc.currency)} + VAT ${money(sums.vatCents, doc.currency)} = ` : ""}
                <strong>{money(sums.totalCents, doc.currency)}</strong>
              </span>
            </div>
          </div>
          <label className="field">
            <span className="field-label">{doc.kind === "proposal" ? "Scope and notes" : "Notes"}</span>
            <textarea className="textarea" rows={4} value={value.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
          {doc.kind === "proposal" && (
            <label className="field">
              <span className="field-label">Terms</span>
              <textarea className="textarea" rows={6} value={value.terms} onChange={(e) => set("terms", e.target.value)} />
            </label>
          )}
        </section>
      )}

      <DocSheet doc={preview} studio={studioOf(settings)} />
    </main>
  );
}
