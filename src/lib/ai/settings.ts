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
export const MODEL_ROLES = ["orchestrator", "orchestrator_fallback", "worker", "worker_fallback", "image", "image_fallback"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export interface DefaultModel {
  provider: ProviderId;
  model: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  zarPerUsd: number;
  imageUsdPerImage?: number | null;
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
    `INSERT INTO provider_keys (workspace_id, user_id, provider, encrypted_key, key_hint, verified_at, updated_by)
     VALUES (NULL, NULL, $1, $2, $3, NOW(), $4)
     ON CONFLICT (provider) WHERE workspace_id IS NULL AND user_id IS NULL DO UPDATE SET
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
     WHERE workspace_id IS NULL AND (user_id IS NULL OR user_id = '') AND provider = $1`,
    [provider, error]
  );
}

export async function deleteProviderKey(db: Db, provider: ProviderId): Promise<void> {
  await db.query("DELETE FROM provider_keys WHERE workspace_id IS NULL AND (user_id IS NULL OR user_id = '') AND provider = $1", [provider]);
}

/** The saved key in plain text, for making a call on the server. Null when none is saved or when decryption fails. */
export async function readProviderKey(db: Db, provider: ProviderId): Promise<string | null> {
  const rows = await db.query<{ encrypted_key: string }>(
    "SELECT encrypted_key FROM provider_keys WHERE workspace_id IS NULL AND (user_id IS NULL OR user_id = '') AND provider = $1",
    [provider]
  );
  if (!rows.length) return null;
  try {
    return decryptSecret(rows[0].encrypted_key);
  } catch (err) {
    console.warn(`[AI Settings] Failed to decrypt saved key for provider '${provider}':`, (err as Error).message);
    return null;
  }
}

/** Puts a model in a role. The rand rate is one for the platform, so it is kept the same on every role. */
export async function saveRoleModel(db: Db, role: ModelRole, setting: DefaultModel, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO model_settings (workspace_id, role, provider, model, input_usd_per_mtok, output_usd_per_mtok, zar_per_usd, updated_by, image_usd_per_image)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (role) WHERE workspace_id IS NULL DO UPDATE SET
       provider = EXCLUDED.provider, model = EXCLUDED.model,
       input_usd_per_mtok = EXCLUDED.input_usd_per_mtok, output_usd_per_mtok = EXCLUDED.output_usd_per_mtok,
       zar_per_usd = EXCLUDED.zar_per_usd, updated_by = EXCLUDED.updated_by, updated_at = NOW(), image_usd_per_image = EXCLUDED.image_usd_per_image`,
    [role, setting.provider, setting.model, setting.inputUsdPerMTok, setting.outputUsdPerMTok, setting.zarPerUsd, userId, setting.imageUsdPerImage ?? null]
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
  image_usd_per_image: string | number | null;
};

const toSetting = (r: RoleRow): DefaultModel => ({
  provider: r.provider,
  model: r.model,
  inputUsdPerMTok: Number(r.input_usd_per_mtok),
  outputUsdPerMTok: Number(r.output_usd_per_mtok),
  zarPerUsd: Number(r.zar_per_usd),
  ...(r.image_usd_per_image != null ? {imageUsdPerImage:Number(r.image_usd_per_image)}:{}),
});

/** Every role that has a model. Read on each call, so a change takes effect on the next one. */
export async function readRoleModels(db: Db): Promise<Partial<Record<ModelRole, DefaultModel>>> {
  const rows = await db.query<RoleRow>(
    `SELECT role, provider, model, input_usd_per_mtok, output_usd_per_mtok, zar_per_usd, image_usd_per_image
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
  }>("SELECT provider, key_hint, verified_at, checked_at, check_error FROM provider_keys WHERE workspace_id IS NULL AND (user_id IS NULL OR user_id = '')");
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

/* ==============================================================================
 * User BYOK (Bring Your Own Keys) & AI Settings
 * ============================================================================== */

export type UserAiMode = "platform" | "byok";

export interface UserAiSettings {
  mode: UserAiMode;
  autoSelect: boolean;
}

export async function getUserAiSettings(db: Db, userId: string): Promise<UserAiSettings> {
  const rows = await db.query<{ mode: string; auto_select: boolean }>(
    "SELECT mode, auto_select FROM user_ai_settings WHERE user_id = $1",
    [userId]
  ).catch(() => []);
  if (!rows.length) return { mode: "platform", autoSelect: true };
  return {
    mode: rows[0].mode === "byok" ? "byok" : "platform",
    autoSelect: rows[0].auto_select !== false,
  };
}

