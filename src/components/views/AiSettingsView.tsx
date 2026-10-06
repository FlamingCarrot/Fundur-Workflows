"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, KeyRound, Plus, Search, Sparkles, Trash2 } from "lucide-react";
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
}

interface DefaultModel {
  provider: ProviderId;
  model: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  zarPerUsd: number;
}

interface EnabledModel {
  provider: ProviderId;
  model: string;
  name: string;
  inputUsdPerMTok: number | null;
  outputUsdPerMTok: number | null;
  contextLength: number | null;
}

interface Settings {
  keys: KeyStatus[];
  defaultModel: DefaultModel | null;
  enabledModels: EnabledModel[];
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/**
 * The Admin's AI settings (P1-12): one key per provider, checked before it is
 * saved and never shown again, and the default model every AI feature uses.
 */
export function AiSettingsView({ providers }: { providers: ProviderInfo[] }) {
  const { toast } = useStudio();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderId>(providers[0].id);
  const [models, setModels] = useState<Record<string, ModelOption[]>>({});

  useEffect(() => {
    call<Settings>("/api/admin/ai").then(
      (s) => {
        setSettings(s);
        if (s.defaultModel) setProvider(s.defaultModel.provider);
      },
      (err: Error) => setLoadError(err.message)
    );
  }, []);

  const info = providers.find((p) => p.id === provider)!;
  const keyStatus = settings?.keys.find((k) => k.provider === provider);

  // The model list comes from the provider with the saved key, once per provider.
  const needsModels = !!keyStatus?.saved && !models[provider];
  useEffect(() => {
    if (!needsModels) return;
    const id = provider;
    call<{ models: ModelOption[] }>(`/api/admin/ai/models?provider=${id}`).then(
      ({ models: list }) => setModels((m) => ({ ...m, [id]: list })),
      () => setModels((m) => ({ ...m, [id]: [] }))
    );
  }, [needsModels, provider]);

  const current = settings?.defaultModel;
  const currentName = current ? providers.find((p) => p.id === current.provider)?.name : null;

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin settings</p>
        <h1 className="display-l">AI model</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Add the models the platform may use from each provider, then pick the default every AI feature uses. Keys
          are checked with the provider, stored encrypted on the server and never shown again.
        </p>
      </header>

      {loadError && (
        <div className="card" style={{ padding: "1.25rem 1.4rem", color: "var(--bad)" }}>{loadError}</div>
      )}

      {settings && (
        <>
          <section className="card rise" style={{ padding: "1.25rem 1.4rem", marginBottom: "1.75rem", ["--i" as string]: 1 }}>
            <span className="eyebrow">In use now</span>
            {current ? (
              <div className="row-between wrap" style={{ marginTop: "0.5rem", gap: "0.75rem" }}>
                <div className="stack" style={{ gap: "0.2rem", minWidth: 0 }}>
                  <span className="strong truncate">{current.model}</span>
                  <span className="small muted">
                    {currentName} · US${current.inputUsdPerMTok} in, US${current.outputUsdPerMTok} out per million tokens ·
                    R{current.zarPerUsd} to the dollar
                  </span>
                </div>
                <span className="tag tag-good">
                  <Check size={13} strokeWidth={2.5} /> Ready
                </span>
              </div>
            ) : (
              <p className="small muted" style={{ marginTop: "0.5rem" }}>
                No model yet. Brief drafting needs one. Save a key below, add models, then pick the default.
              </p>
            )}
          </section>

          <div className="segmented rise" role="group" aria-label="Provider" style={{ marginBottom: "1.25rem", ["--i" as string]: 2 }}>
            {providers.map((p) => {
              const saved = settings.keys.find((k) => k.provider === p.id)?.saved;
              return (
                <button key={p.id} type="button" aria-pressed={provider === p.id} onClick={() => setProvider(p.id)}>
                  <span className="row" style={{ gap: "0.25rem", whiteSpace: "nowrap" }}>
                    {p.name}
                    {saved && <Check size={13} strokeWidth={2.5} aria-label="key saved" />}
                  </span>
                </button>
              );
            })}
          </div>

          <KeyCard
            key={provider}
            info={info}
            status={keyStatus}
            onSaved={(s, list) => {
              setSettings(s);
              setModels((m) => ({ ...m, [provider]: list }));
              toast(`${info.name} key checked and saved`);
            }}
            onRemoved={(s) => {
              setSettings(s);
              setModels((m) => ({ ...m, [provider]: [] }));
              toast(`${info.name} key removed`);
            }}
          />

          {keyStatus?.saved && (
            <ModelsCard
              key={`model-${provider}`}
              info={info}
              models={models[provider]}
              enabled={settings.enabledModels.filter((m) => m.provider === provider)}
              current={current?.provider === provider ? current : null}
              onSettings={(s, message) => {
                setSettings(s);
                if (message) toast(message);
              }}
            />
          )}
        </>
      )}
    </main>
  );
}

