"use client";

import React, { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { BusinessDoc } from "@/lib/business/model";
import { DocSheet, type SheetStudio } from "./DocSheet";
import "./business.css";

/**
 * What a client or supplier sees when they open a proposal, invoice or order:
 * the document, a Print / Save as PDF button, and for a proposal, accepting it
 * by typing their name (or declining).
 */
export function PublicDocPage({ token }: { token: string }) {
  const [data, setData] = useState<{ doc: BusinessDoc; studio: SheetStudio } | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = () =>
    fetch(`/api/public/doc/${token}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "This link no longer works");
        setData(body);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per link
  }, [token]);

  const respond = async (accept: boolean) => {
    setBusy(true);
    setNote("");
    const res = await fetch(`/api/public/doc/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accept, name }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setNote(body.error || "That didn't go through. Try again.");
    setNote(accept ? "Thank you. The proposal is accepted and the studio has been told." : "Thank you for letting the studio know.");
    load();
  };

  if (error) return <main className="public-doc"><p className="card" style={{ padding: "1.5rem" }}>{error}</p></main>;
  if (!data) return <main className="public-doc"><p className="muted small">Loading…</p></main>;
  const { doc, studio } = data;
  return (
    <main className="public-doc">
      <div className="public-doc-bar no-print">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}>
          <Printer size={14} /> Print or save as PDF
        </button>
      </div>
      <DocSheet doc={doc} studio={studio} />
      {doc.kind === "proposal" && doc.status === "sent" && (
        <section className="card public-doc-accept no-print">
          <h2 className="display-s">Accept this proposal</h2>
          <p className="small muted">Typing your name below and pressing Accept is your electronic signature: you agree to the scope, fees and terms above.</p>
          <input className="input" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          <label className="row small" style={{ gap: "0.5rem", alignItems: "flex-start" }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
            I have read the proposal and its terms and I am authorised to accept them.
          </label>
          <div className="row wrap" style={{ gap: "0.5rem", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => respond(false)}>Decline</button>
            <button type="button" className="btn btn-primary" disabled={busy || !agree || name.trim().length < 2} onClick={() => respond(true)}>
              {busy ? "Saving…" : "Accept"}
            </button>
          </div>
        </section>
      )}
      {note && <p className="small no-print" role="status">{note}</p>}
    </main>
  );
}