export async function saveUserAiSettings(
  db: Db,
  userId: string,
  settings: Partial<UserAiSettings>
): Promise<UserAiSettings> {
  const current = await getUserAiSettings(db, userId);
  const nextMode = settings.mode ?? current.mode;
  const nextAuto = settings.autoSelect ?? current.autoSelect;
  await db.query(
    `INSERT INTO user_ai_settings (user_id, mode, auto_select, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       auto_select = EXCLUDED.auto_select,
       updated_at = NOW()`,
    [userId, nextMode, nextAuto]
  );
  return { mode: nextMode, autoSelect: nextAuto };
}

export async function saveUserProviderKey(
  db: Db,
  userId: string,
  provider: ProviderId,
  key: string
): Promise<void> {
  await db.query(
    `INSERT INTO provider_keys (workspace_id, user_id, provider, encrypted_key, key_hint, verified_at, updated_by)
     VALUES (NULL, $1, $2, $3, $4, NOW(), $1)
     ON CONFLICT (user_id, provider) WHERE user_id IS NOT NULL DO UPDATE SET
       encrypted_key = EXCLUDED.encrypted_key, key_hint = EXCLUDED.key_hint,
       verified_at = EXCLUDED.verified_at, updated_by = EXCLUDED.updated_by, updated_at = NOW(),
       checked_at = NOW(), check_error = NULL`,
    [userId, provider, encryptSecret(key), keyHint(key)]
  );
}

export async function deleteUserProviderKey(
  db: Db,
  userId: string,
  provider: ProviderId
): Promise<void> {
  await db.query(
    "DELETE FROM provider_keys WHERE user_id = $1 AND provider = $2",
    [userId, provider]
  );
}

export async function readUserProviderKey(
  db: Db,
  userId: string,
  provider: ProviderId
): Promise<string | null> {
  const rows = await db.query<{ encrypted_key: string }>(
    "SELECT encrypted_key FROM provider_keys WHERE user_id = $1 AND provider = $2",
    [userId, provider]
  );
  if (!rows.length) return null;
  try {
    return decryptSecret(rows[0].encrypted_key);
  } catch (err) {
    console.warn(`[AI Settings] Failed to decrypt user key for provider '${provider}':`, (err as Error).message);
    return null;
  }
}

export async function listUserProviderKeys(
  db: Db,
  userId: string
): Promise<ProviderKeyStatus[]> {
  const rows = await db.query<{
    provider: ProviderId;
    key_hint: string | null;
    verified_at: Date | string | null;
    checked_at: Date | string | null;
    check_error: string | null;
  }>("SELECT provider, key_hint, verified_at, checked_at, check_error FROM provider_keys WHERE user_id = $1", [userId]).catch(() => []);
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDER_IDS.map((p) => {
    const r = byProvider.get(p);
    return {
      provider: p,
      saved: !!r,
      hint: r?.key_hint ?? null,
      verifiedAt: iso(r?.verified_at ?? null),
      checkedAt: iso(r?.checked_at ?? null),
      checkError: r?.check_error ?? null,
    };
  });
}

/** Resolves the effective provider key: uses the user's private BYOK key if they are in BYOK mode, else the platform key. */
export async function readEffectiveProviderKey(
  db: Db,
  provider: ProviderId,
  scope?: { userId?: string; workspaceId?: string }
): Promise<string | null> {
  if (scope?.userId) {
    const userSettings = await getUserAiSettings(db, scope.userId);
    if (userSettings.mode === "byok") {
      const userKey = await readUserProviderKey(db, scope.userId, provider);
      if (userKey) return userKey;
    }
  }
  return readProviderKey(db, provider);
}

export async function getPlatformByokPolicy(db: Db): Promise<{
  byokAllowed: boolean;
  byokUserCount: number;
  platformUserCount: number;
  totalUsers: number;
}> {
  const accessRows = await db.query<{ byok_allowed?: boolean }>(
    "SELECT byok_allowed FROM platform_access LIMIT 1"
  ).catch(() => []);
  const byokAllowed = accessRows[0]?.byok_allowed ?? true;

  const countRows = await db.query<{ mode: string; count: string | number }>(
    "SELECT mode, count(*) as count FROM user_ai_settings GROUP BY mode"
  ).catch(() => []);

  let byokUserCount = 0;
  let platformUserCount = 0;
  for (const r of countRows) {
    if (r.mode === "byok") byokUserCount = Number(r.count);
    else platformUserCount += Number(r.count);
  }

  const userRows = await db.query<{ count: string | number }>("SELECT count(*) as count FROM users").catch(() => []);
  const totalUsers = Number(userRows[0]?.count ?? 0);

  return { byokAllowed, byokUserCount, platformUserCount, totalUsers };
}

export async function setPlatformByokPolicy(db: Db, allowed: boolean): Promise<void> {
  await db.query(
    "UPDATE platform_access SET byok_allowed = $1 WHERE id = TRUE",
    [allowed]
  );
}
