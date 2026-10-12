"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Copy, Eye, Mail, Send } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { ProjectWorkPage } from "@/components/projects/ProjectWorkPage";
import { MissingProject } from "@/components/views/MissingProject";
import { usePlan } from "@/components/billing/usePlan";
import { getWorkflow } from "@/lib/workflow";
import { relativeTime } from "@/lib/studio/format";
import { canUseTool } from "@/lib/team/access";
import { changeClientInvite, inviteClient, loadClientInvites } from "@/lib/team/client";
import { clientPage, defaultClientSettings, type ClientInvite, type ClientViewSettings } from "@/lib/team/client-view";
import type { Project } from "@/lib/studio/types";
import { ClientProgress } from "./ClientProgress";
import "./team.css";

export function ClientViewManagerView({ projectId }: { projectId: string }) {
  const { ready, getProject, viewer } = useStudio();
  const project = getProject(projectId);
  const practice = !viewer.workspaceRole || ["owner", "member"].includes(viewer.workspaceRole);
  return (
    <WhenReady ready={ready}>
      {project && practice && canUseTool(project.myAccess, "client") ? <ClientViewManager project={project} /> : <MissingProject />}
    </WhenReady>
  );
}

/**
 * The owner's side of the client's progress page: choose the phases and steps
 * the client sees, preview it exactly as they will, and invite their email.
 */
