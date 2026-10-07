"use client";
import { useEffect, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { SettingsTabs } from "@/components/views/SettingsTabs";
import { shareRequest, displayDate } from "@/components/sharing/client";
import type { WorkspaceRole } from "@/lib/auth/permissions";
const keys = ["ai", "floor_plan", "layout", "sharing", "design"] as const;
const names = {
  ai: "AI assistant",
  floor_plan: "Floor plan",
  layout: "Layout options",
  sharing: "Client links",
  design: "Boards and item records",
};
interface Summary {
  workspace: {
    id: string;
    name: string;
    settings: { branding?: { name?: string; logoUrl?: string } };
  };
  users: {
    id: string;
    email: string | null;
    name: string | null;
    role: WorkspaceRole;
    platform_role: string;
    active: boolean;
  }[];
  projects: { id: string; slug: string; name: string }[];
  access: { user_id: string; project_id: string }[];
  flags: { user_id: string; feature_key: string; enabled: boolean }[];
  invitations: {
    id: string;
    email: string;
    role: string;
    expires_at: string;
    revoked_at: string | null;
    accepted_at: string | null;
  }[];
  changes: { action: string; subject: string; created_at: string }[];
}
export function WorkspaceSettings() {
  const { viewer } = useStudio();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [logo, setLogo] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [link, setLink] = useState("");
  const [newName, setNewName] = useState("");
  const [owner, setOwner] = useState("");
  const endpoint = viewer.isAdmin ? "/api/admin/workspace" : "/api/workspace";
  useEffect(() => {
    let live = true;
    shareRequest<Summary>(endpoint).then(
      (d) => {
        if (!live) return;
        setData(d);
        setName(d.workspace.name);
        setBrand(d.workspace.settings.branding?.name ?? "");
        setLogo(d.workspace.settings.branding?.logoUrl ?? "");
      },
      (e) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [endpoint]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setData(await shareRequest<Summary>(endpoint));
  }
  async function update(userId: string, patch: Record<string, unknown>) {
    await run(async () => {
      await shareRequest(
        `/api/admin/workspace/members/${encodeURIComponent(userId)}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      await refresh();
      setNotice("Member updated.");
    });
  }
  return (
    <main className="page">
      <header style={{ marginBottom: "2rem" }}>
        <p className="eyebrow">Your studio</p>
        <h1 className="display-l">Workspace</h1>
      </header>
      {viewer.isAdmin && <SettingsTabs />}
      {error && (
        <p
          className="small"
          role="alert"
          style={{ color: "var(--bad)", marginBottom: "1rem" }}
        >
          {error}
        </p>
      )}
      <p
        role="status"
        className="small"
        style={{ color: "var(--accent)", marginBottom: "1rem" }}
      >
        {notice}
      </p>
      {!data && !error && <p role="status">Loading workspace…</p>}
      {data && (
        <div className="stack" style={{ gap: "2rem" }}>
          <section className="card" style={{ padding: "1.5rem" }}>
            <h2>Practice details</h2>
            <p className="small muted" style={{ margin: ".5rem 0 1rem" }}>
              Client pages are neutral by default. Add your own practice name or
              an HTTPS image URL for your logo.
            </p>
            <form
              className="stack"
              style={{ gap: "1rem" }}
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await shareRequest("/api/workspace", {
                    method: "PATCH",
                    body: JSON.stringify({
                      name,
                      branding: { name: brand, logoUrl: logo },
                    }),
                  });
                  setNotice(
                    "Practice details saved. Frozen links keep the branding they were created with.",
                  );
                });
              }}
            >
              <label className="field">
                <span className="field-label">Workspace name</span>
                <input
                  className="input"
                  value={name}
                  maxLength={255}
                  required
                  disabled={busy || viewer.workspaceRole !== "owner"}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  Practice name on client pages (optional)
                </span>
                <input
                  className="input"
                  value={brand}
                  maxLength={255}
                  disabled={busy || viewer.workspaceRole !== "owner"}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">Logo image URL (optional)</span>
                <input
                  className="input"
                  type="url"
                  value={logo}
                  disabled={busy || viewer.workspaceRole !== "owner"}
                  onChange={(e) => setLogo(e.target.value)}
                  placeholder="https://…"
                />
              </label>
              {viewer.workspaceRole === "owner" && (
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={busy}
                >
                  Save practice details
                </button>
              )}
            </form>
          </section>
          {viewer.isAdmin && (
            <>
              <section className="card" style={{ padding: "1.5rem" }}>
                <h2>Members and permissions</h2>
                <p className="small muted" style={{ margin: ".5rem 0 1rem" }}>
                  Owners and members can work across this workspace.
                  Collaborators can work only on assigned projects and cannot
                  share documents, use AI or create projects. Feature switches
                  are checked on the server.
                </p>
                <div className="stack" style={{ gap: "1.5rem" }}>
                  {data.users.map((u) => (
                    <article
                      key={u.id}
                      style={{
                        borderTop: "1px solid var(--line)",
                        paddingTop: "1rem",
                      }}
                    >
                      <div className="row-between wrap">
                        <div>
                          <strong>{u.name || u.email || "Member"}</strong>
                          <p className="tiny muted">
                            {u.email} · {u.active ? "Active" : "Deactivated"}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy || u.id === viewer.userId}
                          onClick={() =>
                            void update(u.id, { active: !u.active })
                          }
                        >
                          {u.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                      <div className="row wrap" style={{ margin: "1rem 0" }}>
                        <label className="field">
                          <span className="tiny muted">Workspace role</span>
                          <select
                            className="input"
                            value={u.role}
                            disabled={busy}
                            onChange={(e) =>
                              void update(u.id, { role: e.target.value })
                            }
                          >
                            <option value="owner">Owner</option>
                            <option value="member">Member</option>
                            <option value="collaborator">Collaborator</option>
                          </select>
                        </label>
                        <label className="field">
                          <span className="tiny muted">Platform role</span>
                          <select
                            className="input"
                            value={u.platform_role}
                            disabled={busy}
                            onChange={(e) =>
                              void update(u.id, {
                                platformRole: e.target.value,
                              })
                            }
                          >
                            <option value="user">User</option>
                            <option value="admin">Admin</option>
                          </select>
                        </label>
                      </div>
                      {u.role === "collaborator" && (
                        <fieldset
                          style={{ border: 0, padding: 0, margin: "1rem 0" }}
                        >
                          <legend className="tiny muted">
                            Assigned projects
                          </legend>
                          {data.projects.map((p) => {
                            const checked = data.access.some(
                              (a) =>
                                a.user_id === u.id && a.project_id === p.id,
                            );
                            return (
                              <label
                                key={p.id}
                                className="row small"
                                style={{ margin: ".5rem 0" }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={busy}
                                  onChange={(e) => {
                                    const ids = data.access
                                      .filter((a) => a.user_id === u.id)
                                      .map((a) => a.project_id);
                                    void update(u.id, {
                                      projectIds: e.target.checked
                                        ? [...ids, p.id]
                                        : ids.filter((id) => id !== p.id),
                                    });
                                  }}
                                />
                                {p.name}
                              </label>
                            );
                          })}
                        </fieldset>
                      )}
                      <fieldset style={{ border: 0, padding: 0 }}>
                        <legend className="tiny muted">Enabled features</legend>
                        <div
                          className="row wrap"
                          style={{ marginTop: ".5rem" }}
                        >
                          {keys.map((key) => (
                            <label key={key} className="row small">
                              <input
                                type="checkbox"
                                disabled={busy}
                                checked={
                                  data.flags.find(
                                    (f) =>
                                      f.user_id === u.id &&
                                      f.feature_key === key,
                                  )?.enabled ?? true
                                }
                                onChange={(e) =>
                                  void run(async () => {
                                    await shareRequest(endpoint, {
                                      method: "POST",
                                      body: JSON.stringify({
                                        action: "feature",
                                        userId: u.id,
                                        key,
                                        enabled: e.target.checked,
                                      }),
                                    });
                                    await refresh();
                                    setNotice(
                                      "Feature updated. The member sees it after refreshing.",
                                    );
                                  })
                                }
                              />
                              {names[key]}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </article>
                  ))}
                </div>
              </section>
              <section className="card" style={{ padding: "1.5rem" }}>
                <h2>Invite a teammate</h2>
                <form
                  className="stack"
                  style={{ gap: "1rem", marginTop: "1rem" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await shareRequest<{ path: string }>(
                        endpoint,
                        {
                          method: "POST",
                          body: JSON.stringify({
                            action: "invite",
                            email,
                            role,
                            projectIds,
                          }),
                        },
                      );
                      setLink(`${window.location.origin}${result.path}`);
                      setEmail("");
                      await refresh();
                    });
                  }}
                >
                  <label className="field">
                    <span className="field-label">Email address</span>
                    <input
                      className="input"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Role</span>
                    <select
                      className="input"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      disabled={busy}
                    >
                      <option value="member">Member</option>
                      <option value="collaborator">Collaborator</option>
                      <option value="owner">Owner</option>
                    </select>
                  </label>
                  {role === "collaborator" && (
                    <fieldset style={{ border: 0, padding: 0 }}>
                      <legend className="field-label">
                        Projects they may access
                      </legend>
                      {data.projects.map((p) => (
                        <label key={p.id} className="row small">
                          <input
                            type="checkbox"
                            checked={projectIds.includes(p.id)}
                            onChange={(e) =>
                              setProjectIds((ids) =>
                                e.target.checked
                                  ? [...ids, p.id]
                                  : ids.filter((id) => id !== p.id),
                              )
                            }
                          />
                          {p.name}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy}
                  >
                    Create invitation link
                  </button>
                </form>
                <p className="small muted" style={{ marginTop: "1rem" }}>
                  Copy and send the link yourself. It can be accepted once, by
                  the invited verified email, within seven days.
                </p>
                {link && (
                  <label className="field" style={{ marginTop: "1rem" }}>
                    <span className="field-label">
                      New invitation link · select to copy
                    </span>
                    <input
                      className="input"
                      value={link}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
                <div
                  className="stack"
                  style={{ marginTop: "1rem", gap: ".75rem" }}
                >
                  {data.invitations.map((i) => (
                    <div key={i.id} className="row-between wrap small">
                      <span>
                        {i.email} · {i.role} ·{" "}
                        {i.accepted_at
                          ? "Accepted"
                          : i.revoked_at
                            ? "Revoked"
                            : new Date(i.expires_at) < new Date()
                              ? "Expired"
                              : `expires ${displayDate(i.expires_at)}`}
                      </span>
                      {!i.accepted_at && !i.revoked_at && (
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await shareRequest(endpoint, {
                                method: "POST",
                                body: JSON.stringify({
                                  action: "revokeInvite",
                                  id: i.id,
                                }),
                              });
                              await refresh();
                            })
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
              <section className="card" style={{ padding: "1.5rem" }}>
                <h2>Create another workspace</h2>
                <form
                  className="stack"
                  style={{ gap: "1rem", marginTop: "1rem" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const result = await shareRequest<{ path: string }>(
                        "/api/admin/workspaces",
                        {
                          method: "POST",
                          body: JSON.stringify({
                            name: newName,
                            ownerEmail: owner,
                          }),
                        },
                      );
                      setLink(`${window.location.origin}${result.path}`);
                      setNewName("");
                      setOwner("");
                      setNotice(
                        "Workspace created. Send the owner invitation shown above, then refresh to switch into the new workspace.",
                      );
                    });
                  }}
                >
                  <label className="field">
                    <span className="field-label">Workspace name</span>
                    <input
                      className="input"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Owner email</span>
                    <input
                      className="input"
                      type="email"
                      required
                      value={owner}
                      onChange={(e) => setOwner(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <button
                    className="btn btn-secondary"
                    type="submit"
                    disabled={busy}
                  >
                    Create workspace and owner invitation
                  </button>
                </form>
              </section>
              <section className="card" style={{ padding: "1.5rem" }}>
                <h2>Recent access changes</h2>
                <div
                  className="stack"
                  style={{ marginTop: "1rem", gap: ".5rem" }}
                >
                  {data.changes.map((c, i) => (
                    <p key={i} className="tiny muted">
                      {displayDate(c.created_at)} · {c.action} · {c.subject}
                    </p>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </main>
  );
}
