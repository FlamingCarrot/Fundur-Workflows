import type { Db } from "@/lib/db";
import type { ModelOption, ProviderId } from "./catalog";
import { blendedPrice } from "./suggestions";
import {
  listEnabledModels,
  readAiSettings,
  readProviderKey,
  readRoleModels,
  readStoredModelList,
  MODEL_ROLES,
  type DefaultModel,
  type EnabledModel,
  type ModelRole,
} from "./settings";

/**
 * Automatic model choice. With it on (the default), the Admin only keeps the
 * shortlist: every AI call uses the best model on it for its role, worked out
 * afresh on each call, so adding or removing a model takes effect at once.
 *
 * The top model is the most capable model that can call tools; the worker is
 * the cheapest capable one. Each fallback is the next best, from another
 * provider when there is one, so one provider failing does not stop the work.
 */

export interface AutoPick extends DefaultModel {
  role: ModelRole;
  name: string;
  /** Why it was picked, in a sentence. */
  reason: string;
}

/** A model on the shortlist, with what its provider's list says about it. */
interface Candidate {
  enabled: EnabledModel;
  option?: ModelOption;
}

const DEFAULT_ZAR_PER_USD = 18;

/** How capable a model is from its name: 3 for flagship, 1 for small and fast models, 2 otherwise. */
export function nameTier(id: string, name = ""): 1 | 2 | 3 {
  const s = `${id} ${name}`.toLowerCase();
  if (/(^|[^a-z])(mini|nano|haiku|lite|small|tiny|fast|instant)([^a-z]|$)|(^|[^a-z0-9])\d{1,2}b([^a-z]|$)/.test(s)) return 1;
  if (/(opus|fable|[-\s]pro\b|-pro-|ultra|gpt-5|\bo3\b|grok-4|large|max\b|405b)/.test(s)) return 3;
  return 2;
}

const price = (c: Candidate) => blendedPrice(c.enabled.inputUsdPerMTok ?? 0, c.enabled.outputUsdPerMTok ?? 0);
const released = (c: Candidate) => c.option?.created ?? c.enabled.addedAt;
const canUseTools = (c: Candidate) => !c.option?.features || !c.option.features.length || c.option.features.includes("tools");

/** Most capable first: name tier, then reasoning, then the newer, then the dearer (price follows capability within a tier). */
export function byCapability(a: Candidate, b: Candidate): number {
  const tier = nameTier(b.enabled.model, b.enabled.name) - nameTier(a.enabled.model, a.enabled.name);
  if (tier) return tier;
  const reasons = Number(!!b.option?.features?.includes("reasoning")) - Number(!!a.option?.features?.includes("reasoning"));
  if (reasons) return reasons;
  const newer = released(b).localeCompare(released(a));
  if (newer) return newer;
  return price(b) - price(a);
}

/** Cheapest first, newest breaking ties; free models count only when nothing priced is left. */
function byCost(a: Candidate, b: Candidate): number {
  const free = Number(a.enabled.model.endsWith(":free")) - Number(b.enabled.model.endsWith(":free"));
  if (free) return free;
  return price(a) - price(b) || released(b).localeCompare(released(a));
}

/** The next pick in `ranked` other than `taken`, from another provider than `avoid` when one exists. */
function nextBest(ranked: Candidate[], taken: Candidate, avoid: ProviderId): Candidate | undefined {
  const rest = ranked.filter((c) => c !== taken);
  return rest.find((c) => c.enabled.provider !== avoid) ?? rest[0];
}

const pick = (c: Candidate, role: ModelRole, zarPerUsd: number, reason: string): AutoPick => ({
  role,
  provider: c.enabled.provider,
  model: c.enabled.model,
  name: c.enabled.name || c.enabled.model,
  inputUsdPerMTok: c.enabled.inputUsdPerMTok ?? 0,
  outputUsdPerMTok: c.enabled.outputUsdPerMTok ?? 0,
  zarPerUsd,
  reason,
});

/**
 * The best model for each role among `candidates`. Pure, so the choice can be
 * tested and shown on the settings page exactly as calls will make it.
 */
export function choose(candidates: Candidate[], zarPerUsd = DEFAULT_ZAR_PER_USD): AutoPick[] {
  const usable = candidates.filter(canUseTools);
  if (!usable.length) return [];
  const capable = [...usable].sort(byCapability);
  const top = capable[0];
  const picks: AutoPick[] = [pick(top, "orchestrator", zarPerUsd, "The most capable model on the shortlist that can use tools.")];
  const topFallback = nextBest(capable, top, top.enabled.provider);
  if (topFallback) picks.push(pick(topFallback, "orchestrator_fallback", zarPerUsd, "The next most capable, kept for when the top model fails."));

  // Workers do routine work, so the cheapest model that is not one of the small ones it would be unwise to trust,
  // or the cheapest of all when only small ones are cheaper than the top model.
  const cheap = [...usable].sort(byCost).filter((c) => c !== top || usable.length === 1);
  const sturdy = cheap.filter((c) => nameTier(c.enabled.model, c.enabled.name) >= 2 && price(c) < price(top));
  const worker = sturdy[0] ?? cheap[0];
  if (worker && worker !== top) {
    picks.push(pick(worker, "worker", zarPerUsd, "The cheapest capable model on the shortlist, for routine tasks the top model reviews."));
    const workerFallback = nextBest(cheap.filter((c) => c !== top), worker, worker.enabled.provider);
    if (workerFallback) picks.push(pick(workerFallback, "worker_fallback", zarPerUsd, "The next cheapest, kept for when the worker fails."));
  }
  return picks;
}

