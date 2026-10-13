"use client";

import React, { useEffect, useState } from "react";
import "./business.css";

/** The studio's enquiry form: someone who wants to work with them leaves their details and what they need. */
export function EnquiryPage({ token }: { token: string }) {
  const [studio, setStudio] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", budget: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/public/enquire/${token}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "This form is no longer open");
        setStudio(body.studioName);
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch(`/api/public/enquire/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error || "That didn't go through. Try again.");
    setSent(true);
  };
  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: e.target.value }) });

  return (
    <main className="book-page">
      <div className="card book-card">
        {sent ? (
          <>
            <h1 className="display-m">Thank you.</h1>
            <p className="muted">{studio} has your message and will be in touch.</p>
          </>
        ) : studio == null ? (
          <p className="muted">{error || "Loading…"}</p>
        ) : (
          <form className="biz-form" onSubmit={submit}>
            <p className="eyebrow">{studio}</p>
            <h1 className="display-m">Tell us about your project.</h1>
            <div className="biz-form-grid">
              <label className="field"><span className="field-label">Your name</span><input className="input" required autoComplete="name" {...field("name")} /></label>
              <label className="field"><span className="field-label">Email</span><input className="input" type="email" required autoComplete="email" {...field("email")} /></label>
              <label className="field"><span className="field-label">Phone (optional)</span><input className="input" autoComplete="tel" {...field("phone")} /></label>
              <label className="field"><span className="field-label">Company (optional)</span><input className="input" autoComplete="organization" {...field("company")} /></label>
            </div>
            <label className="field"><span className="field-label">Rough budget (optional)</span><input className="input" placeholder="e.g. R500 000" {...field("budget")} /></label>
            <label className="field"><span className="field-label">What do you need?</span><textarea className="textarea" rows={5} required placeholder="The space, its size, what you'd like changed, and when" {...field("message")} /></label>
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: "-10000px" }} {...field("website")} />
            <p className="tiny muted">Your details go only to {studio}, to reply to you about your project.</p>
            {error && <p className="small" style={{ color: "var(--bad)" }}>{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
          </form>
        )}
      </div>
    </main>
  );
}
