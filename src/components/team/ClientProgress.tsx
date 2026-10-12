import { Check, Download, FileText } from "lucide-react";
import type { ClientPage } from "@/lib/team/client-view";
import "./team.css";

const day = (d: string | null) =>
  d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * The client's progress page: a progress bar, the phases as a conveyor with
 * their dates, and the steps the studio chose to show. The owner's preview and
 * the client's own page draw it the same way.
 */
export function ClientProgress({
  page,
  logoUrl,
  fileHref,
}: {
  page: ClientPage;
  logoUrl?: string;
  /** Where a document downloads from; absent in the owner's preview. */
  fileHref?: (documentId: string) => string;
}) {
  const statusLine =
    page.status === "complete"
      ? "Complete"
      : page.status === "on_hold"
        ? "On hold"
        : page.waitingOnClient
          ? "Waiting on you"
          : page.currentPhase
            ? `Now: ${page.currentPhase}`
            : "In progress";
  return (
    <div className="client-progress">
      <header className="client-progress-head">
        <p className="client-studio">
          {/* A studio's own HTTPS logo, shown as given; it isn't one of the app's own images. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? <img src={logoUrl} alt="" height={28} /> : null}
          {page.studio}
        </p>
        <h1>{page.projectName}</h1>
        <p className="client-sub">For {page.client}</p>
        {page.note && <p className="client-note">{page.note}</p>}
      </header>

      <section className="client-card" aria-label="Progress">
        <div className="client-row">
          <strong>{page.progress}% done</strong>
          <span className={`client-status${page.waitingOnClient ? " waiting" : ""}`}>{statusLine}</span>
        </div>
        <div className="client-bar" role="progressbar" aria-valuenow={page.progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${page.progress}%` }} />
        </div>
        <ol className="client-conveyor">
          {page.phases.map((p) => (
            <li key={p.key} data-state={p.state}>
              <span className="client-dot">{p.state === "complete" ? <Check size={12} strokeWidth={3} /> : null}</span>
              <span className="client-phase-name">{p.name}</span>
              {p.start && (
                <span className="client-dates">
                  {day(p.start)} to {day(p.end)}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>

      {page.phases
        .filter((p) => p.steps.length)
        .map((p) => (
          <section key={p.key} className="client-card" aria-label={p.name}>
            <div className="client-row">
              <h2>{p.name}</h2>
              <span className="client-count">
                {p.steps.filter((s) => s.done).length} of {p.steps.length}
              </span>
            </div>
            <ul className="client-steps">
              {p.steps.map((s) => (
                <li key={s.id} data-done={s.done}>
                  <span className="client-tick">{s.done ? <Check size={12} strokeWidth={3} /> : null}</span>
                  <span className="client-step-text">{s.text}</span>
                  {s.due && !s.done && <span className="client-due">{day(s.due)}</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}

      {page.documents.length > 0 && (
        <section className="client-card" aria-label="Documents">
          <h2>Documents for you</h2>
          <ul className="client-docs">
            {page.documents.map((d) => (
              <li key={d.id}>
                <FileText size={16} aria-hidden />
                <span className="client-step-text">{d.name}</span>
                {fileHref && d.downloadable ? (
                  <a href={fileHref(d.id)} className="client-download">
                    <Download size={14} /> Download
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="client-foot">This page is private to you. It updates as the studio works.</p>
    </div>
  );
}