function KeyCard({
  info,
  status,
  onSaved,
  onRemoved,
}: {
  info: ProviderInfo;
  status: KeyStatus | undefined;
  onSaved: (s: Settings, models: ModelOption[]) => void;
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
      onSaved({ keys: res.keys, defaultModel: res.defaultModel, enabledModels: res.enabledModels }, res.models);
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
    <section className="card rise" style={{ padding: "1.4rem", marginBottom: "1.25rem", ["--i" as string]: 3 }}>
      <div className="row-between wrap" style={{ gap: "0.75rem", marginBottom: showInput ? "1rem" : 0 }}>
        <div className="row" style={{ gap: "0.75rem", minWidth: 0 }}>
          <span className="dropzone-icon" style={{ width: 40, height: 40, margin: 0 }}>
            <KeyRound size={18} />
          </span>
          <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
            <span className="strong">{info.name} key</span>
            <span className="small muted">
              {status?.saved
                ? `Saved key ${status.hint ?? ""}${status.verifiedAt ? `, checked ${shortDate(status.verifiedAt)}` : ""}`
                : "No key saved"}
            </span>
          </div>
        </div>
        {status?.saved && !replacing && (
          <div className="row" style={{ gap: "0.4rem" }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setReplacing(true)} disabled={busy}>
              Replace
            </button>
            <button type="button" className="icon-btn" aria-label={`Remove ${info.name} key`} onClick={remove} disabled={busy}>
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>

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

/**
 * The shortlist of models for one provider, with the default picked from it.
 * The browser adds and removes models; prices are filled in from the
 * provider's list where it has them and can be changed before saving.
 */
function ModelsCard({
  info,
  models,
  enabled,
  current,
  onSettings,
}: {
  info: ProviderInfo;
  models: ModelOption[] | undefined;
  enabled: EnabledModel[];
  current: DefaultModel | null;
  onSettings: (s: Settings, message?: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [listError, setListError] = useState<string | null>(null);

  const [model, setModel] = useState(current?.model ?? "");
  const [inPrice, setInPrice] = useState(current ? String(current.inputUsdPerMTok) : "");
  const [outPrice, setOutPrice] = useState(current ? String(current.outputUsdPerMTok) : "");
  const [zarPerUsd, setZarPerUsd] = useState(current ? String(current.zarPerUsd) : "18");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const added = useMemo(() => new Set(enabled.map((m) => m.model)), [enabled]);

  const pick = (id: string) => {
    setModel(id);
    setError(null);
    if (current?.model === id) {
      setInPrice(String(current.inputUsdPerMTok));
      setOutPrice(String(current.outputUsdPerMTok));
      return;
    }
    // Fill in the prices the provider publishes; the Admin can still change them.
    const row = enabled.find((m) => m.model === id);
    const option = models?.find((m) => m.id === id);
    const input = option?.inputUsdPerMTok ?? row?.inputUsdPerMTok;
    const output = option?.outputUsdPerMTok ?? row?.outputUsdPerMTok;
    setInPrice(input != null ? String(input) : "");
    setOutPrice(output != null ? String(output) : "");
  };

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
      if (removing && model === id) pick(current?.model ?? "");
      // The first model added becomes the one to save as default when there is none yet.
      if (!removing && !model) pick(id);
    } catch (err) {
      setListError((err as Error).message);
    } finally {
      busyWith(id, false);
    }
  };

  const numbers = [inPrice, outPrice, zarPerUsd].map((v) => Number(v));
  const valid = model && numbers.every((n, i) => Number.isFinite(n) && (i === 2 ? n > 0 : n >= 0)) && inPrice !== "" && outPrice !== "";
  const unchanged =
    current?.model === model &&
    current.inputUsdPerMTok === numbers[0] &&
    current.outputUsdPerMTok === numbers[1] &&
    current.zarPerUsd === numbers[2];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSettings(
        await call<Settings>("/api/admin/ai", {
          method: "PUT",
          body: JSON.stringify({
            provider: info.id,
            model,
            inputUsdPerMTok: numbers[0],
            outputUsdPerMTok: numbers[1],
            zarPerUsd: numbers[2],
          }),
        }),
        "Default model saved"
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const browseLabel = !models
    ? "Loading models…"
    : models.length
      ? `Browse ${models.length} models`
      : "No models found for this key";

  return (
    <section className="card rise" style={{ padding: "1.4rem", ["--i" as string]: 4 }}>
      <div className="row-between wrap" style={{ gap: "0.75rem", marginBottom: "1rem" }}>
        <div className="row" style={{ gap: "0.75rem", minWidth: 0 }}>
          <span className="dropzone-icon" style={{ width: 40, height: 40, margin: 0 }}>
            <Sparkles size={18} />
          </span>
          <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
            <span className="strong">{info.name} models</span>
            <span className="small muted">Add the models to use, then pick the default for brief drafting and the assistant.</span>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!models?.length}
          onClick={() => setBrowsing(true)}
        >
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
        <div className="model-list" role="radiogroup" aria-label="Default model">
          {enabled.map((m) => {
            const isCurrent = current?.model === m.model;
            const listed = models?.find((o) => o.id === m.model);
            const gone = models && !listed;
            // The provider's current list wins over what was copied when the model was added.
            const context = listed?.contextLength ?? m.contextLength;
            const input = listed?.inputUsdPerMTok ?? m.inputUsdPerMTok;
            const output = listed?.outputUsdPerMTok ?? m.outputUsdPerMTok;
            return (
              <div key={m.model} className="model-pick" data-selected={model === m.model}>
                <label className="model-pick-main">
                  <input type="radio" name={`default-${info.id}`} checked={model === m.model} onChange={() => pick(m.model)} />
                  <span className="stack" style={{ gap: "0.1rem", minWidth: 0 }}>
                    <span className="row wrap" style={{ gap: "0.4rem" }}>
                      <span className="strong truncate">{listed?.name ?? m.name}</span>
                      {isCurrent && <span className="tag tag-good">Default</span>}
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
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${m.name}`}
                  title={isCurrent ? "This is the default model. Choose another default first." : `Remove ${m.name}`}
                  disabled={isCurrent || pending.has(m.model)}
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

      {model && (
        <div className="stack" style={{ gap: "1rem", marginTop: "1.25rem" }}>
          <div className="row wrap" style={{ gap: "0.75rem" }}>
            <label className="field grow" style={{ minWidth: 140 }}>
              <span className="field-label">Input, US$ per million</span>
              <input className="input" inputMode="decimal" value={inPrice} onChange={(e) => setInPrice(e.target.value)} placeholder="e.g. 4" />
            </label>
            <label className="field grow" style={{ minWidth: 140 }}>
              <span className="field-label">Output, US$ per million</span>
              <input className="input" inputMode="decimal" value={outPrice} onChange={(e) => setOutPrice(e.target.value)} placeholder="e.g. 20" />
            </label>
            <label className="field grow" style={{ minWidth: 120 }}>
              <span className="field-label">Rand per US$</span>
              <input className="input" inputMode="decimal" value={zarPerUsd} onChange={(e) => setZarPerUsd(e.target.value)} />
            </label>
          </div>
          {!info.pricesListed && (
            <p className="tiny muted">{info.name} does not publish prices through its API, so check them on its pricing page.</p>
          )}

          {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-primary" disabled={!valid || busy || unchanged} onClick={save}>
              {busy ? "Saving…" : current?.model === model ? "Save prices" : "Make this the default"}
            </button>
          </div>
        </div>
      )}

      {browsing && models && (
        <ModelBrowser
          info={info}
          models={models}
          added={added}
          pending={pending}
          defaultModel={current?.model ?? null}
          onToggle={(o) => toggleModel(o.id, o.name)}
          onClose={() => setBrowsing(false)}
        />
      )}
    </section>
  );
}
