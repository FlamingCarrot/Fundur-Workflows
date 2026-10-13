"use client";

import React from "react";
import Link from "next/link";
import { Bot, Check, CheckCircle2, Copy, ExternalLink, FileUp, HelpCircle, Inbox as InboxIcon, ListChecks, Mail, Receipt, Undo2, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, WhenReady } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/studio/format";
import { uploadToProject } from "@/lib/studio/uploads";
import type { InboxChange, InboxProject } from "@/lib/autopilot/inbox";
import type { AskView } from "@/lib/autopilot/store";
import type { SwatchKey } from "@/lib/studio/types";
import { answer, resolveChange, useInbox } from "./useAutopilot";
import { useLeads } from "@/components/business/useBusiness";
import { isString, useViewSetting } from "@/lib/view-settings/client";
import "./autopilot.css";

type Filter = "all" | "asks" | "review" | "done";

/**
 * Everything the AI needs from her, across projects, built for the phone:
 * the autopilot's questions (answered right here, with a tap where it can be),
 * changes waiting for her, and what it did lately with Undo.
 */
export function InboxView() {
  const { ready, persistence, viewer } = useStudio();
  const { data, error, mutate, isLoading } = useInbox();
  const [storedFilter, setFilter] = useViewSetting<string>("inbox.filter", "all", isString);
  const filter: Filter = (["all", "asks", "review", "done"] as const).find((f) => f === storedFilter) ?? "all";
  const { data: leadData } = useLeads();
  const newLeads = (leadData?.leads ?? []).filter((l) => l.status === "new");
  const off = persistence !== "server" || viewer.features?.ai === false || viewer.workspaceRole === "collaborator";
  const projects = new Map((data?.projects ?? []).map((p) => [p.id, p]));
  const asks = data?.asks ?? [];
  const review = data?.review ?? [];
  const done = data?.done ?? [];
  const needs = asks.length + review.length + newLeads.length;
  const piloted = (data?.projects ?? []).filter((p) => p.autopilot.enabled);
  const show = (f: Filter) => filter === "all" || filter === f;

  return (
    <main className="page page-narrow inbox">
      <WhenReady ready={ready}>
        <header className="rise" style={{ marginBottom: "1.5rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.6rem" }}>Inbox</p>
          <h1 className="display-l">{off ? "The inbox needs a saved workspace." : needs ? `${needs} thing${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} you.` : "Nothing needs you."}</h1>
          <p className="muted small" style={{ marginTop: "0.5rem", maxWidth: "56ch" }}>
            {off
              ? "The autopilot and its questions work once projects are saved on the server. In this demo everything stays in your browser."
              : "What the autopilot needs from you, changes waiting for your OK, and what it did lately. Answer here and it carries on."}
          </p>
        </header>

        {!off && (
          <>
            <div className="inbox-pilots rise" style={{ ["--i" as string]: 1 }}>
              {piloted.length ? (
                piloted.map((p) => <PilotChip key={p.id} project={p} />)
              ) : (
                <span className="tiny muted">
                  <Bot size={13} style={{ verticalAlign: "-2px" }} /> No project has the autopilot on yet. Open a project and turn it on under Autopilot.
                </span>
              )}
            </div>

            <div className="segmented segmented-sm rise inbox-filter" role="group" aria-label="Show" style={{ ["--i" as string]: 2 }}>
              {(
                [
                  ["all", "All"],
                  ["asks", `Questions${asks.length + newLeads.length ? ` ${asks.length + newLeads.length}` : ""}`],
                  ["review", `To review${review.length ? ` ${review.length}` : ""}`],
                  ["done", "Done"],
                ] as [Filter, string][]
              ).map(([key, name]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                  {name}
                </button>
              ))}
            </div>

            {error && <p className="small" style={{ color: "var(--bad)" }}>{error.message}</p>}
            {isLoading && !data && <p className="small muted">Loading…</p>}

            <div className="stack inbox-list" style={{ gap: "0.75rem" }}>
              {show("asks") && newLeads.length > 0 && (
                <Link href="/business?tab=leads" className="card inbox-card" style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
                  <Mail size={18} />
                  <span className="stack grow" style={{ minWidth: 0 }}>
                    <span className="small strong">{newLeads.length === 1 ? `New enquiry from ${newLeads[0].name}` : `${newLeads.length} new enquiries`}</span>
                    <span className="tiny muted truncate">{newLeads[0].message}</span>
                  </span>
                  <ExternalLink size={14} />
                </Link>
              )}
              {show("asks") && asks.map((a) => <AskCard key={a.id} ask={a} project={projects.get(a.projectId)} onDone={() => mutate()} />)}
              {show("review") && review.map((c) => <ChangeCard key={c.id} change={c} project={projects.get(c.projectId)} onDone={() => mutate()} />)}
              {show("done") && done.length > 0 && (
                <>
                  <h2 className="eyebrow" style={{ marginTop: "1rem" }}>Done by the autopilot lately</h2>
                  {done.map((c) => <ChangeCard key={c.id} change={c} project={projects.get(c.projectId)} onDone={() => mutate()} />)}
                </>
              )}
              {data && !needs && (filter === "asks" || filter === "review" || (filter === "all" && !done.length)) && (
                <div className="card inbox-empty">
                  <CheckCircle2 size={22} />
                  <span className="small">You&apos;re all caught up.</span>
                </div>
              )}
            </div>
          </>
        )}
      </WhenReady>
    </main>
  );
}

