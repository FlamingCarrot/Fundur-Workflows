"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plug, Trash2 } from "lucide-react";
import { SettingsTabs } from "./SettingsTabs";
import { useStudio } from "@/components/providers/StudioProvider";
import type { TokenView } from "@/lib/mcp/tokens";

interface Data {
  url: string;
  tokens: TokenView[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Never");

/**
 * Settings → Connected AI apps: the MCP server's address, how to connect
 * Claude, ChatGPT, Claude Code or Cursor to it, her personal tokens (made,
 * shown once, revoked) and the apps signed in with OAuth.
 */
export function ConnectionsView({ showTabs }: { showTabs: boolean }) {
  const { toast } = useStudio();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [canConfirm, setCanConfirm] = useState(false);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/user/mcp-tokens")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load your connections");
        setData(body);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const copy = (value: string, what: string) => {
    void navigator.clipboard?.writeText(value).then(
      () => toast(`${what} copied`),
      () => toast("Copy did not work; select it and copy by hand")
    );
  };

  const make = async () => {
    if (!name.trim()) return;
    setMaking(true);
    try {
      const res = await fetch("/api/user/mcp-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), canConfirm }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not make the token");
      setMade(body.token);
      setName("");
      setCanConfirm(false);
      setData((d) => (d ? { ...d, tokens: [body.view, ...d.tokens] } : d));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setMaking(false);
    }
  };

  const revoke = async (t: TokenView) => {
    const res = await fetch(`/api/user/mcp-tokens/${t.id}`, { method: "DELETE" });
    if (!res.ok) return toast("Could not revoke it");
    setData((d) => (d ? { ...d, tokens: d.tokens.filter((x) => x.id !== t.id) } : d));
    toast(`${t.name} can no longer use Fundur`);
  };

  const url = data?.url ?? "";
  const claudeCode = `claude mcp add --transport http fundur ${url} --header "Authorization: Bearer ${made ?? "YOUR_TOKEN"}"`;

  return (
    <main className="page page-narrow">
      {showTabs && <SettingsTabs />}
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.5rem" }}>
          MCP server
        </p>
        <h1 className="display-l">Connected AI apps</h1>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Connect Claude, ChatGPT, Cursor or your own agents to Fundur. They get every tool Fundur&rsquo;s assistant has, its instructions and your
          projects, acting as you: your rights, your plan, and the same versioned, undoable changes. What they change shows in each project&rsquo;s
          assistant chat with an Undo.
        </p>
      </header>

      {error && (
        <div className="card" style={{ padding: "1.25rem", color: "var(--bad)", marginBottom: "1.5rem" }}>
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {!data && !error ? (
        <div className="stack" style={{ alignItems: "center", padding: "3rem 1rem", gap: "0.75rem" }}>
          <Loader2 size={24} className="spin" style={{ color: "var(--accent)" }} />
          <span className="small muted">Loading your connections…</span>
        </div>
      ) : data ? (
        <>
          <section className="card rise" style={{ padding: "1.4rem", marginBottom: "1.5rem" }}>
            <div className="row" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
              <Plug size={16} style={{ color: "var(--accent)" }} />
              <strong>Server address</strong>
            </div>
            <div className="row" style={{ gap: "0.5rem" }}>
              <code className="input" style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>
                {url}
              </code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(url, "Address")}>
                <Copy size={13} /> Copy
              </button>
            </div>
            <ul className="small muted" style={{ margin: "1rem 0 0", paddingLeft: "1.1rem", lineHeight: 1.6 }}>
              <li>
                <strong>Claude</strong> (claude.ai, desktop, phone): Settings → Connectors → Add custom connector, paste the address, then sign in to Fundur
                when it asks.
              </li>
              <li>
                <strong>ChatGPT</strong>: Settings → Connectors → Create, paste the address and choose OAuth. Sign in to Fundur when it asks.
              </li>
              <li>
                <strong>Claude Code, Cursor and agents</strong>: make a personal token below and send it as <code>Authorization: Bearer …</code>.
              </li>
            </ul>
          </section>

          <section className="card rise" style={{ padding: "1.4rem", marginBottom: "1.5rem" }}>
            <div className="row" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
              <KeyRound size={16} style={{ color: "var(--accent)" }} />
              <strong>New personal token</strong>
            </div>
            {made ? (
              <div className="stack" style={{ gap: "0.75rem" }}>
                <p className="small" style={{ margin: 0 }}>
                  Copy it now: Fundur keeps only a fingerprint of it and can&rsquo;t show it again.
                </p>
                <div className="row" style={{ gap: "0.5rem" }}>
                  <code className="input" style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>
                    {made}
                  </code>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(made, "Token")}>
                    <Copy size={13} /> Copy
                  </button>
                </div>
                <p className="tiny muted" style={{ margin: 0 }}>
                  Claude Code:
                </p>
                <div className="row" style={{ gap: "0.5rem" }}>
                  <code className="input tiny" style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}>
                    {claudeCode}
                  </code>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(claudeCode, "Command")}>
                    <Copy size={13} />
                  </button>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setMade(null)}>
                  <Check size={13} /> Done
                </button>
              </div>
            ) : (
              <form
                className="stack"
                style={{ gap: "0.75rem" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void make();
                }}
              >
                <label className="field">
                  <span className="field-label">Name</span>
                  <input className="input" value={name} maxLength={100} placeholder="e.g. Claude Code on my laptop" onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="row small" style={{ gap: "0.5rem", alignItems: "flex-start" }}>
                  <input type="checkbox" checked={canConfirm} onChange={(e) => setCanConfirm(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>Also let it confirm big changes (deletes, completing phases, new projects) that otherwise wait for you in Fundur.</span>
                </label>
                <button type="submit" className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} disabled={making || !name.trim()}>
                  {making ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />} Make token
                </button>
              </form>
            )}
          </section>

          <section className="card rise" style={{ padding: "1.4rem" }}>
            <strong style={{ display: "block", marginBottom: "0.75rem" }}>Tokens and apps</strong>
            {!data.tokens.length ? (
              <p className="small muted" style={{ margin: 0 }}>
                Nothing is connected yet.
              </p>
            ) : (
              <div className="stack" style={{ gap: "0.6rem" }}>
                {data.tokens.map((t) => (
                  <div key={t.id} className="row-between" style={{ gap: "0.75rem", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: "0.6rem" }}>
                    <div className="stack" style={{ gap: "0.1rem", minWidth: 0 }}>
                      <span className="small strong truncate">
                        {t.name} <span className="tiny muted">{t.kind === "oauth" ? "· signed-in app" : `· ${t.prefix}…`}</span>
                      </span>
                      <span className="tiny muted">
                        {t.workspaceName ?? "Workspace"} · made {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                        {t.canConfirm ? " · may confirm big changes" : ""}
                      </span>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void revoke(t)}>
                      <Trash2 size={13} /> Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