function ClientViewManager({ project }: { project: Project }) {
  const { persistence, viewer } = useStudio();
  const server = persistence === "server";
  const plan = usePlan();
  const allowed = plan.feature("client_portal");
  const [settings, setSettings] = useState<ClientViewSettings>(() => defaultClientSettings(project));
  const [invites, setInvites] = useState<ClientInvite[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState("");
  const page = useMemo(() => clientPage(project, settings, viewer.workspace || "Your studio"), [project, settings, viewer.workspace]);

  const refresh = useCallback(async () => {
    if (!server) return;
    try {
      setInvites(await loadClientInvites(project.id));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Could not load invites.");
    }
  }, [server, project.id]);
  useEffect(() => {
    if (!server) return;
    let live = true;
    loadClientInvites(project.id)
      .then((list) => live && setInvites(list))
      .catch((e) => live && setProblem(e instanceof Error ? e.message : "Could not load invites."));
    return () => {
      live = false;
    };
  }, [server, project.id]);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    setSaved("");
    try {
      await work();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That didn't work. Please retry.");
    } finally {
      setBusy(false);
    }
  };
  const phases = getWorkflow(project).phases;
  const editingInvite = invites?.find((i) => i.id === editing);

  return (
    <ProjectWorkPage
      project={project}
      title="Client view"
      description="A private progress page for your client: how far along the project is, its timeline and the steps you choose. Only the email address you invite can open it."
    >
      <div className="split" style={{ display: "grid", gap: "2rem", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <div className="stack" style={{ gap: "1.5rem" }}>
          <section className="access-card">
            <div className="row-between wrap">
              <h2 className="strong">{editingInvite ? `What ${editingInvite.email} sees` : "What the client sees"}</h2>
              {editingInvite && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(null); setSettings(defaultClientSettings(project)); }}>
                  Done
                </button>
              )}
            </div>
            <label className="check-line">
              <input type="checkbox" checked={settings.showTimeline} onChange={(e) => setSettings({ ...settings, showTimeline: e.target.checked })} />
              Show dates and the timeline
            </label>
            <label className="check-line">
              <input type="checkbox" checked={settings.showDocuments} onChange={(e) => setSettings({ ...settings, showDocuments: e.target.checked })} />
              List documents marked as client visible
            </label>
            {phases.map((p) => {
              const on = settings.phases.includes(p.key);
              return (
                <div key={p.key} className="access-phase">
                  <label className="check-line strong">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          phases: e.target.checked ? [...settings.phases, p.key] : settings.phases.filter((k) => k !== p.key),
                        })
                      }
                    />
                    {p.name}
                  </label>
                  {on && p.checklist.length > 0 && (
                    <div className="access-steps">
                      {p.checklist.map((i) => (
                        <label key={i.id} className="check-line">
                          <input
                            type="checkbox"
                            checked={!settings.hiddenSteps.includes(i.id)}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                hiddenSteps: e.target.checked ? settings.hiddenSteps.filter((k) => k !== i.id) : [...settings.hiddenSteps, i.id],
                              })
                            }
                          />
                          <span className="small">{i.text}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <label className="stack" style={{ gap: "0.35rem" }}>
              <span className="small strong">A note at the top (optional)</span>
              <textarea className="input" rows={3} maxLength={2000} value={settings.note} onChange={(e) => setSettings({ ...settings, note: e.target.value })} />
            </label>
            {editingInvite && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await changeClientInvite(project.id, editingInvite.id, { settings });
                    await refresh();
                    setSaved("Saved. The client sees the change next time they open the page.");
                  })
                }
              >
                Save for {editingInvite.email}
              </button>
            )}
          </section>

          {!editingInvite && (
            <section className="access-card">
              <h2 className="strong">Invite the client</h2>
              {!server ? (
                <p className="small muted">
                  Invites need sign-in, so they work once Fundur runs with accounts. The preview shows exactly what the client will see.
                </p>
              ) : !allowed ? (
                <p className="small muted">Client progress pages are on the Paid plan.</p>
              ) : (
                <form
                  className="stack"
                  style={{ gap: "0.6rem" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const made = await inviteClient(project.id, email, settings);
                      setLink({ email: made.invite.email, url: made.url });
                      setEmail("");
                      await refresh();
                    });
                  }}
                >
                  <input className="input" type="email" required maxLength={255} value={email} placeholder="client@example.com" aria-label="Client email" onChange={(e) => setEmail(e.target.value)} />
                  <p className="tiny muted">They sign in or sign up with this address to open the page. Anyone else who gets the link is turned away.</p>
                  <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
                    <Send size={15} /> Create invite link
                  </button>
                </form>
              )}
              {link && (
                <div className="stack" style={{ gap: "0.5rem" }}>
                  <p className="small">Send this link to {link.email}. It is shown only once.</p>
                  <input className="input" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
                  <div className="row wrap" style={{ gap: "0.5rem" }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setSaved("Link copied."))}>
                      <Copy size={14} /> Copy
                    </button>
                    <a
                      className="btn btn-secondary btn-sm"
                      href={`mailto:${encodeURIComponent(link.email)}?subject=${encodeURIComponent(`${project.name}: your project page`)}&body=${encodeURIComponent(`You can follow ${project.name} here:\n\n${link.url}\n\nSign in with this email address to open it.`)}`}
                    >
                      <Mail size={14} /> Email it
                    </a>
                  </div>
                </div>
              )}
            </section>
          )}
          {(problem || saved) && (
            <p className="small" role="status" style={{ color: problem ? "var(--bad)" : "var(--good)" }}>
              {problem || saved}
            </p>
          )}

          {server && invites && invites.length > 0 && (
            <section className="stack" style={{ gap: "0.6rem" }}>
              <h2 className="strong">Invited</h2>
              {invites.map((i) => (
                <div key={i.id} className="access-card" style={{ gap: "0.4rem" }}>
                  <div className="row-between wrap">
                    <strong className="small">{i.email}</strong>
                    <span className="tiny muted">
                      {i.revokedAt ? "Access ended" : i.lastOpenedAt ? `Opened ${i.openCount}× · last ${relativeTime(i.lastOpenedAt)}` : "Not opened yet"}
                    </span>
                  </div>
                  {!i.revokedAt && (
                    <div className="row wrap" style={{ gap: "0.5rem" }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(i.id); setSettings(i.settings); setLink(null); }}>
                        <Eye size={14} /> Change what they see
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await changeClientInvite(project.id, i.id, { revoke: true });
                            if (editing === i.id) setEditing(null);
                            await refresh();
                          })
                        }
                      >
                        <Ban size={14} /> End access
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </div>

        <section className="stack" style={{ gap: "0.6rem" }} aria-label="Preview">
          <p className="eyebrow">Preview: what the client sees</p>
          <div className="client-preview-frame">
            <div className="client-page" style={{ padding: "1.5rem 1rem 2rem" }}>
              <ClientProgress page={page} />
            </div>
          </div>
        </section>
      </div>
    </ProjectWorkPage>
  );
}
