"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronRight,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import { SettingsTabs } from "./SettingsTabs";
import { useStudio } from "@/components/providers/StudioProvider";
import type { ProviderId, ProviderInfo } from "@/lib/ai/catalog";
import type { ProviderKeyStatus, UserAiMode, UserAiSettings } from "@/lib/ai/settings";
import type { Viewer } from "@/lib/studio/viewer";

interface UserAiData {
  settings: UserAiSettings;
  keys: ProviderKeyStatus[];
  byokAllowed: boolean;
  platformStatus: {
    configured: boolean;
    orchestratorModel: string | null;
    orchestratorName: string | null;
    provider: ProviderId | null;
  };
}

export function UserSettingsView({
  viewer,
  providers,
}: {
  viewer: Viewer;
  providers: ProviderInfo[];
}) {
  const { toast } = useStudio();
  const [data, setData] = useState<UserAiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderId>("anthropic");
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    fetch("/api/user/ai")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load user AI settings");
        return res.json();
      })
      .then((d: UserAiData) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: Error) => {
        setLoadError(err.message);
        setLoading(false);
      });
  }, []);

  const setMode = async (mode: UserAiMode) => {
    if (data?.settings.mode === mode) return;
    setSwitchingMode(true);
    try {
      const res = await fetch("/api/user/ai", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to switch AI mode");
      setData((prev) => (prev ? { ...prev, settings: body.settings } : prev));
      toast(
        mode === "platform"
          ? "Switched to Platform AI Orchestration"
          : "Switched to Bring Your Own Keys (BYOK)"
      );
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSwitchingMode(false);
    }
  };

  const handleSaveKey = async (provider: ProviderId) => {
    if (!keyInput.trim()) return;
    setSavingKey(true);
    try {
      const res = await fetch("/api/user/ai/keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: keyInput.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save key");
      setData((prev) => (prev ? { ...prev, keys: body.keys } : prev));
      setKeyInput("");
      const pName = providers.find((p) => p.id === provider)?.name ?? provider;
      toast(`${pName} key connected and verified`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const handleDeleteKey = async (provider: ProviderId) => {
    try {
      const res = await fetch(`/api/user/ai/keys?provider=${provider}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to remove key");
      setData((prev) => (prev ? { ...prev, keys: body.keys } : prev));
      const pName = providers.find((p) => p.id === provider)?.name ?? provider;
      toast(`${pName} key removed`);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const selectedProviderInfo = providers.find((p) => p.id === activeProvider);
  const selectedKeyStatus = data?.keys.find((k) => k.provider === activeProvider);
  const isByok = data?.settings.mode === "byok";
  const connectedKeysCount = data?.keys.filter((k) => k.saved).length ?? 0;

  return (
    <main className="page page-narrow">
      <SettingsTabs />

      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.5rem" }}>
          User Preferences
        </p>
        <h1 className="display-l">AI Settings &amp; Keys</h1>
        <p className="muted" style={{ marginTop: "0.5rem" }}>
          Choose how your conversations, brief drafting and workflows are powered. Use Fundur&rsquo;s
          intelligent platform models or connect your own private provider API keys.
        </p>
      </header>

      {loadError && (
        <div className="card" style={{ padding: "1.25rem", color: "var(--bad)", marginBottom: "1.5rem" }}>
          <AlertTriangle size={16} /> {loadError}
        </div>
      )}

      {loading ? (
        <div className="stack" style={{ alignItems: "center", padding: "3rem 1rem", gap: "0.75rem" }}>
          <Loader2 size={24} className="spin" style={{ color: "var(--accent)" }} />
          <span className="small muted">Loading your AI settings…</span>
        </div>
      ) : data ? (
        <>
          {/* Active Mode Banner */}
          <div
            className="card rise"
            style={{
              padding: "1rem 1.25rem",
              marginBottom: "1.5rem",
              background: isByok ? "rgba(180, 220, 50, 0.08)" : "rgba(56, 189, 248, 0.08)",
              borderColor: isByok ? "rgba(180, 220, 50, 0.3)" : "rgba(56, 189, 248, 0.3)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div className="row" style={{ gap: "0.75rem", alignItems: "center" }}>
              {isByok ? (
                <KeyRound size={20} style={{ color: "var(--accent)" }} />
              ) : (
                <Sparkles size={20} style={{ color: "#38bdf8" }} />
              )}
              <div>
                <strong style={{ fontSize: "0.95rem" }}>
                  Currently using: {isByok ? "Bring Your Own Keys (BYOK)" : "Platform AI Orchestration"}
                </strong>
                <p className="tiny muted" style={{ margin: "0.15rem 0 0" }}>
                  {isByok
                    ? `Running on your private keys (${connectedKeysCount} connected). Calls go directly to your accounts.`
                    : `Running on Fundur's platform subscription (${data.platformStatus.orchestratorName || "Auto Orchestrator"}). No API keys required.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={switchingMode}
              onClick={() => setMode(isByok ? "platform" : "byok")}
            >
              {switchingMode ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <RotateCcw size={13} />
              )}
              Switch to {isByok ? "Platform AI" : "BYOK"}
            </button>
          </div>

          {/* Mode Switch Cards */}
          <div
            className="rise"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1.25rem",
              marginBottom: "2rem",
            }}
          >
            {/* Mode 1: Platform AI */}
            <div
              className={`card ${!isByok ? "card-highlight" : ""}`}
              style={{
                padding: "1.4rem",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "1rem",
                borderWidth: 2,
                borderColor: !isByok ? "var(--accent)" : "var(--line)",
                cursor: "pointer",
                position: "relative",
              }}
              onClick={() => setMode("platform")}
            >
              <div>
                <div className="row-between" style={{ marginBottom: "0.5rem" }}>
                  <span
                    className="row"
                    style={{
                      gap: "0.4rem",
                      fontWeight: 700,
                      fontSize: "0.95rem",
                      color: !isByok ? "var(--ink)" : "var(--ink-2)",
                    }}
                  >
                    <Sparkles size={16} style={{ color: "var(--accent)" }} />
                    Platform AI
                  </span>
                  {!isByok ? (
                    <span
                      className="tiny strong"
                      style={{
                        background: "rgba(180, 220, 50, 0.15)",
                        color: "var(--accent)",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      Active
                    </span>
                  ) : (
                    <span className="tiny muted">Recommended</span>
                  )}
                </div>
                <p className="small muted" style={{ lineHeight: 1.5, margin: 0 }}>
                  Fundur automatically orchestrates the most intelligent and cost-effective models for each task. High-intelligence
                  models handle planning and review; lightweight models handle fast summaries.
                </p>
                <div style={{ marginTop: "0.85rem", fontSize: "0.76rem", color: "var(--ink-3)" }}>
                  <div>Orchestrator: <strong>{data.platformStatus.orchestratorName || "Auto"}</strong></div>
                  <div>Cost: Included in platform subscription</div>
                </div>
              </div>
              <button
                type="button"
                className={`btn ${!isByok ? "btn-primary" : "btn-secondary"} btn-sm`}
                style={{ width: "100%", justifyContent: "center" }}
                disabled={!isByok || switchingMode}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode("platform");
                }}
              >
                {!isByok ? <Check size={14} /> : null}
                {!isByok ? "Using Platform AI" : "Use Platform AI"}
              </button>
            </div>

            {/* Mode 2: BYOK */}
            <div
              className={`card ${isByok ? "card-highlight" : ""}`}
              style={{
                padding: "1.4rem",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "1rem",
                borderWidth: 2,
                borderColor: isByok ? "var(--accent)" : "var(--line)",
                cursor: data.byokAllowed ? "pointer" : "not-allowed",
                opacity: data.byokAllowed ? 1 : 0.6,
              }}
              onClick={() => data.byokAllowed && setMode("byok")}
            >
              <div>
                <div className="row-between" style={{ marginBottom: "0.5rem" }}>
                  <span
                    className="row"
                    style={{
                      gap: "0.4rem",
                      fontWeight: 700,
                      fontSize: "0.95rem",
                      color: isByok ? "var(--ink)" : "var(--ink-2)",
                    }}
                  >
                    <KeyRound size={16} style={{ color: "var(--accent)" }} />
                    Bring Your Own Keys (BYOK)
                  </span>
                  {isByok ? (
                    <span
                      className="tiny strong"
                      style={{
                        background: "rgba(180, 220, 50, 0.15)",
                        color: "var(--accent)",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      Active
                    </span>
                  ) : (
                    <span className="tiny muted">{connectedKeysCount} keys</span>
                  )}
                </div>
                <p className="small muted" style={{ lineHeight: 1.5, margin: 0 }}>
                  Plug in your own API keys for Anthropic, OpenAI, Gemini, xAI, or OpenRouter. Your prompts and tasks execute directly
                  through your accounts with zero platform token charges.
                </p>
                <div style={{ marginTop: "0.85rem", fontSize: "0.76rem", color: "var(--ink-3)" }}>
                  <div>Connected: <strong>{connectedKeysCount} of {providers.length} providers</strong></div>
                  <div>Storage: Encrypted at rest (AES-256-GCM)</div>
                </div>
              </div>
              <button
                type="button"
                className={`btn ${isByok ? "btn-primary" : "btn-secondary"} btn-sm`}
                style={{ width: "100%", justifyContent: "center" }}
                disabled={isByok || switchingMode || !data.byokAllowed}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode("byok");
                }}
              >
                {isByok ? <Check size={14} /> : null}
                {isByok ? "Using Your Own Keys" : "Use My Own Keys"}
              </button>
            </div>
          </div>

          {/* Provider Key Setup Area */}
          <section className="card rise" style={{ padding: "1.4rem", marginBottom: "2rem" }}>
            <div className="row-between wrap" style={{ gap: "0.5rem", marginBottom: "0.5rem" }}>
              <div>
                <h3 className="display-s" style={{ margin: 0, fontSize: "1.1rem" }}>
                  Your Private Provider Keys
                </h3>
                <p className="tiny muted" style={{ margin: "0.2rem 0 0" }}>
                  {isByok
                    ? "These keys are currently active for all your AI tasks."
                    : "Connect keys below to use them when you switch to BYOK mode."}
                </p>
              </div>
              <span className="tiny muted">
                {connectedKeysCount} connected
              </span>
            </div>

            {/* Provider Tabs */}
            <div
              className="provider-grid"
              role="tablist"
              aria-label="Providers"
              style={{ margin: "1.25rem 0" }}
            >
              {providers.map((p) => {
                const k = data.keys.find((x) => x.provider === p.id);
                const state = !k?.saved ? "none" : k.checkError ? "failed" : "ok";
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    className="provider-card"
                    aria-selected={activeProvider === p.id}
                    aria-pressed={activeProvider === p.id}
                    data-state={state}
                    onClick={() => {
                      setActiveProvider(p.id);
                      setKeyInput("");
                    }}
                  >
                    <span className="strong">{p.name}</span>
                    <span className="tiny provider-status">
                      {state === "ok" && (
                        <>
                          <Check size={12} strokeWidth={2.5} /> Connected
                        </>
                      )}
                      {state === "failed" && (
                        <>
                          <AlertTriangle size={12} /> Key error
                        </>
                      )}
                      {state === "none" && "No key"}
                    </span>
                    <span className="tiny muted">
                      {k?.saved ? `Key: ${k.hint || "saved"}` : "Click to connect"}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected Provider Form */}
            {selectedProviderInfo && (
              <div
                style={{
                  background: "var(--surface-2)",
                  padding: "1.25rem",
                  borderRadius: "var(--r-md, 10px)",
                  border: "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
              >
                <div className="row-between wrap" style={{ gap: "0.5rem" }}>
                  <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
                    <KeyRound size={16} style={{ color: "var(--accent)" }} />
                    <strong style={{ fontSize: "0.9rem" }}>{selectedProviderInfo.name} API Key</strong>
                    {selectedKeyStatus?.saved && (
                      <span
                        className="tiny strong"
                        style={{
                          background: selectedKeyStatus.checkError
                            ? "rgba(239, 68, 68, 0.15)"
                            : "rgba(34, 197, 94, 0.15)",
                          color: selectedKeyStatus.checkError ? "var(--bad)" : "var(--good, #22c55e)",
                          padding: "1px 6px",
                          borderRadius: 999,
                        }}
                      >
                        {selectedKeyStatus.checkError ? "Error" : "Verified"}
                      </span>
                    )}
                  </div>
                  <a
                    href={selectedProviderInfo.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="row tiny muted"
                    style={{ gap: 4, textDecoration: "underline" }}
                  >
                    Get a key from {selectedProviderInfo.name} <ExternalLink size={12} />
                  </a>
                </div>

                {selectedKeyStatus?.saved ? (
                  <div className="row-between wrap" style={{ gap: "0.75rem", alignItems: "center" }}>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="small">
                        Key ending in <code style={{ color: "var(--accent)" }}>{selectedKeyStatus.hint}</code>
                      </span>
                      <span className="tiny muted">
                        {selectedKeyStatus.verifiedAt
                          ? `Verified on ${new Date(selectedKeyStatus.verifiedAt).toLocaleDateString()}`
                          : "Connected"}
                        {selectedKeyStatus.checkError ? ` · Error: ${selectedKeyStatus.checkError}` : ""}
                      </span>
                    </div>
                    <div className="row" style={{ gap: "0.5rem" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ color: "var(--bad)" }}
                        onClick={() => handleDeleteKey(selectedProviderInfo.id)}
                      >
                        <Trash2 size={13} /> Remove key
                      </button>
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveKey(selectedProviderInfo.id);
                    }}
                    style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
                  >
                    <input
                      type="password"
                      className="input grow"
                      style={{ minWidth: 260, fontSize: "0.85rem" }}
                      placeholder={`Paste your ${selectedProviderInfo.name} API key…`}
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={savingKey || !keyInput.trim()}
                    >
                      {savingKey ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
                      {savingKey ? "Verifying…" : "Connect & Verify"}
                    </button>
                  </form>
                )}
                <p className="tiny muted" style={{ margin: 0, fontSize: "0.73rem" }}>
                  Your key is securely encrypted on the server using AES-256-GCM. It is only decrypted in memory when making AI calls and is never exposed to the browser.
                </p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
