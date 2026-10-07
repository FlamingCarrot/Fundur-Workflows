"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, Mail, Search, UserPlus, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { initials } from "@/components/ui/primitives";
import { useStoredChoice } from "@/hooks/useStoredChoice";
import { relativeTime } from "@/lib/studio/format";
import type { AccessSettings, ManagedUser, PendingInvite } from "@/lib/admin/users";
import type { PlatformRole } from "@/lib/auth/permissions";
import { SettingsTabs } from "./SettingsTabs";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

interface Directory {
  users: ManagedUser[];
  invites: PendingInvite[];
  access: AccessSettings;
  me: string;
}

const FILTERS = ["all", "waiting", "active", "disabled"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABEL: Record<Filter, string> = { all: "Everyone", waiting: "Waiting", active: "Active", disabled: "Switched off" };

const inviteLink = (token: string) => `${window.location.origin}/join/${token}`;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

function inviteEmail(invite: PendingInvite, from: string) {
  const subject = "You're invited to Fundur";
  const greeting = invite.name ? `Hi ${invite.name.split(/\s+/)[0]},` : "Hi,";
  const body = `${greeting}\n\nI've set you up on Fundur. Open this link to create your account and get started:\n\n${inviteLink(invite.token)}\n\nThe link works until ${shortDate(invite.expiresAt)}.\n\n${from}`;
  return `mailto:${encodeURIComponent(invite.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * The Admin's user management: invite people, let waiting sign-ups in, change
 * who is Admin, and switch accounts off or back on.
 */
export function UsersView() {
  const { toast } = useStudio();
  const [dir, setDir] = useState<Directory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useStoredChoice<Filter>("fundur.admin.users.filter", "all", FILTERS);
  const [query, setQuery] = useState("");

  const load = useCallback(
    () =>
      call<Directory>("/api/admin/users").then(
        (d) => {
          setDir(d);
          setLoadError(null);
        },
        (err: Error) => setLoadError(err.message)
      ),
    []
  );
  useEffect(() => {
    void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const change = (user: ManagedUser, patch: { role?: PlatformRole; status?: "active" | "disabled" }) =>
    call<{ user: ManagedUser }>(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }).then(
      ({ user: saved }) => setDir((d) => d && { ...d, users: d.users.map((u) => (u.id === saved.id ? saved : u)) }),
      (err: Error) => toast(`That didn't save: ${err.message}`)
    );

  const setInviteOnly = (inviteOnly: boolean) => {
    setDir((d) => d && { ...d, access: { inviteOnly } });
    call<{ access: AccessSettings }>("/api/admin/access", { method: "PUT", body: JSON.stringify({ inviteOnly }) }).then(
      ({ access }) => {
        setDir((d) => d && { ...d, access });
        toast(access.inviteOnly ? "Sign-ups are invite only" : "Anyone can sign up");
      },
      (err: Error) => {
        setDir((d) => d && { ...d, access: { inviteOnly: !inviteOnly } });
        toast(`That didn't save: ${err.message}`);
      }
    );
  };

  const revoke = (invite: PendingInvite) =>
    call(`/api/admin/invites/${invite.id}`, { method: "DELETE" }).then(
      () => setDir((d) => d && { ...d, invites: d.invites.filter((i) => i.id !== invite.id) }),
      (err: Error) => toast(`Couldn't cancel it: ${err.message}`)
    );

  const counts: Record<Filter, number> = {
    all: dir?.users.length ?? 0,
    waiting: dir?.users.filter((u) => u.status === "waiting").length ?? 0,
    active: dir?.users.filter((u) => u.status === "active").length ?? 0,
    disabled: dir?.users.filter((u) => u.status === "disabled").length ?? 0,
  };
  const q = query.trim().toLowerCase();
  const shown =
    dir?.users.filter(
      (u) =>
        (filter === "all" || u.status === filter) &&
        (!q || [u.name, u.email, u.workspace].some((v) => v?.toLowerCase().includes(q)))
    ) ?? [];

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin</p>
        <h1 className="display-l">Users</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Invite people, let waiting sign-ups in, choose who else is Admin, and switch accounts off.
        </p>
      </header>

      {loadError && !dir && (
        <div className="card" style={{ padding: "1.25rem 1.4rem", color: "var(--bad)" }}>{loadError}</div>
      )}

      {dir && (
        <>
          <InviteCard
            onInvited={(invite) => setDir((d) => d && { ...d, invites: [invite, ...d.invites.filter((i) => i.email !== invite.email)] })}
          />

          {dir.invites.length > 0 && (
            <section className="rise" style={{ marginTop: "1.75rem" }}>
              <h2 className="section-title" style={{ marginBottom: "0.75rem" }}>Invites waiting to be used</h2>
              <div className="stack" style={{ gap: "0.6rem" }}>
                {dir.invites.map((invite) => (
                  <InviteRow key={invite.id} invite={invite} onRevoke={() => revoke(invite)} />
                ))}
              </div>
            </section>
          )}

          <section className="card rise" style={{ padding: "1.15rem 1.3rem", marginTop: "1.75rem" }}>
            <div className="row-between wrap" style={{ gap: "0.75rem" }}>
              <div className="stack" style={{ gap: "0.2rem", maxWidth: 460 }}>
                <span className="strong">Who can sign up</span>
                <span className="small muted">
                  {dir.access.inviteOnly
                    ? "Invited people only. Anyone else who signs up waits here until you let them in."
                    : "Anyone with the link can create an account. People already here are not affected either way."}
                </span>
              </div>
              <div className="segmented segmented-sm" role="group" aria-label="Who can sign up">
                <button type="button" aria-pressed={!dir.access.inviteOnly} onClick={() => dir.access.inviteOnly && setInviteOnly(false)}>
                  Anyone
                </button>
                <button type="button" aria-pressed={dir.access.inviteOnly} onClick={() => !dir.access.inviteOnly && setInviteOnly(true)}>
                  Invite only
                </button>
              </div>
            </div>
          </section>

          <section style={{ marginTop: "2rem" }}>
            <div className="row-between wrap" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
              <div className="segmented rise" role="group" aria-label="Show" style={{ flexWrap: "wrap" }}>
                {FILTERS.map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {FILTER_LABEL[f]} {counts[f]}
                  </button>
                ))}
              </div>
              <label className="mb-search" style={{ minWidth: 200, flex: "0 1 260px" }}>
                <Search size={15} />
                <input
                  className="input"
                  placeholder="Find a person"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Find a person"
                />
              </label>
            </div>

            {shown.length === 0 ? (
              <p className="muted">{filter === "waiting" ? "Nobody is waiting." : "Nobody here."}</p>
            ) : (
              <div className="stack" style={{ gap: "0.75rem" }}>
                {shown.map((u) => (
                  <UserCard key={u.id} user={u} isMe={u.id === dir.me} onChange={(patch) => change(u, patch)} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function InviteCard({ onInvited }: { onInvited: (invite: PendingInvite) => void }) {
  const { viewer } = useStudio();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<PlatformRole>("user");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<PendingInvite | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (role === "admin" && !window.confirm(`Make ${email.trim()} an Admin? Admins can see and change everything, including AI keys and other people's accounts.`)) return;
    setBusy(true);
    setError(null);
    call<{ invite: PendingInvite }>("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, role }),
    }).then(
      ({ invite }) => {
        setBusy(false);
        setCreated(invite);
        onInvited(invite);
        setEmail("");
        setName("");
        setRole("user");
      },
      (err: Error) => {
        setBusy(false);
        setError(err.message);
      }
    );
  };

  return (
    <section className="card rise" style={{ padding: "1.3rem 1.4rem" }}>
      <div className="row" style={{ gap: "0.6rem", marginBottom: "1rem" }}>
        <UserPlus size={18} />
        <h2 className="section-title" style={{ margin: 0 }}>Invite someone</h2>
      </div>
      {created ? (
        <div className="stack" style={{ gap: "0.85rem" }}>
          <p className="small">
            Invite ready for <span className="strong">{created.email}</span>. Send them the link. When they sign up or sign in with
            that address they&apos;re in straight away; the link also works if they use a different address.
          </p>
          <InviteActions invite={created} from={viewer.name} />
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreated(null)}>
              Invite someone else
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="stack" style={{ gap: "0.85rem" }}>
          <div className="row wrap" style={{ gap: "0.75rem" }}>
            <input
              className="input"
              type="email"
              required
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ flex: "2 1 220px" }}
              aria-label="Email address"
            />
            <input
              className="input"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ flex: "1 1 160px" }}
              aria-label="Name"
            />
          </div>
          <div className="row-between wrap" style={{ gap: "0.75rem" }}>
            <div className="segmented segmented-sm" role="group" aria-label="Role">
              <button type="button" aria-pressed={role === "user"} onClick={() => setRole("user")}>Basic user</button>
              <button type="button" aria-pressed={role === "admin"} onClick={() => setRole("admin")}>Admin</button>
            </div>
            <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>
              {busy ? "Creating…" : "Create invite"}
            </button>
          </div>
          {error && <p className="small" style={{ color: "var(--bad)" }}>{error}</p>}
        </form>
      )}
    </section>
  );
}