const SETTING = "auto_models";

/** Whether models are chosen automatically. On unless the Admin turned it off. */
export async function isAutoModels(db: Db): Promise<boolean> {
  const [row] = await db.query<{ value: unknown }>("SELECT value FROM ai_platform_settings WHERE key = $1", [SETTING]);
  if (!row) return true;
  const value = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return (value as { enabled?: boolean })?.enabled !== false;
}

export async function setAutoModels(db: Db, enabled: boolean, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO ai_platform_settings (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [SETTING, JSON.stringify({ enabled }), userId]
  );
}

/** The automatic picks from the shortlist, counting only providers with a saved key. */
export async function autoPicks(db: Db): Promise<AutoPick[]> {
  const enabled = await listEnabledModels(db);
  if (!enabled.length) return [];
  const providers = [...new Set(enabled.map((m) => m.provider))];
  const withKey = new Set<ProviderId>();
  const lists = new Map<ProviderId, ModelOption[]>();
  for (const p of providers) {
    if (!(await readProviderKey(db, p).catch(() => null))) continue;
    withKey.add(p);
    lists.set(p, (await readStoredModelList(db, p))?.models ?? []);
  }
  const candidates = enabled
    .filter((m) => withKey.has(m.provider))
    .map((m) => ({ enabled: m, option: lists.get(m.provider)?.find((o) => o.id === m.model) }));
  const stored = await readRoleModels(db);
  const rate = stored.orchestrator?.zarPerUsd ?? Object.values(stored)[0]?.zarPerUsd ?? DEFAULT_ZAR_PER_USD;
  return choose(candidates, rate);
}

/**
 * The model in each role as calls will use it: the automatic picks when that
 * is on and the shortlist has a usable model, else the roles the Admin set.
 */
export async function effectiveRoleModels(
  db: Db
): Promise<{ roles: Partial<Record<ModelRole, DefaultModel>>; auto: boolean; autoEnabled: boolean; picks: AutoPick[] }> {
  const autoEnabled = await isAutoModels(db);
  if (autoEnabled) {
    const picks = await autoPicks(db);
    if (picks.some((p) => p.role === "orchestrator")) {
      const roles: Partial<Record<ModelRole, DefaultModel>> = {};
      for (const p of picks) {
        const { provider, model, inputUsdPerMTok, outputUsdPerMTok, zarPerUsd } = p;
        roles[p.role] = { provider, model, inputUsdPerMTok, outputUsdPerMTok, zarPerUsd };
      }
      return { roles, auto: true, autoEnabled, picks };
    }
  }
  const roles = await readRoleModels(db);
  return { roles: Object.fromEntries(MODEL_ROLES.filter((r) => roles[r]).map((r) => [r, roles[r]])), auto: false, autoEnabled, picks: [] };
}

/** What the settings page shows: the stored settings, plus the automatic choice and whether it is in effect. */
export async function aiSettingsView(db: Db) {
  const [settings, effective] = await Promise.all([readAiSettings(db), effectiveRoleModels(db)]);
  return { ...settings, auto: { enabled: effective.autoEnabled, active: effective.auto, picks: effective.picks } };
}

export function friendlyModelName(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("3-7-sonnet") || m.includes("3.7-sonnet")) return "Claude 3.7 Sonnet";
  if (m.includes("3-5-sonnet") || m.includes("3.5-sonnet")) return "Claude 3.5 Sonnet";
  if (m.includes("3-5-haiku") || m.includes("3.5-haiku")) return "Claude 3.5 Haiku";
  if (m.includes("3-opus") || m.includes("3.0-opus")) return "Claude 3 Opus";
  if (m === "gpt-4o") return "GPT-4o";
  if (m === "gpt-4o-mini") return "GPT-4o mini";
  if (m.includes("o3-mini")) return "o3-mini (Reasoning)";
  if (m === "o1") return "o1 (Reasoning)";
  if (m.includes("gemini-2.5-pro")) return "Gemini 2.5 Pro";
  if (m.includes("gemini-2.0-flash")) return "Gemini 2.0 Flash";
  if (m.includes("gemini-1.5-pro")) return "Gemini 1.5 Pro";
  if (m.includes("deepseek-r1") || m.includes("deepseek/deepseek-r1")) return "DeepSeek R1";
  return model.split("/").pop()?.replace(/[-_]/g, " ") || model;
}

