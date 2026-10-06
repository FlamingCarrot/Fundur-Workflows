import type { Db } from "@/lib/db";
import { decryptSecret, encryptSecret, keyHint } from "@/lib/server/secrets";
import { PROVIDER_IDS, type ModelOption, type ProviderId } from "./providers";

/**
 * The platform's AI settings: one saved key per provider, the shortlist of
 * models, and which model fills each role (P4-09). Keys are stored encrypted
 * and only ever decrypted on the server to make a call. Nothing here returns a
 * key to a caller that sends it to the browser.
 */

export interface ProviderKeyStatus {
  provider: ProviderId;
  saved: boolean;
  /** The last characters of the saved key, e.g. "…a1b2". */
  hint: string | null;
  verifiedAt: string | null;
  /** When the saved key was last checked, and what went wrong if that check failed. */
  checkedAt: string | null;
  checkError: string | null;
}

/**
 * The roles a model can fill. The orchestrator is the top model: the one the
 * designer talks to, which also reviews worker output. Workers do routine
 * tasks. Each has a fallback, used when its model fails.
 */
export const MODEL_ROLES = ["orchestrator", "orchestrator_fallback", "worker", "worker_fallback"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

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
  /** The orchestrator, kept under its old name for the settings page. */
  defaultModel: DefaultModel | null;
  roles: Partial<Record<ModelRole, DefaultModel>>;
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
       verified_at = EXCLUDED.verified_at, updated_by = EXCLUDED.updated_by, updated_at = NOW(),
       checked_at = NOW(), check_error = NULL`,
    [provider, encryptSecret(key), keyHint(key), userId]
  );
}

/** Records a re-check of the saved key: a pass moves its verified date, a failure keeps the reason. */
export async function recordKeyCheck(db: Db, provider: ProviderId, error: string | null): Promise<void> {
  await db.query(
    `UPDATE provider_keys SET checked_at = NOW(), check_error = $2,
       verified_at = CASE WHEN $2::text IS NULL THEN NOW() ELSE verified_at END
     WHERE workspace_id IS NULL AND provider = $1`,
    [provider, error]
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

/** Puts a model in a role. The rand rate is one for the platform, so it is kept the same on every role. */
export async function saveRoleModel(db: Db, role: ModelRole, setting: DefaultModel, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO model_settings (workspace_id, role, provider, model, input_usd_per_mtok, output_usd_per_mtok, zar_per_usd, updated_by)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (role) WHERE workspace_id IS NULL DO UPDATE SET
       provider = EXCLUDED.provider, model = EXCLUDED.model,
       input_usd_per_mtok = EXCLUDED.input_usd_per_mtok, output_usd_per_mtok = EXCLUDED.output_usd_per_mtok,
       zar_per_usd = EXCLUDED.zar_per_usd, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [role, setting.provider, setting.model, setting.inputUsdPerMTok, setting.outputUsdPerMTok, setting.zarPerUsd, userId]
  );
  await db.query("UPDATE model_settings SET zar_per_usd = $1 WHERE workspace_id IS NULL AND zar_per_usd <> $1", [setting.zarPerUsd]);
}

/** Empties a role. The orchestrator cannot be emptied, only replaced. */
export async function clearRoleModel(db: Db, role: Exclude<ModelRole, "orchestrator">): Promise<void> {
  await db.query("DELETE FROM model_settings WHERE workspace_id IS NULL AND role = $1", [role]);
}

/** The orchestrator, which every AI feature used before roles existed. */
export async function saveDefaultModel(db: Db, setting: DefaultModel, userId: string): Promise<void> {
  await saveRoleModel(db, "orchestrator", setting, userId);
}

type RoleRow = {
  role: ModelRole;
  provider: ProviderId;
  model: string;
  input_usd_per_mtok: string | number;
  output_usd_per_mtok: string | number;
  zar_per_usd: string | number;
};

const toSetting = (r: RoleRow): DefaultModel => ({
  provider: r.provider,
  model: r.model,
  inputUsdPerMTok: Number(r.input_usd_per_mtok),
  outputUsdPerMTok: Number(r.output_usd_per_mtok),
  zarPerUsd: Number(r.zar_per_usd),
});

/** Every role that has a model. Read on each call, so a change takes effect on the next one. */
export async function readRoleModels(db: Db): Promise<Partial<Record<ModelRole, DefaultModel>>> {
  const rows = await db.query<RoleRow>(
    `SELECT role, provider, model, input_usd_per_mtok, output_usd_per_mtok, zar_per_usd
     FROM model_settings WHERE workspace_id IS NULL AND role = ANY($1::text[])`,
    [MODEL_ROLES]
  );
  return Object.fromEntries(rows.map((r) => [r.role, toSetting(r)]));
}

export async function readDefaultModel(db: Db): Promise<DefaultModel | null> {
  return (await readRoleModels(db)).orchestrator ?? null;
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
  const roles = await readRoleModels(db);
  const rows = await db.query<{
    provider: ProviderId;
    key_hint: string | null;
    verified_at: Date | string | null;
    checked_at: Date | string | null;
    check_error: string | null;
  }>("SELECT provider, key_hint, verified_at, checked_at, check_error FROM provider_keys WHERE workspace_id IS NULL");
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return {
    keys: PROVIDER_IDS.map((provider) => {
      const row = byProvider.get(provider);
      return {
        provider,
        saved: !!row,
        hint: row?.key_hint ?? null,
        verifiedAt: iso(row?.verified_at ?? null),
        checkedAt: iso(row?.checked_at ?? null),
        checkError: row?.check_error ?? null,
      };
    }),
    defaultModel: roles.orchestrator ?? null,
    roles,
    enabledModels: await listEnabledModels(db),
  };
}

/** How long a stored model list is used before it is fetched again. */
export const MODEL_LIST_MAX_AGE_MS = 24 * 60 * 60_000;

/** The provider's model list as last fetched, with when; null when never fetched. */
export async function readStoredModelList(db: Db, provider: ProviderId): Promise<{ models: ModelOption[]; fetchedAt: string } | null> {
  const [row] = await db.query<{ models: unknown; fetched_at: Date | string }>(
    "SELECT models, fetched_at FROM provider_model_lists WHERE provider = $1",
    [provider]
  );
  if (!row) return null;
  const models = (typeof row.models === "string" ? JSON.parse(row.models) : row.models) as ModelOption[];
  return { models, fetchedAt: iso(row.fetched_at)! };
}

export async function storeModelList(db: Db, provider: ProviderId, models: ModelOption[]): Promise<void> {
  await db.query(
    `INSERT INTO provider_model_lists (provider, models, fetched_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (provider) DO UPDATE SET models = EXCLUDED.models, fetched_at = NOW()`,
    [provider, JSON.stringify(models)]
  );
}

export async function forgetModelList(db: Db, provider: ProviderId): Promise<void> {
  await db.query("DELETE FROM provider_model_lists WHERE provider = $1", [provider]);
}

/** Which roles a model fills, so it is not taken off the shortlist while in use. */
export async function rolesUsing(db: Db, provider: ProviderId, model: string): Promise<ModelRole[]> {
  const roles = await readRoleModels(db);
  return MODEL_ROLES.filter((r) => roles[r]?.provider === provider && roles[r]?.model === model);
}
