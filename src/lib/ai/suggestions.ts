import type { Db } from "@/lib/db";
import { modelMaker, type ModelOption, type ProviderId } from "./catalog";
import { addEnabledModel, readRoleModels, saveRoleModel, MODEL_ROLES, type DefaultModel, type ModelRole } from "./settings";

/**
 * Model suggestions (P4-17). Each morning's model list is compared with the
 * one before it; a model that is new and, for a role, either clearly cheaper
 * or newer from the same maker at about the same price, with at least the
 * same capabilities, becomes a suggestion. The Admin accepts it (the role
 * switches to it and it joins the shortlist) or dismisses it.
 */

export type SuggestionKind = "cheaper" | "newer";

export interface SuggestionDraft {
  role: ModelRole;
  provider: ProviderId;
  currentModel: string;
  suggestedModel: string;
  suggestedName: string;
  kind: SuggestionKind;
  reason: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  contextLength: number | null;
}

export interface ModelSuggestion extends SuggestionDraft {
  id: string;
  createdAt: string;
}

/** Cheaper means at most this share of the current price. */
export const CHEAPER_SHARE = 0.8;
/** Newer counts at about the same price: not over this much dearer, nor so cheap it is likely a smaller model. */
export const NEWER_PRICE_RANGE = [0.5, 1.25] as const;

/** A price for comparing: chat sends far more than it gets back, so input weighs three times output. */
export const blendedPrice = (input: number, output: number) => 0.75 * input + 0.25 * output;

const ROLE_NAMES: Record<ModelRole, string> = {
  orchestrator: "top model",
  orchestrator_fallback: "top model fallback",
  worker: "worker model",
  worker_fallback: "worker fallback",
};

const usd = (n: number) => `$${n < 1 ? n.toFixed(2) : n.toFixed(n < 10 ? 2 : 0)}`;
const prices = (i: number, o: number) => `${usd(i)} in / ${usd(o)} out per million tokens`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

/**
 * What a role could switch to among the new models: the dearest of those
 * clearly cheaper, and the newest from the same maker at about the same price.
 * `list` is the provider's whole list, to tell whether it lists capabilities.
 */
export function suggestionsFor(role: ModelRole, current: DefaultModel, provider: ProviderId, fresh: ModelOption[], list: ModelOption[]): SuggestionDraft[] {
  if (current.provider !== provider) return [];
  const known = list.find((m) => m.id === current.model);
  const listsFeatures = list.some((m) => m.features?.length);
  const needs = new Set(known?.features ?? []);
  // The top model plans and calls tools, so a replacement must too.
  if (listsFeatures && role.startsWith("orchestrator")) needs.add("tools");
  const maker = modelMaker(provider, current.model);
  const now = blendedPrice(current.inputUsdPerMTok, current.outputUsdPerMTok);

  const fits = fresh.filter((m) => {
    if (m.id === current.model || m.id.endsWith(":free")) return false;
    if (modelMaker(provider, m.id) !== maker) return false;
    if (m.inputUsdPerMTok == null || m.outputUsdPerMTok == null) return false;
    if ([...needs].some((f) => !m.features?.includes(f as never))) return false;
    if (known?.contextLength && m.contextLength && m.contextLength < known.contextLength) return false;
    if (known?.inputs?.includes("image") && m.inputs && !m.inputs.includes("image")) return false;
    return true;
  });
  const price = (m: ModelOption) => blendedPrice(m.inputUsdPerMTok!, m.outputUsdPerMTok!);
  const draft = (m: ModelOption, kind: SuggestionKind, reason: string): SuggestionDraft => ({
    role,
    provider,
    currentModel: current.model,
    suggestedModel: m.id,
    suggestedName: m.name || m.id,
    kind,
    reason,
    inputUsdPerMTok: m.inputUsdPerMTok!,
    outputUsdPerMTok: m.outputUsdPerMTok!,
    contextLength: m.contextLength ?? null,
  });

  const out: SuggestionDraft[] = [];
  // The dearest of the clearly cheaper ones: the closest to the current model, not a much smaller one.
  const cheaper = fits.filter((m) => now > 0 && price(m) <= now * CHEAPER_SHARE).sort((a, b) => price(b) - price(a))[0];
  if (cheaper) {
    const saving = Math.round((1 - price(cheaper) / now) * 100);
    out.push(
      draft(
        cheaper,
        "cheaper",
        `About ${saving}% cheaper than the ${ROLE_NAMES[role]} (${prices(cheaper.inputUsdPerMTok!, cheaper.outputUsdPerMTok!)} against ${prices(current.inputUsdPerMTok, current.outputUsdPerMTok)}), with the same capabilities.`
      )
    );
  }
  if (known?.created) {
    const newer = fits
      .filter((m) => m.created && m.created > known.created! && price(m) >= now * NEWER_PRICE_RANGE[0] && price(m) <= now * NEWER_PRICE_RANGE[1] && m.id !== cheaper?.id)
      .sort((a, b) => (b.created! > a.created! ? 1 : -1))[0];
    if (newer) {
      const change = now > 0 ? Math.round((price(newer) / now - 1) * 100) : 0;
      const cost = change === 0 ? "at the same price" : change < 0 ? `${-change}% cheaper` : `${change}% dearer`;
      out.push(
        draft(
          newer,
          "newer",
          `Newer from the same maker (listed ${day(newer.created!)}; the ${ROLE_NAMES[role]} is from ${day(known.created)}), ${cost}, with the same capabilities.`
        )
      );
    }
  }
  return out;
}