export interface ChatModelCatalogItem {
  provider: ProviderId;
  model: string;
  name: string;
  isDefault: boolean;
  features?: string[];
  inputUsdPerMTok?: number | null;
  outputUsdPerMTok?: number | null;
}

export interface ChatModelCatalog {
  defaultModel: {
    provider: ProviderId;
    model: string;
    name: string;
  } | null;
  models: ChatModelCatalogItem[];
}

/** Returns all models available for conversations, highlighting the platform default. */
export async function getChatModelCatalog(db: Db): Promise<ChatModelCatalog> {
  const effective = await effectiveRoleModels(db);
  const def = effective.roles.orchestrator;
  const enabled = await listEnabledModels(db);

  // Check which providers have saved and valid keys
  const rows = await db.query<{ provider: ProviderId }>(
    "SELECT provider FROM provider_keys WHERE workspace_id IS NULL AND encrypted_key IS NOT NULL"
  );
  const activeProviders = new Set<ProviderId>(rows.map((r) => r.provider));

  const models: ChatModelCatalogItem[] = [];
  const seen = new Set<string>();

  // Add default model first if its provider is active
  if (def && activeProviders.has(def.provider)) {
    const key = `${def.provider}:${def.model}`;
    seen.add(key);
    models.push({
      provider: def.provider,
      model: def.model,
      name: friendlyModelName(def.model),
      isDefault: true,
      inputUsdPerMTok: def.inputUsdPerMTok,
      outputUsdPerMTok: def.outputUsdPerMTok,
    });
  }

  // Add enabled models from shortlist whose provider has an active key
  for (const m of enabled) {
    if (!activeProviders.has(m.provider)) continue;
    const key = `${m.provider}:${m.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    models.push({
      provider: m.provider,
      model: m.model,
      name: m.name || friendlyModelName(m.model),
      isDefault: def ? def.provider === m.provider && def.model === m.model : false,
      inputUsdPerMTok: m.inputUsdPerMTok,
      outputUsdPerMTok: m.outputUsdPerMTok,
    });
  }

  // Add stored models for active providers
  for (const p of activeProviders) {
    const stored = await readStoredModelList(db, p);
    if (stored?.models) {
      for (const opt of stored.models) {
        const key = `${p}:${opt.id}`;
        if (seen.has(key)) continue;
        if (!opt.outputs || opt.outputs.includes("text")) {
          seen.add(key);
          models.push({
            provider: p,
            model: opt.id,
            name: opt.name || friendlyModelName(opt.id),
            isDefault: def ? def.provider === p && def.model === opt.id : false,
            features: opt.features,
            inputUsdPerMTok: opt.inputUsdPerMTok,
            outputUsdPerMTok: opt.outputUsdPerMTok,
          });
        }
      }
    }
  }

  // Add well-known flagship models for active providers if not already present
  const WELL_KNOWN: Record<ProviderId, { id: string; name: string; inPrice: number; outPrice: number }[]> = {
    anthropic: [
      { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet (Hybrid Reasoning)", inPrice: 3, outPrice: 15 },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", inPrice: 3, outPrice: 15 },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", inPrice: 0.8, outPrice: 4 },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus", inPrice: 15, outPrice: 75 },
    ],
    openai: [
      { id: "gpt-4o", name: "GPT-4o", inPrice: 2.5, outPrice: 10 },
      { id: "gpt-4o-mini", name: "GPT-4o mini", inPrice: 0.15, outPrice: 0.6 },
      { id: "o3-mini", name: "o3-mini (Reasoning)", inPrice: 1.1, outPrice: 4.4 },
      { id: "o1", name: "o1 (Reasoning)", inPrice: 15, outPrice: 60 },
    ],
    gemini: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", inPrice: 1.25, outPrice: 5 },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", inPrice: 0.1, outPrice: 0.4 },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", inPrice: 1.25, outPrice: 5 },
    ],
    xai: [
      { id: "grok-2-1212", name: "Grok 2", inPrice: 2, outPrice: 10 },
      { id: "grok-2-vision-1212", name: "Grok 2 Vision", inPrice: 2, outPrice: 10 },
    ],
    openrouter: [
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1 (OpenRouter)", inPrice: 0.55, outPrice: 2.19 },
      { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (OpenRouter)", inPrice: 3, outPrice: 15 },
      { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B (OpenRouter)", inPrice: 0.12, outPrice: 0.3 },
    ],
  };

  for (const p of activeProviders) {
    const list = WELL_KNOWN[p] ?? [];
    for (const item of list) {
      const key = `${p}:${item.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        models.push({
          provider: p,
          model: item.id,
          name: item.name,
          isDefault: def ? def.provider === p && def.model === item.id : false,
          inputUsdPerMTok: item.inPrice,
          outputUsdPerMTok: item.outPrice,
        });
      }
    }
  }

  return {
    defaultModel: def
      ? {
          provider: def.provider,
          model: def.model,
          name: friendlyModelName(def.model),
        }
      : null,
    models,
  };
}