function PilotChip({ project }: { project: InboxProject }) {
  const a = project.autopilot;
  const state = a.running ? "Working now" : a.paused ? "Paused" : a.nextRunAt ? `Next look ${relativeTime(a.nextRunAt).replace(/ ago$/, "")}` : "On";
  return (
    <Link href={`/projects/${project.slug}/autopilot`} className="chip inbox-pilot" title={a.nextReason ?? undefined}>
      <Swatch swatch={project.swatch as SwatchKey} />
      <span className="truncate">{project.name}</span>
      <span className="tiny muted" data-running={a.running || undefined}>{state}</span>
    </Link>
  );
}

const KIND_ICON = { question: HelpCircle, choice: ListChecks, file: FileUp, approval: Check, message: Mail, document: Receipt } as const;

function Where({ project, when, autopilot = true }: { project?: InboxProject; when: string; autopilot?: boolean }) {
  return (
    <span className="row tiny muted" style={{ gap: "0.4rem", minWidth: 0 }}>
      {project && <Swatch swatch={project.swatch as SwatchKey} />}
      {project ? (
        <Link href={`/projects/${project.slug}`} className="truncate strong" style={{ color: "var(--ink-2)" }}>
          {project.name}
        </Link>
      ) : null}
      <span>· {autopilot ? "Autopilot" : "Assistant"} · {relativeTime(when)}</span>
    </span>
  );
}

