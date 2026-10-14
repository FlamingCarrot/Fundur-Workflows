"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ExternalLink, KeyRound, Plus, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { SettingsTabs } from "./SettingsTabs";
import type { ModelOption, ProviderId, ProviderInfo } from "@/lib/ai/catalog";
import { formatContext, formatPrice } from "@/lib/ai/model-browser";
import { ModelBrowser } from "./ModelBrowser";

interface KeyStatus {
  provider: ProviderId;
  saved: boolean;
  hint: string | null;
  verifiedAt: string | null;
  checkedAt: string | null;
  checkError: string | null;
}

interface RoleModel {
  provider: ProviderId;
  model: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  zarPerUsd: number;
  imageUsdPerImage?: number | null;
}

type Role = "orchestrator" | "orchestrator_fallback" | "worker" | "worker_fallback" | "image" | "image_fallback";

interface EnabledModel {
  provider: ProviderId;
  model: string;
  name: string;
  inputUsdPerMTok: number | null;
  outputUsdPerMTok: number | null;
  contextLength: number | null;
}

interface AutoPick extends RoleModel {
  role: Role;
  name: string;
  reason: string;
}

interface Settings {
  keys: KeyStatus[];
  roles: Partial<Record<Role, RoleModel>>;
  enabledModels: EnabledModel[];
  /** The automatic choice: whether it is on, whether the shortlist lets it work, and what it picked. */
  auto: { enabled: boolean; active: boolean; picks: AutoPick[] };
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

const ROLES: { role: Role; name: string; hint: string }[] = [
  { role: "orchestrator", name: "Top model", hint: "Talks with the designer, plans the work and reviews what workers do." },
  { role: "orchestrator_fallback", name: "Top model fallback", hint: "Answers when the top model fails." },
  { role: "worker", name: "Worker model", hint: "Routine tasks such as formatting, summaries and filing. Uses the top model when empty." },
  { role: "worker_fallback", name: "Worker fallback", hint: "Answers when the worker model fails." },
  { role: "image", name: "Concept image model", hint: "OpenRouter image input/output model, with an estimated cost per image." },
  { role: "image_fallback", name: "Image fallback", hint: "Tries another image model when generation fails." },
];

/**
 * The Admin's AI settings: a card per provider with its key and shortlist
 * (P4-06 to P4-08), and which model fills each role, with fallbacks (P4-09).
 */
export function AiSettingsView({ providers }: { providers: ProviderInfo[] }) {
  const { toast } = useStudio();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [models, setModels] = useState<Record<string, ModelOption[]>>({});

  useEffect(() => {
    call<Settings>("/api/admin/ai").then(
      (s) => {
        setSettings(s);
        setProvider(s.roles.orchestrator?.provider ?? s.keys.find((k) => k.saved)?.provider ?? providers[0].id);
      },
      (err: Error) => setLoadError(err.message)
    );
  }, [providers]);

  const info = providers.find((p) => p.id === provider);
  const keyStatus = settings?.keys.find((k) => k.provider === provider);

  // The model list comes from the stored daily list or the provider, once per provider.
  const needsModels = !!provider && !!keyStatus?.saved && !models[provider];
  useEffect(() => {
    if (!needsModels || !provider) return;
    const id = provider;
    call<{ models: ModelOption[] }>(`/api/admin/ai/models?provider=${id}`).then(
      ({ models: list }) => setModels((m) => ({ ...m, [id]: list })),
      () => setModels((m) => ({ ...m, [id]: [] }))
    );
  }, [needsModels, provider]);

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin settings</p>
        <h1 className="display-l">AI models</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Connect providers, add the models the platform may use, then choose a model for each role. Keys are checked
          with the provider, stored encrypted on the server and never shown again.
        </p>
      </header>

      {loadError && <div className="card" style={{ padding: "1.25rem 1.4rem", color: "var(--bad)" }}>{loadError}</div>}

      {settings && (
        <>
          <div className="row wrap" style={{ gap: "0.5rem", alignItems: "center", margin: "1.25rem 0 0.5rem" }}>
            <span className="tag" style={{ background: "rgba(56, 189, 248, 0.15)", color: "#38bdf8", fontWeight: 700 }}>
              Area 1 · Platform Subscription
            </span>
            <strong style={{ fontSize: "1rem" }}>Platform Managed Subscription &amp; Auto-Orchestration</strong>
          </div>
          <p className="tiny muted" style={{ margin: "0 0 1rem" }}>
            The models and keys below power the platform for all users who choose Platform AI. Fundur automatically selects
            the most intelligent and cost-effective models for each task or type of work based on best fit.
          </p>

          <SuggestionsCard providers={providers} onSettings={(s, message) => { setSettings(s); if (message) toast(message); }} />
          <RolesCard settings={settings} providers={providers} onSettings={(s, message) => { setSettings(s); if (message) toast(message); }} />

          <h2 className="display-s rise" style={{ margin: "2.25rem 0 1rem", ["--i" as string]: 2 }}>Providers</h2>
          <div className="provider-grid rise" role="group" aria-label="Providers" style={{ ["--i" as string]: 2 }}>
            {providers.map((p) => {
              const k = settings.keys.find((x) => x.provider === p.id);
              const state = !k?.saved ? "none" : k.checkError ? "failed" : "ok";
              return (
                <button
                  key={p.id}
                  type="button"
                  className="provider-card"
                  aria-pressed={provider === p.id}
                  data-state={state}
                  onClick={() => setProvider(p.id)}
                >
                  <span className="strong">{p.name}</span>
                  <span className="tiny provider-status">
                    {state === "ok" && <><Check size={12} strokeWidth={2.5} /> Connected</>}
                    {state === "failed" && <><AlertTriangle size={12} /> Key failed</>}
                    {state === "none" && "No key"}
                  </span>
                  <span className="tiny muted">
                    {k?.saved && k.verifiedAt ? `Checked ${shortDate(k.checkedAt ?? k.verifiedAt)}` : "Not connected"}
                  </span>
                </button>
              );
            })}
          </div>

          {info && (
            <>
              <KeyCard
                key={info.id}
                info={info}
                status={keyStatus}
                onSaved={(s, list) => {
                  setSettings(s);
                  setModels((m) => ({ ...m, [info.id]: list }));
                  toast(`${info.name} key checked and saved`);
                }}
                onChecked={(s, list, error) => {
                  setSettings(s);
                  if (list) setModels((m) => ({ ...m, [info.id]: list }));
                  toast(error ? `${info.name} key failed its check` : `${info.name} key still works`);
                }}
                onRemoved={(s) => {
                  setSettings(s);
                  setModels((m) => ({ ...m, [info.id]: [] }));
                  toast(`${info.name} key removed`);
                }}
              />
              {keyStatus?.saved && (
                <ModelsCard
                  key={`model-${info.id}`}
                  info={info}
                  models={models[info.id]}
                  enabled={settings.enabledModels.filter((m) => m.provider === info.id)}
                  roles={settings.auto.active ? Object.fromEntries(settings.auto.picks.map((p) => [p.role, p])) : settings.roles}
                  auto={settings.auto.active}
                  onSettings={(s, message) => {
                    setSettings(s);
                    if (message) toast(message);
                  }}
                />
              )}
            </>
          )}

          <ByokAdminCard />
        </>
      )}
    </main>
  );
}