type Row = {
  id: string;
  role: ModelRole;
  provider: ProviderId;
  current_model: string;
  suggested_model: string;
  suggested_name: string;
  kind: SuggestionKind;
  reason: string;
  input_usd_per_mtok: string | number;
  output_usd_per_mtok: string | number;
  context_length: number | null;
  status: string;
  created_at: Date | string;
};

const toSuggestion = (r: Row): ModelSuggestion => ({
  id: r.id,
  role: r.role,
  provider: r.provider,
  currentModel: r.current_model,
  suggestedModel: r.suggested_model,
  suggestedName: r.suggested_name,
  kind: r.kind,
  reason: r.reason,
  inputUsdPerMTok: Number(r.input_usd_per_mtok),
  outputUsdPerMTok: Number(r.output_usd_per_mtok),
  contextLength: r.context_length,
  createdAt: (r.created_at instanceof Date ? r.created_at : new Date(r.created_at)).toISOString(),
});

/**
 * Keeps suggestions for the models a new list brings. The first list a
 * provider gives has nothing to compare with, so it suggests nothing.
 */
export async function recordSuggestions(db: Db, provider: ProviderId, previous: ModelOption[] | null, next: ModelOption[]): Promise<number> {
  if (!previous) return 0;
  const before = new Set(previous.map((m) => m.id));
  const fresh = next.filter((m) => !before.has(m.id));
  if (!fresh.length) return 0;
  const roles = await readRoleModels(db);
  let made = 0;
  for (const role of MODEL_ROLES) {
    const current = roles[role];
    if (!current) continue;
    for (const s of suggestionsFor(role, current, provider, fresh, next)) {
      const rows = await db.query(
        `INSERT INTO model_suggestions (role, provider, current_model, suggested_model, suggested_name, kind, reason,
           input_usd_per_mtok, output_usd_per_mtok, context_length)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (role, provider, suggested_model) DO NOTHING RETURNING id`,
        [s.role, s.provider, s.currentModel, s.suggestedModel, s.suggestedName.slice(0, 255), s.kind, s.reason, s.inputUsdPerMTok, s.outputUsdPerMTok, s.contextLength]
      );
      made += rows.length;
    }
  }
  return made;
}

/** The suggestions waiting on the Admin, for roles still holding the model they were made against. */
export async function listSuggestions(db: Db): Promise<ModelSuggestion[]> {
  const roles = await readRoleModels(db);
  const rows = await db.query<Row>("SELECT * FROM model_suggestions WHERE status = 'pending' ORDER BY created_at DESC, role");
  return rows
    .map(toSuggestion)
    .filter((s) => roles[s.role]?.provider === s.provider && roles[s.role]?.model === s.currentModel);
}

export class SuggestionGoneError extends Error {}

async function pending(db: Db, id: string): Promise<ModelSuggestion> {
  const [row] = await db.query<Row>("SELECT * FROM model_suggestions WHERE id = $1 AND status = 'pending'", [id]);
  if (!row) throw new SuggestionGoneError("That suggestion has already been dealt with.");
  return toSuggestion(row);
}

/**
 * Switches the role to the suggested model and adds it to the shortlist. The
 * role's other suggestions are dismissed, being about the model it had.
 */
export async function acceptSuggestion(db: Db, id: string, userId: string): Promise<void> {
  const s = await pending(db, id);
  const current = (await readRoleModels(db))[s.role];
  if (!current || current.provider !== s.provider || current.model !== s.currentModel) {
    await resolve(db, id, "dismissed", userId);
    throw new SuggestionGoneError(`The ${ROLE_NAMES[s.role]} has changed since this was suggested.`);
  }
  await addEnabledModel(
    db,
    s.provider,
    { id: s.suggestedModel, name: s.suggestedName, inputUsdPerMTok: s.inputUsdPerMTok, outputUsdPerMTok: s.outputUsdPerMTok, contextLength: s.contextLength ?? undefined },
    userId
  );
  await saveRoleModel(
    db,
    s.role,
    { provider: s.provider, model: s.suggestedModel, inputUsdPerMTok: s.inputUsdPerMTok, outputUsdPerMTok: s.outputUsdPerMTok, zarPerUsd: current.zarPerUsd },
    userId
  );
  await resolve(db, id, "accepted", userId);
  await db.query(
    "UPDATE model_suggestions SET status = 'dismissed', resolved_at = NOW(), resolved_by = $2 WHERE role = $1 AND status = 'pending'",
    [s.role, userId]
  );
}

export async function dismissSuggestion(db: Db, id: string, userId: string): Promise<void> {
  await pending(db, id);
  await resolve(db, id, "dismissed", userId);
}

async function resolve(db: Db, id: string, status: "accepted" | "dismissed", userId: string) {
  await db.query("UPDATE model_suggestions SET status = $2, resolved_at = NOW(), resolved_by = $3 WHERE id = $1", [id, status, userId]);
}