function InviteActions({ invite, from }: { invite: PendingInvite; from: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(inviteLink(invite.token)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  return (
    <div className="row wrap" style={{ gap: "0.5rem" }}>
      <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
        {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy link"}
      </button>
      <a className="btn btn-secondary btn-sm" href={inviteEmail(invite, from)}>
        <Mail size={14} /> Email it
      </a>
    </div>
  );
}

function InviteRow({ invite, onRevoke }: { invite: PendingInvite; onRevoke: () => void }) {
  const { viewer } = useStudio();
  return (
    <div className="card" style={{ padding: "0.85rem 1.1rem" }}>
      <div className="row-between wrap" style={{ gap: "0.75rem" }}>
        <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
          <span className="small strong truncate">
            {invite.name ? `${invite.name} · ` : ""}
            {invite.email}
            {invite.role === "admin" && <span className="tag tag-me" style={{ marginLeft: "0.5rem" }}>Admin</span>}
          </span>
          <span className="tiny muted">
            Invited {relativeTime(invite.createdAt)} · works until {shortDate(invite.expiresAt)}
          </span>
        </div>
        <div className="row" style={{ gap: "0.35rem" }}>
          <InviteActions invite={invite} from={viewer.name} />
          <button type="button" className="icon-btn" aria-label={`Cancel the invite for ${invite.email}`} title="Cancel invite" onClick={onRevoke}>
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function UserCard({
  user,
  isMe,
  onChange,
}: {
  user: ManagedUser;
  isMe: boolean;
  onChange: (patch: { role?: PlatformRole; status?: "active" | "disabled" }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const run = (patch: { role?: PlatformRole; status?: "active" | "disabled" }, question?: string) => {
    if (question && !window.confirm(question)) return;
    setBusy(true);
    void onChange(patch).finally(() => setBusy(false));
  };
  const who = user.name || user.email;

  return (
    <article className="card" style={{ padding: "1rem 1.15rem", opacity: user.status === "disabled" ? 0.7 : 1 }}>
      <div className="row" style={{ gap: "0.85rem", alignItems: "flex-start" }}>
        <span className="avatar">{initials(who)}</span>
        <div className="stack grow" style={{ gap: "0.2rem", minWidth: 0 }}>
          <div className="row wrap" style={{ gap: "0.4rem" }}>
            <span className="strong truncate">{who}</span>
            {isMe && <span className="tag tag-ai">You</span>}
            {user.role === "admin" && <span className="tag tag-me">Admin</span>}
            {user.status === "waiting" && <span className="tag tag-hold">Waiting</span>}
            {user.status === "disabled" && <span className="tag tag-ai">Switched off</span>}
          </div>
          {user.name && <span className="small muted truncate">{user.email}</span>}
          <span className="tiny muted">
            {user.workspace ? `${user.workspace} · ` : ""}
            {user.projects} {user.projects === 1 ? "project" : "projects"}
            {user.openTickets > 0 ? ` · ${user.openTickets} open ${user.openTickets === 1 ? "ticket" : "tickets"}` : ""}
            {" · "}joined {shortDate(user.joinedAt)}
            {user.lastSeenAt ? ` · last active ${relativeTime(user.lastSeenAt)}` : ""}
          </span>
        </div>
      </div>
      {!isMe && (
        <div className="row wrap" style={{ gap: "0.4rem", justifyContent: "flex-end", marginTop: "0.75rem" }}>
          {user.status === "waiting" && (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run({ status: "active" })}>
              Let in
            </button>
          )}
          {user.role === "admin" ? (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run({ role: "user" }, `Make ${who} a basic user? They lose access to every Admin page.`)}>
              Make basic user
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => run({ role: "admin" }, `Make ${who} an Admin? Admins can see and change everything, including AI keys and other people's accounts.`)}
            >
              Make Admin
            </button>
          )}
          {user.status === "disabled" ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run({ status: "active" })}>
              Switch back on
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--bad)" }}
              disabled={busy}
              onClick={() => run({ status: "disabled" }, `Switch off ${who}'s account? They can't use Fundur until you switch it back on. Their work is kept.`)}
            >
              {user.status === "waiting" ? "Turn away" : "Switch off"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