export function AskCard({ ask, project, onDone }: { ask: AskView; project?: InboxProject; onDone: () => void }) {
  const { toast } = useStudio();
  const [text, setText] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const Icon = KIND_ICON[ask.kind] ?? HelpCircle;

  const send = async (action: "answer" | "dismiss", value?: string) => {
    setBusy(action + (value ?? ""));
    try {
      const uploaded = [];
      if (action === "answer" && files.length && project) {
        for (const f of files) uploaded.push({ storageKey: await uploadToProject(project.slug, f), name: f.name });
      }
      const res = await answer(ask.id, { action, answer: value ?? text, files: uploaded });
      toast(action === "dismiss" ? "Put aside" : res.carryOn ? "Thanks. The autopilot is carrying on." : "Saved");
      onDone();
    } catch (err) {
      toast((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <article className="card inbox-card" data-urgent={ask.urgent || undefined}>
      <Where project={project} when={ask.createdAt} />
      <div className="row" style={{ gap: "0.55rem", alignItems: "flex-start" }}>
        <span className="inbox-icon"><Icon size={16} /></span>
        <div className="stack grow" style={{ gap: "0.25rem", minWidth: 0 }}>
          <h3 className="inbox-title">{ask.title}</h3>
          {ask.detail && <p className="small muted">{ask.detail}</p>}
        </div>
      </div>

      {ask.kind === "message" && ask.draft && (
        <>
          <pre className="inbox-draft">{ask.draft}</pre>
          <div className="inbox-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => send("dismiss")}>Not this one</button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard?.writeText(ask.draft ?? "").then(() => toast("Copied"), () => toast("Couldn't copy"))}
            >
              <Copy size={14} /> Copy
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => send("answer", "Sent to the client")}>
              <Check size={14} /> I sent it
            </button>
          </div>
        </>
      )}

      {ask.kind === "document" && (
        <div className="inbox-actions">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => send("dismiss")}>Not now</button>
          {ask.link && (
            <Link href={ask.link} className="btn btn-secondary btn-sm">
              <ExternalLink size={14} /> Open
            </Link>
          )}
          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => send("answer", "Checked and sent")}>
            <Check size={14} /> Done
          </button>
        </div>
      )}

      {(ask.kind === "choice" || ask.kind === "approval") && (
        <div className="inbox-options">
          {ask.options.map((o) => (
            <button key={o} type="button" className="btn btn-secondary" disabled={!!busy} onClick={() => send("answer", text.trim() ? `${o}. ${text.trim()}` : o)}>
              {busy === "answer" + o ? "Saving…" : o}
            </button>
          ))}
        </div>
      )}

      {ask.kind !== "message" && ask.kind !== "document" && (
        <>
          <textarea
            className="textarea"
            rows={ask.kind === "question" ? 3 : 2}
            placeholder={ask.kind === "question" ? "Your answer" : ask.kind === "file" ? "A note with the file (optional)" : "Add a note (optional)"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {ask.kind === "file" && (
            <label className="btn btn-secondary btn-sm inbox-file">
              <FileUp size={14} /> {files.length ? files.map((f) => f.name).join(", ") : "Choose files"}
              <input type="file" multiple hidden onChange={(e) => setFiles([...(e.target.files ?? [])])} />
            </label>
          )}
          <div className="inbox-actions">
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => send("dismiss")}>
              <X size={14} /> Not now
            </button>
            {(ask.kind === "question" || ask.kind === "file") && (
              <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || (!text.trim() && !files.length)} onClick={() => send("answer")}>
                {busy === "answer" ? "Sending…" : "Send"}
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

export function ChangeCard({ change, project, onDone }: { change: InboxChange; project?: InboxProject; onDone: () => void }) {
  const { toast, receiveProject } = useStudio();
  const [busy, setBusy] = React.useState<string | null>(null);
  const act = async (action: "apply" | "dismiss" | "undo") => {
    if (!project) return;
    setBusy(action);
    try {
      const res = await resolveChange(project.slug, change.id, action);
      if (res.project) receiveProject(res.project);
      toast(action === "apply" ? "Done" : action === "undo" ? "Undone" : "Dismissed");
      onDone();
    } catch (err) {
      toast((err as Error).message);
      setBusy(null);
    }
  };
  return (
    <article className="card inbox-card" data-done={change.status === "applied" || undefined}>
      <Where project={project} when={change.createdAt} autopilot={change.autopilot} />
      <p className="inbox-title">{change.summary}</p>
      <div className="inbox-actions">
        {change.status === "pending" ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => act("dismiss")}>Dismiss</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => act("apply")}>
              {busy === "apply" ? "Saving…" : "Confirm"}
            </button>
          </>
        ) : change.undoable ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => act("undo")}>
            <Undo2 size={13} /> {busy === "undo" ? "Undoing…" : "Undo"}
          </button>
        ) : (
          <span className="tiny muted">Done</span>
        )}
      </div>
    </article>
  );
}

export function InboxBadgeIcon({ size = 17 }: { size?: number }) {
  return <InboxIcon size={size} />;
}
