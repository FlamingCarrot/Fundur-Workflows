import type { Db } from "@/lib/db";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/server/secrets";
import { PROVIDER_IDS, type ModelOption, type ProviderId } from "./providers";

/**
 * The platform's AI settings: one saved key per provider and the default
 * model every AI feature uses until the full model picker (phase 4) exists.
 * Keys are stored encrypted and only ever decrypted on the server to make a
 * call. Nothing here returns a key to a caller that sends it to the browser.
 */

export interface ProviderKeyStatus {
  provider: ProviderId;
  saved: boolean;
  /** The last characters of the saved key, e.g. "…a1b2". */
  hint: string | null;
  verifiedAt: string | null;
}

export interface DefaultModel {
  provider: ProviderId;
  model: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  zarPerUsd: number;
}

/** A model the Admin added to the platform's shortlist. */
export interface EnabledModel {
  provider: ProviderId;
  model: string;
  name: string;
  inputUsdPerMTok: number | null;
  outputUsdPerMTok: number | null;
  contextLength: number | null;
  addedAt: string;
}

export interface AiSettingsStatus {
  keys: ProviderKeyStatus[];
  defaultModel: DefaultModel | null;
  enabledModels: EnabledModel[];
}

const iso = (v: Date | string | null) => (v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString());

/** Saves a key that has already been checked with the provider, replacing any earlier one. */
export async function saveProviderKey(db: Db, provider: ProviderId, key: string, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO provider_keys (workspace_id, provider, encrypted_key, key_hint, verified_at, updated_by)
     VALUES (NULL, $1, $2, $3, NOW(), $4)
     ON CONFLICT (provider) WHERE workspace_id IS NULL DO UPDATE SET
       encrypted_key = EXCLUDED.encrypted_key, key_hint = EXCLUDED.key_hint,
       verified_at = EXCLUDED.verified_at, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [provider, encryptSecret(key), keyHint(key), userId]
  );
}

export async function deleteProviderKey(db: Db, provider: ProviderId): Promise<void> {
  await db.query("DELETE FROM provider_keys WHERE workspace_id IS NULL AND provider = $1", [provider]);
}

/** The saved key in plain text, for making a call on the server. Null when none is saved. */
export async function readProviderKey(db: Db, provider: ProviderId): Promise<string | null> {
  const rows = await db.query<{ encrypted_key: string }>(
    "SELECT encrypted_key FROM provider_keys WHERE workspace_id IS NULL AND provider = $1",
    [provider]
  );
  return rows.length ? decryptSecret(rows[0].encrypted_key) : null;
}

export async function saveDefaultModel(db: Db, setting: DefaultModel, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO model_settings (workspace_id, role, provider, model, input_usd_per_mtok, output_usd_per_mtok, zar_per_usd, updated_by)
     VALUES (NULL, 'default', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (role) WHERE workspace_id IS NULL DO UPDATE SET
       provider = EXCLUDED.provider, model = EXCLUDED.model,
       input_usd_per_mtok = EXCLUDED.input_usd_per_mtok, output_usd_per_mtok = EXCLUDED.output_usd_per_mtok,
       zar_per_usd = EXCLUDED.zar_per_usd, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [setting.provider, setting.model, setting.inputUsdPerMTok, setting.outputUsdPerMTok, setting.zarPerUsd, userId]
  );
}

export async function readDefaultModel(db: Db): Promise<DefaultModel | null> {
  const rows = await db.query<{
    provider: ProviderId;
    model: string;
    input_usd_per_mtok: string | number;
    output_usd_per_mtok: string | number;
    zar_per_usd: string | number;
  }>(
    `SELECT provider, model, input_usd_per_mtok, output_usd_per_mtok, zar_per_usd
     FROM model_settings WHERE workspace_id IS NULL AND role = 'default'`
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    provider: r.provider,
    model: r.model,
    inputUsdPerMTok: Number(r.input_usd_per_mtok),
    outputUsdPerMTok: Number(r.output_usd_per_mtok),
    zarPerUsd: Number(r.zar_per_usd),
  };
}

const num = (v: string | number | null) => (v == null ? null : Number(v));

/** The shortlist, oldest first so it reads in the order models were added. */
export async function listEnabledModels(db: Db): Promise<EnabledModel[]> {
  const rows = await db.query<{
    provider: ProviderId;
    model: string;
    name: string;
    input_usd_per_mtok: string | number | null;
    output_usd_per_mtok: string | number | null;
    context_length: number | null;
    added_at: Date | string;
  }>(
    `SELECT provider, model, name, input_usd_per_mtok, output_usd_per_mtok, context_length, added_at
     FROM enabled_models WHERE workspace_id IS NULL ORDER BY added_at, model`
  );
  return rows.map((r) => ({
    provider: r.provider,
    model: r.model,
    name: r.name,
    inputUsdPerMTok: num(r.input_usd_per_mtok),
    outputUsdPerMTok: num(r.output_usd_per_mtok),
    contextLength: r.context_length,
    addedAt: iso(r.added_at)!,
  }));
}

/** Adds a model from the provider's list to the shortlist, refreshing its name and prices if it is already there. */
export async function addEnabledModel(db: Db, provider: ProviderId, option: ModelOption, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO enabled_models (workspace_id, provider, model, name, input_usd_per_mtok, output_usd_per_mtok, context_length, added_by)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (provider, model) WHERE workspace_id IS NULL DO UPDATE SET
       name = EXCLUDED.name, input_usd_per_mtok = EXCLUDED.input_usd_per_mtok,
       output_usd_per_mtok = EXCLUDED.output_usd_per_mtok, context_length = EXCLUDED.context_length`,
    [
      provider,
      option.id,
      option.name.slice(0, 255),
      option.inputUsdPerMTok ?? null,
      option.outputUsdPerMTok ?? null,
      option.contextLength ?? null,
      userId,
    ]
  );
}

export async function removeEnabledModel(db: Db, provider: ProviderId, model: string): Promise<void> {
  await db.query("DELETE FROM enabled_models WHERE workspace_id IS NULL AND provider = $1 AND model = $2", [provider, model]);
}

/** What the settings page shows: which keys are saved (never the keys), the shortlist and the default model. */
export async function readAiSettings(db: Db): Promise<AiSettingsStatus> {
  const rows = await db.query<{ provider: ProviderId; key_hint: string | null; verified_at: Date | string | null }>(
    "SELECT provider, key_hint, verified_at FROM provider_keys WHERE workspace_id IS NULL"
  );
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return {
    keys: PROVIDER_IDS.map((provider) => {
      const row = byProvider.get(provider);
      return { provider, saved: !!row, hint: row?.key_hint ?? null, verifiedAt: iso(row?.verified_at ?? null) };
    }),
    defaultModel: await readDefaultModel(db),
    enabledModels: await listEnabledModels(db),
  };
}