interface Suggestion {
  id: string;
  role: Role;
  provider: ProviderId;
  currentModel: string;
  suggestedModel: string;
  suggestedName: string;
  kind: "cheaper" | "newer";
  reason: string;
  createdAt: string;
}

/**
 * Models the daily list suggests for a role (P4-17): accept to switch the role
 * to it, or dismiss. Shown only while there are some.
 */
function SuggestionsCard({ providers, onSettings }: { providers: ProviderInfo[]; onSettings: (s: Settings, message?: string) => void }) {
  const [list, setList] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    call<{ suggestions: Suggestion[] }>("/api/admin/ai/suggestions").then(
      (r) => setList(r.suggestions),
      () => setList([])
    );
  }, []);
  if (!list.length) return null;
  const providerName = (id: ProviderId) => providers.find((p) => p.id === id)?.name ?? id;
  const roleName = (role: Role) => ROLES.find((r) => r.role === role)?.name ?? role;

  const act = async (s: Suggestion, action: "accept" | "dismiss") => {
    setBusy(s.id);
    try {
      const res = await fetch(`/api/admin/ai/suggestions/${s.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.suggestions) setList(body.suggestions);
      if (!res.ok) window.alert(body.error || `Request failed (${res.status})`);
      else if (body.settings) onSettings(body.settings, action === "accept" ? `${roleName(s.role)} switched to ${s.suggestedName}` : undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card rise suggestion-card" style={{ padding: "1.25rem 1.4rem", marginBottom: "1.25rem", ["--i" as string]: 1 }} aria-label="Model suggestions">
      <div className="row" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
        <Sparkles size={16} />
        <span className="eyebrow">{list.length === 1 ? "A model to consider" : `${list.length} models to consider`}</span>
      </div>
      <ul className="role-list">
        {list.map((s) => (
          <li key={s.id} className="role-row">
            <div className="row-between wrap" style={{ gap: "0.75rem" }}>
              <div className="stack" style={{ gap: "0.2rem", minWidth: 0, flex: 1 }}>
                <span className="small">
                  <span className="strong">{s.suggestedName}</span> for the {roleName(s.role).toLowerCase()}
                  <span className="tag" style={{ marginLeft: "0.5rem" }}>{s.kind === "cheaper" ? "Cheaper" : "Newer"}</span>
                </span>
                <span className="tiny muted">{s.reason}</span>
                <span className="tiny muted">
                  Instead of {s.currentModel} · {providerName(s.provider)} · found {shortDate(s.createdAt)}
                </span>
              </div>
              <div className="row" style={{ gap: "0.4rem" }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy === s.id} onClick={() => act(s, "accept")}>
                  <Check size={14} /> Switch
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy === s.id} onClick={() => act(s, "dismiss")}>
                  Dismiss
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Which model fills each role, picked from the shortlist across providers. */
function RolesCard({
  settings,
  providers,
  onSettings,
}: {
  settings: Settings;
  providers: ProviderInfo[];
  onSettings: (s: Settings, message?: string) => void;
}) {
  const [editing, setEditing] = useState<Role | null>(null);
  const [switching, setSwitching] = useState(false);
  const auto = settings.auto;
  const autoPick = (role: Role) => (auto.active ? auto.picks.find((p) => p.role === role) : undefined);
  const top = autoPick("orchestrator") ?? settings.roles.orchestrator;
  const providerName = (id: ProviderId) => providers.find((p) => p.id === id)?.name ?? id;
  const modelName = (m: RoleModel) => settings.enabledModels.find((e) => e.provider === m.provider && e.model === m.model)?.name ?? m.model;

  const setAuto = async (on: boolean) => {
    setSwitching(true);
    try {
      onSettings(
        await call<Settings>("/api/admin/ai", { method: "PATCH", body: JSON.stringify({ auto: on }) }),
        on ? "Models are now picked automatically" : "Automatic choice off. The models it picked stay in their roles."
      );
    } catch (err) {
      window.alert((err as Error).message);
    } finally {
      setSwitching(false);
    }
  };

  const clear = async (role: Role) => {
    try {
      onSettings(await call<Settings>(`/api/admin/ai?role=${role}`, { method: "DELETE" }), "Role emptied");
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <section className="card rise" style={{ padding: "1.25rem 1.4rem", ["--i" as string]: 1 }}>
      <div className="row-between wrap" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
        <span className="eyebrow">Models in use</span>
        <label className="row tiny" style={{ gap: "0.5rem", cursor: "pointer" }}>
          <span className={auto.enabled ? "strong" : "muted"}>Pick the best automatically</span>
          <button
            type="button"
            role="switch"
            aria-checked={auto.enabled}
            aria-label="Pick the best model for each role automatically"
            className="switch"
            disabled={switching}
            onClick={() => setAuto(!auto.enabled)}
          />
        </label>
      </div>
      <p className="tiny muted" style={{ margin: "-0.25rem 0 0.75rem" }}>
        {auto.active
          ? "Each role uses the best model on your shortlist, checked on every call: the most capable one talks and reviews, the cheapest capable one does routine work. Add or remove models below and the choice follows. Choosing a model by hand turns this off."
          : auto.enabled
            ? "Add a model with a working key to the shortlist below and it is picked automatically. Until then the roles below are used."
            : "You choose each role's model yourself."}
        {top ? ` R${top.zarPerUsd} to the US dollar.` : ""}
      </p>
      <div className="role-list">
        {ROLES.map(({ role, name, hint }) => {
          const picked = autoPick(role);
          const current = picked ?? settings.roles[role];
          const locked = role !== "orchestrator" && !top;
          return (
            <div key={role} className="role-row">
              <div className="row-between wrap" style={{ gap: "0.75rem" }}>
                <div className="stack" style={{ gap: "0.15rem", minWidth: 0, flex: 1 }}>
                  <span className="small strong row" style={{ gap: "0.4rem" }}>
                    {name}
                    {picked && <span className="tag"><Sparkles size={11} /> Auto</span>}
                  </span>
                  {picked && <span className="tiny muted">{picked.reason}</span>}
                  {current ? (
                    <span className="tiny muted truncate">
                      {modelName(current)} · {providerName(current.provider)} · US${current.inputUsdPerMTok} in, US$
                      {current.outputUsdPerMTok} out per million{current.imageUsdPerImage != null ? ` · US$${current.imageUsdPerImage} per image (estimate)` : ""}
                    </span>
                  ) : (
                    <span className="tiny muted">{hint}</span>
                  )}
                </div>
                <div className="row" style={{ gap: "0.4rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={locked || !settings.enabledModels.length}
                    title={locked ? "Choose the top model first" : !settings.enabledModels.length ? "Add models below first" : undefined}
                    onClick={() => setEditing(editing === role ? null : role)}
                  >
                    {current ? "Change" : "Choose"}
                  </button>
                  {current && !picked && role !== "orchestrator" && (
                    <button type="button" className="icon-btn" aria-label={`Empty ${name}`} onClick={() => clear(role)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              {editing === role && (
                <RoleEditor
                  role={role}
                  current={current ?? null}
                  zarPerUsd={top?.zarPerUsd ?? 18}
                  enabled={role.startsWith("image") ? settings.enabledModels.filter(m=>m.provider==="openrouter") : settings.enabledModels}
                  providers={providers}
                  onSaved={(s) => {
                    setEditing(null);
                    onSettings(s, `${name} saved`);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {!top && (
        <p className="small muted" style={{ marginTop: "0.75rem" }}>
          No top model yet, so the assistant and brief drafting are off. Connect a provider below, add models, then choose one.
        </p>
      )}
    </section>
  );
}

function RoleEditor({
  role,
  current,
  zarPerUsd,
  enabled,
  providers,
  onSaved,
}: {
  role: Role;
  current: RoleModel | null;
  zarPerUsd: number;
  enabled: EnabledModel[];
  providers: ProviderInfo[];
  onSaved: (s: Settings) => void;
}) {
  const id = (m: { provider: string; model: string }) => `${m.provider}::${m.model}`;
  const [picked, setPicked] = useState(current ? id(current) : enabled[0] ? id(enabled[0]) : "");
  const imageRole = role.startsWith("image");
  const [imagePrice,setImagePrice] = useState(String(current?.imageUsdPerImage ?? ""));
  const row = enabled.find((m) => id(m) === picked);
  const same = current && id(current) === picked;
  const [inPrice, setInPrice] = useState(String(same ? current.inputUsdPerMTok : (row?.inputUsdPerMTok ?? "")));
  const [outPrice, setOutPrice] = useState(String(same ? current.outputUsdPerMTok : (row?.outputUsdPerMTok ?? "")));
  const [rate, setRate] = useState(String(zarPerUsd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (value: string) => {
    setPicked(value);
    const m = enabled.find((e) => id(e) === value);
    const keep = current && id(current) === value;
    setInPrice(String(keep ? current.inputUsdPerMTok : (m?.inputUsdPerMTok ?? "")));
    setOutPrice(String(keep ? current.outputUsdPerMTok : (m?.outputUsdPerMTok ?? "")));
  };

  const numbers = [inPrice, outPrice, rate].map(Number);
  const valid = row && (!imageRole || (Number(imagePrice)>0 && Number(imagePrice)<=100)) && inPrice !== "" && outPrice !== "" && numbers.every((n, i) => Number.isFinite(n) && (i === 2 ? n > 0 : n >= 0));

  const save = async () => {
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(
        await call<Settings>("/api/admin/ai", {
          method: "PUT",
          body: JSON.stringify({
            role,
            provider: row.provider,
            model: row.model,
            inputUsdPerMTok: numbers[0],
            outputUsdPerMTok: numbers[1],
            zarPerUsd: numbers[2],
            ...(imageRole?{imageUsdPerImage:Number(imagePrice)}:{}),
          }),
        })
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const byProvider = providers.map((p) => ({ p, list: enabled.filter((m) => m.provider === p.id) })).filter((g) => g.list.length);
  return (
    <div className="stack" style={{ gap: "0.85rem", marginTop: "0.9rem" }}>
      <label className="field">
        <span className="field-label">Model</span>
        <select className="input" value={picked} onChange={(e) => pick(e.target.value)}>
          {byProvider.map(({ p, list }) => (
            <optgroup key={p.id} label={p.name}>
              {list.map((m) => (
                <option key={id(m)} value={id(m)}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {imageRole && <label className="field"><span className="field-label">Estimated US$ per image</span><input className="input" inputMode="decimal" value={imagePrice} onChange={e=>setImagePrice(e.target.value)} /><span className="tiny muted">Used for budget checks and when the provider does not report a billed cost. Actual charges may differ. Choose an OpenRouter model with image input and output.</span></label>}
      <div className="row wrap" style={{ gap: "0.75rem" }}>
        <label className="field grow" style={{ minWidth: 130 }}>
          <span className="field-label">Input, US$ per million</span>
          <input className="input" inputMode="decimal" value={inPrice} onChange={(e) => setInPrice(e.target.value)} placeholder="e.g. 4" />
        </label>
        <label className="field grow" style={{ minWidth: 130 }}>
          <span className="field-label">Output, US$ per million</span>
          <input className="input" inputMode="decimal" value={outPrice} onChange={(e) => setOutPrice(e.target.value)} placeholder="e.g. 20" />
        </label>
        <label className="field grow" style={{ minWidth: 110 }}>
          <span className="field-label">Rand per US$</span>
          <input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
      </div>
      {row && !providers.find((p) => p.id === row.provider)?.pricesListed && (
        <p className="tiny muted">This provider does not publish prices through its API, so check them on its pricing page.</p>
      )}
      {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function KeyCard({
  info,
  status,
  onSaved,
  onChecked,
  onRemoved,
}: {
  info: ProviderInfo;
  status: KeyStatus | undefined;
  onSaved: (s: Settings, models: ModelOption[]) => void;
  onChecked: (s: Settings, models: ModelOption[] | undefined, error: string | undefined) => void;
  onRemoved: (s: Settings) => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showInput = !status?.saved || replacing;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await call<Settings & { models: ModelOption[] }>("/api/admin/ai/keys", {
        method: "PUT",
        body: JSON.stringify({ provider: info.id, key: key.trim() }),
      });
      setKey("");
      setReplacing(false);
      onSaved(res, res.models);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await call<Settings & { models?: ModelOption[]; error?: string }>("/api/admin/ai/keys/verify", {
        method: "POST",
        body: JSON.stringify({ provider: info.id }),
      });
      onChecked(res, res.models, res.error);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the ${info.name} key? AI features using it stop working until a new key is saved.`)) return;
    setBusy(true);
    try {
      onRemoved(await call<Settings>(`/api/admin/ai/keys?provider=${info.id}`, { method: "DELETE" }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card rise" style={{ padding: "1.4rem", margin: "1.25rem 0", ["--i" as string]: 3 }}>
      <div className="row-between wrap" style={{ gap: "0.75rem", marginBottom: showInput ? "1rem" : 0 }}>
        <div className="row" style={{ gap: "0.75rem", minWidth: 0 }}>
          <span className="dropzone-icon" style={{ width: 40, height: 40, margin: 0 }}>
            <KeyRound size={18} />
          </span>
          <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
            <span className="strong">{info.name} key</span>
            <span className="small muted">
              {status?.saved
                ? `Saved key ${status.hint ?? ""}${status.verifiedAt ? `, verified ${shortDate(status.verifiedAt)}` : ""}`
                : "No key saved"}
            </span>
          </div>
        </div>
        {status?.saved && !replacing && (
          <div className="row" style={{ gap: "0.4rem" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={check} disabled={busy}>
              <RefreshCw size={14} /> {busy ? "Checking…" : "Check again"}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReplacing(true)} disabled={busy}>
              Replace
            </button>
            <button type="button" className="icon-btn" aria-label={`Remove ${info.name} key`} onClick={remove} disabled={busy}>
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
      {status?.saved && status.checkError && !replacing && (
        <p className="small" role="alert" style={{ color: "var(--bad)", marginTop: "0.75rem" }}>
          The last check on {shortDate(status.checkedAt ?? status.verifiedAt ?? new Date().toISOString())} failed: {status.checkError}
        </p>
      )}

      {showInput && (
        <form
          className="stack"
          style={{ gap: "0.75rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim() && !busy) void save();
          }}
        >
          <label className="field">
            <span className="field-label">
              Paste the key
              <a href={info.keyUrl} target="_blank" rel="noreferrer" className="tiny muted row" style={{ gap: "0.25rem" }}>
                Get a key <ExternalLink size={12} />
              </a>
            </span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={info.keyPlaceholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
          {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
          <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
            {replacing && (
              <button type="button" className="btn btn-ghost" onClick={() => setReplacing(false)}>Cancel</button>
            )}
            <button type="submit" className="btn btn-primary" disabled={!key.trim() || busy}>
              {busy ? "Checking…" : "Check and save"}
            </button>
          </div>
        </form>
      )}
      {!showInput && error && <p className="small" role="alert" style={{ color: "var(--bad)", marginTop: "0.75rem" }}>{error}</p>}
    </section>
  );
}

const ROLE_TAGS: Record<Role, string> = {
  orchestrator: "Top",
  orchestrator_fallback: "Top fallback",
  worker: "Worker",
  worker_fallback: "Worker fallback",
  image: "Image",
  image_fallback: "Image fallback",
};

/**
 * The shortlist of models for one provider. The browser adds and removes
 * models; roles are then filled from the shortlist above.
 */
function ModelsCard({
  info,
  models,
  enabled,
  roles,
  auto,
  onSettings,
}: {
  info: ProviderInfo;
  models: ModelOption[] | undefined;
  enabled: EnabledModel[];
  roles: Settings["roles"];
  /** Models are picked automatically, so one in use can still be removed: the next best takes its place. */
  auto: boolean;
  onSettings: (s: Settings, message?: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [listError, setListError] = useState<string | null>(null);
  const added = useMemo(() => new Set(enabled.map((m) => m.model)), [enabled]);
  const rolesOf = (model: string) =>
    (Object.keys(roles) as Role[]).filter((r) => roles[r]?.provider === info.id && roles[r]?.model === model);

  const busyWith = (id: string, on: boolean) =>
    setPending((p) => {
      const next = new Set(p);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleModel = async (id: string, name: string) => {
    const removing = added.has(id);
    busyWith(id, true);
    setListError(null);
    try {
      const s = removing
        ? await call<Settings>(`/api/admin/ai/enabled?provider=${info.id}&model=${encodeURIComponent(id)}`, { method: "DELETE" })
        : await call<Settings>("/api/admin/ai/enabled", { method: "PUT", body: JSON.stringify({ provider: info.id, model: id }) });
      onSettings(s, `${name} ${removing ? "removed" : "added"}`);
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      busyWith(id, false);
    }
  };

  const browseLabel = !models ? "Loading models…" : models.length ? `Browse ${models.length} models` : "No models found for this key";

  return (
    <section className="card rise" style={{ padding: "1.4rem", ["--i" as string]: 4 }}>
      <div className="row-between wrap" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
        <div className="row" style={{ gap: "0.75rem", minWidth: 0 }}>
          <span className="dropzone-icon" style={{ width: 40, height: 40, margin: 0 }}>
            <Sparkles size={18} />
          </span>
          <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
            <span className="strong">{info.name} models</span>
            <span className="small muted">{info.listNotes}</span>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!models?.length} onClick={() => setBrowsing(true)}>
          <Search size={15} /> {browseLabel}
        </button>
      </div>

      {enabled.length === 0 ? (
        <div className="model-empty">
          <p className="small muted">No {info.name} models added yet.</p>
          {!!models?.length && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setBrowsing(true)}>
              <Plus size={15} strokeWidth={2.5} /> Add models
            </button>
          )}
        </div>
      ) : (
        <div className="model-list">
          {enabled.map((m) => {
            const inRoles = rolesOf(m.model);
            const listed = models?.find((o) => o.id === m.model);
            const gone = models && !listed;
            // The provider's current list wins over what was copied when the model was added.
            const context = listed?.contextLength ?? m.contextLength;
            const input = listed?.inputUsdPerMTok ?? m.inputUsdPerMTok;
            const output = listed?.outputUsdPerMTok ?? m.outputUsdPerMTok;
            return (
              <div key={m.model} className="model-pick">
                <span className="stack grow" style={{ gap: "0.1rem", minWidth: 0, padding: "0.4rem 0" }}>
                  <span className="row wrap" style={{ gap: "0.4rem" }}>
                    <span className="strong truncate">{listed?.name ?? m.name}</span>
                    {inRoles.map((r) => (
                      <span key={r} className="tag tag-good">{ROLE_TAGS[r]}</span>
                    ))}
                    {gone && <span className="tag tag-hold">No longer listed</span>}
                  </span>
                  <span className="tiny muted mb-meta">
                    {(listed?.name ?? m.name) !== m.model && <span className="mb-id">{m.model}</span>}
                    {context != null && <span>{formatContext(context)} context</span>}
                    {input === 0 && !output ? (
                      <span>Free</span>
                    ) : (
                      <>
                        {input != null && <span>{formatPrice(input)}/M in</span>}
                        {output != null && <span>{formatPrice(output)}/M out</span>}
                      </>
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${m.name}`}
                  title={inRoles.length && !auto ? "This model is in use. Choose another for its role first." : `Remove ${m.name}`}
                  disabled={(inRoles.length > 0 && !auto) || pending.has(m.model)}
                  onClick={() => toggleModel(m.model, m.name)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {listError && <p className="small" role="alert" style={{ color: "var(--bad)", marginTop: "0.75rem" }}>{listError}</p>}

      {browsing && models && (
        <ModelBrowser
          info={info}
          models={models}
          added={added}
          pending={pending}
          defaultModel={roles.orchestrator?.provider === info.id ? roles.orchestrator.model : null}
          onToggle={(o) => toggleModel(o.id, o.name)}
          onClose={() => setBrowsing(false)}
        />
      )}
    </section>
  );
}

function ByokAdminCard() {
  const { toast } = useStudio();
  const [policy, setPolicy] = useState<{ byokAllowed: boolean; byokUserCount: number; platformUserCount: number; totalUsers: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/ai/byok")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data && setPolicy(data))
      .catch(() => {});
  }, []);

  const togglePolicy = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/ai/byok", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ byokAllowed: !policy.byokAllowed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update BYOK policy");
      setPolicy(data);
      toast(data.byokAllowed ? "BYOK is now allowed for users" : "BYOK is now disabled");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card rise" style={{ padding: "1.4rem", marginTop: "2.5rem", ["--i" as string]: 3 }}>
      <div className="row-between wrap" style={{ gap: "0.5rem", marginBottom: "0.75rem" }}>
        <div className="row" style={{ gap: "0.5rem", alignItems: "center" }}>
          <span className="tag" style={{ background: "rgba(180, 220, 50, 0.15)", color: "var(--accent)", fontWeight: 700 }}>
            Area 2 · BYOK Settings
          </span>
          <h2 className="display-s" style={{ margin: 0, fontSize: "1.15rem" }}>
            Bring Your Own Keys (BYOK) &amp; Multi-Tenant Routing
          </h2>
        </div>
        <label className="row tiny" style={{ gap: "0.5rem", cursor: "pointer" }}>
          <span className={policy?.byokAllowed ? "strong" : "muted"}>Allow BYOK for users</span>
          <button
            type="button"
            role="switch"
            aria-checked={policy?.byokAllowed ?? true}
            aria-label="Allow users to bring their own API keys"
            className="switch"
            disabled={saving || !policy}
            onClick={togglePolicy}
          />
        </label>
      </div>

      <p className="tiny muted" style={{ margin: "-0.25rem 0 1rem" }}>
        Users can choose in their personal User Settings whether to use Fundur&rsquo;s Platform AI subscription or connect their own private API keys (BYOK). When enabled, each user can plug in their own keys and select models.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "1rem",
          margin: "1rem 0",
        }}
      >
        <div className="card" style={{ padding: "1rem", background: "var(--surface-2)" }}>
          <span className="tiny muted">Platform AI Users</span>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0.25rem 0" }}>
            {policy ? policy.platformUserCount : "—"}
          </div>
          <span className="tiny muted">Using managed auto-models</span>
        </div>

        <div className="card" style={{ padding: "1rem", background: "var(--surface-2)" }}>
          <span className="tiny muted">BYOK Users</span>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, margin: "0.25rem 0", color: "var(--accent)" }}>
            {policy ? policy.byokUserCount : "—"}
          </div>
          <span className="tiny muted">Using private keys</span>
        </div>

        <div className="card" style={{ padding: "1rem", background: "var(--surface-2)" }}>
          <span className="tiny muted">BYOK Policy Status</span>
          <div style={{ fontSize: "1rem", fontWeight: 700, margin: "0.5rem 0", display: "flex", alignItems: "center", gap: 6 }}>
            {policy?.byokAllowed ? (
              <span className="row tiny strong" style={{ color: "var(--good, #22c55e)" }}>
                <Check size={14} /> Allowed
              </span>
            ) : (
              <span className="row tiny strong" style={{ color: "var(--bad)" }}>
                <AlertTriangle size={14} /> Disabled
              </span>
            )}
          </div>
          <span className="tiny muted">All workspaces</span>
        </div>
      </div>

      <div className="row-between wrap" style={{ gap: "0.5rem", marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--line)" }}>
        <span className="tiny muted">
          Users manage their keys in their personal settings screen.
        </span>
        <Link href="/settings/user" className="btn btn-secondary btn-sm">
          Open User AI Settings <ExternalLink size={12} />
        </Link>
      </div>
    </section>
  );
}

