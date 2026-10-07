import type { Db } from "@/lib/db";
import {
  addMonths,
  DEFAULT_SUBSCRIPTION,
  PLANS,
  planLabel,
  resolvePlan,
  type Discount,
  type EffectivePlan,
  type PlanKey,
  type Subscription,
} from "./plans";

/**
 * Subscriptions in the database: reading the plan in force, what a workspace
 * uses against it, and the Admin's changes. Every change is logged with who
 * made it, so the Admin can see a workspace's history.
 */

export class BillingError extends Error {}

interface SubscriptionRow {
  plan: string;
  extra_seats: number;
  paid_until: Date | string | null;
  comp_until: Date | string | null;
  discount: Discount | null;
  source: string;
}

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

function toSubscription(row: SubscriptionRow | undefined): Subscription {
  if (!row) return { ...DEFAULT_SUBSCRIPTION };
  return {
    plan: row.plan === "paid" ? "paid" : "free",
    extraSeats: Number(row.extra_seats) || 0,
    paidUntil: iso(row.paid_until),
    compUntil: iso(row.comp_until),
    discount: row.discount ?? null,
    source: (["admin", "provider", "code"].includes(row.source) ? row.source : "default") as Subscription["source"],
  };
}

export async function readSubscription(db: Db, workspaceId: string): Promise<Subscription> {
  const [row] = await db.query<SubscriptionRow>(
    "SELECT plan, extra_seats, paid_until, comp_until, discount, source FROM subscriptions WHERE workspace_id = $1",
    [workspaceId]
  );
  return toSubscription(row);
}

export interface BillingSettings {
  /** While on, every workspace gets Paid at no charge. */
  betaAllPaid: boolean;
}

export async function readBillingSettings(db: Db): Promise<BillingSettings> {
  const [row] = await db.query<{ beta_all_paid: boolean }>("SELECT beta_all_paid FROM billing_settings LIMIT 1");
  return { betaAllPaid: row?.beta_all_paid ?? true };
}

export async function saveBillingSettings(db: Db, settings: BillingSettings, actor: string): Promise<BillingSettings> {
  await db.query(
    `INSERT INTO billing_settings (id, beta_all_paid, updated_by, updated_at) VALUES (TRUE, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET beta_all_paid = EXCLUDED.beta_all_paid, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [settings.betaAllPaid, actor]
  );
  return settings;
}

/** The plan in force for a workspace. The platform Admin always has everything. */
export async function planFor(
  db: Db,
  workspaceId: string,
  opts: { admin?: boolean; now?: Date } = {}
): Promise<EffectivePlan> {
  const [sub, settings] = await Promise.all([readSubscription(db, workspaceId), readBillingSettings(db)]);
  return resolvePlan(sub, { beta: settings.betaAllPaid, admin: opts.admin, now: opts.now });
}

/** The plan in force for a workspace, as it applies to this person (the Admin has everything). */
export async function planForUser(db: Db, workspaceId: string, userId: string): Promise<EffectivePlan> {
  const [user] = await db.query<{ platform_role: string }>("SELECT platform_role FROM users WHERE id = $1", [userId]);
  return planFor(db, workspaceId, { admin: user?.platform_role === "admin" });
}

export interface Usage {
  openProjects: number;
  storageBytes: number;
  /** AI spend this calendar month (UTC), in US dollars. */
  aiUsdThisMonth: number;
  /** People in the workspace, the owner included; clients don't take a seat. */
  members: number;
}

export async function readUsage(db: Db, workspaceId: string): Promise<Usage> {
  const [row] = await db.query<{ projects: string; storage: string; ai: string; members: string }>(
    `SELECT
       (SELECT COUNT(*) FROM projects WHERE workspace_id = $1 AND status IN ('active', 'on_hold')) AS projects,
       (SELECT COALESCE(SUM(size_bytes), 0) FROM document_versions WHERE workspace_id = $1) AS storage,
       (SELECT COALESCE(SUM(cost_usd), 0) FROM ai_runs
          WHERE workspace_id = $1 AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS ai,
       (SELECT COUNT(*) FROM memberships WHERE workspace_id = $1 AND role <> 'client') AS members`,
    [workspaceId]
  );
  return {
    openProjects: Number(row?.projects ?? 0),
    storageBytes: Number(row?.storage ?? 0),
    aiUsdThisMonth: Math.round(Number(row?.ai ?? 0) * 10000) / 10000,
    members: Number(row?.members ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

async function writeSubscription(db: Db, workspaceId: string, sub: Subscription, actor: string | null): Promise<void> {
  await db.query(
    `INSERT INTO subscriptions (workspace_id, plan, extra_seats, paid_until, comp_until, discount, source, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (workspace_id) DO UPDATE SET plan = EXCLUDED.plan, extra_seats = EXCLUDED.extra_seats,
       paid_until = EXCLUDED.paid_until, comp_until = EXCLUDED.comp_until, discount = EXCLUDED.discount,
       source = EXCLUDED.source, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [workspaceId, sub.plan, sub.extraSeats, sub.paidUntil, sub.compUntil, sub.discount ? JSON.stringify(sub.discount) : null, sub.source, actor]
  );
}

async function logEvent(
  db: Db,
  workspaceId: string,
  kind: string,
  summary: string,
  detail: Record<string, unknown>,
  actor: string | null
): Promise<void> {
  await db.query(
    "INSERT INTO subscription_events (workspace_id, kind, summary, detail, actor) VALUES ($1, $2, $3, $4, $5)",
    [workspaceId, kind, summary, JSON.stringify(detail), actor]
  );
}

const day = (iso: string) => iso.slice(0, 10);
const later = (a: Date, b: string | null) => (b && new Date(b) > a ? new Date(b) : a);

/** Free months of Paid: no charge until they run out, then back to where it was (Free, unless it was Paid). */
export function withFreeMonths(sub: Subscription, months: number, now: Date = new Date()): Subscription {
  const compUntil = addMonths(later(now, sub.compUntil), months).toISOString();
  if (sub.plan !== "paid") return { ...sub, plan: "paid", compUntil, paidUntil: compUntil };
  const paidUntil = sub.paidUntil && new Date(sub.paidUntil) < new Date(compUntil) ? compUntil : sub.paidUntil;
  return { ...sub, compUntil, paidUntil };
}

export type AdminChange =
  /** Puts the workspace on a plan; for Paid, for a number of months or until changed (null). */
  | { type: "assign"; plan: PlanKey; months: number | null; extraSeats?: number }
  | { type: "freeMonths"; months: number }
  | { type: "discount"; kind: Discount["kind"]; value: number; months: number | null; note?: string | null }
  | { type: "clearDiscount" }
  | { type: "seats"; extraSeats: number };

function describe(change: AdminChange, next: Subscription): string {
  switch (change.type) {
    case "assign":
      if (change.plan === "free") return "Moved to Free";
      return `Assigned ${planLabel("paid", next.extraSeats)}${change.months ? ` for ${change.months} month${change.months === 1 ? "" : "s"}` : ", no end date"}`;
    case "freeMonths":
      return `Gave ${change.months} free month${change.months === 1 ? "" : "s"} (until ${day(next.compUntil!)})`;
    case "discount": {
      const what = change.kind === "percent" ? `${change.value}% off` : `$${change.value} off a month`;
      return `Discount: ${what}${change.months ? ` for ${change.months} month${change.months === 1 ? "" : "s"}` : ""}`;
    }
    case "clearDiscount":
      return "Removed the discount";
    case "seats":
      return `Extra seats set to ${change.extraSeats}${change.extraSeats > 0 ? " (Team)" : ""}`;
  }
}

/** Applies a change to a subscription. Pure, so the rules are tested without a database. */
export function applyChange(sub: Subscription, change: AdminChange, now: Date = new Date()): Subscription {
  switch (change.type) {
    case "assign":
      if (change.plan === "free") {
        return { ...sub, plan: "free", extraSeats: 0, paidUntil: null, compUntil: null, source: "admin" };
      }
      return {
        ...sub,
        plan: "paid",
        extraSeats: change.extraSeats ?? sub.extraSeats,
        paidUntil: change.months ? addMonths(now, change.months).toISOString() : null,
        source: "admin",
      };
    case "freeMonths":
      return { ...withFreeMonths(sub, change.months, now), source: sub.source === "provider" ? "provider" : "admin" };
    case "discount":
      return {
        ...sub,
        discount: {
          kind: change.kind,
          value: change.value,
          until: change.months ? addMonths(now, change.months).toISOString() : null,
          note: change.note ?? null,
        },
      };
    case "clearDiscount":
      return { ...sub, discount: null };
    case "seats":
      if (change.extraSeats > 0 && sub.plan !== "paid") {
        throw new BillingError("Seats can only be added to a Paid plan. Assign Paid first.");
      }
      return { ...sub, extraSeats: change.extraSeats };
  }
}

/** The Admin changes a workspace's subscription. */
export async function adminChange(
  db: Db,
  workspaceId: string,
  change: AdminChange,
  actor: string,
  now: Date = new Date()
): Promise<Subscription> {
  const [exists] = await db.query("SELECT 1 FROM workspaces WHERE id = $1", [workspaceId]);
  if (!exists) throw new BillingError("That account no longer exists");
  const next = applyChange(await readSubscription(db, workspaceId), change, now);
  await writeSubscription(db, workspaceId, next, actor);
  await logEvent(db, workspaceId, change.type, describe(change, next), change as Record<string, unknown>, actor);
  return next;
}

/**
 * Sets the extra seats the owner pays for. Above 0 the plan shows as Team;
 * back to 0 it is plain Paid. Seats can't drop below the people already in it.
 */
export async function setSeats(db: Db, workspaceId: string, extraSeats: number, actor: string): Promise<Subscription> {
  const sub = await readSubscription(db, workspaceId);
  const { members } = await readUsage(db, workspaceId);
  const needed = Math.max(0, members - PLANS.paid.limits.includedSeats);
  if (extraSeats < needed) {
    throw new BillingError(`${members} people are in this workspace, so it needs at least ${needed} extra seat${needed === 1 ? "" : "s"}. Remove someone first.`);
  }
  const next = applyChange(sub, { type: "seats", extraSeats });
  await writeSubscription(db, workspaceId, next, actor);
  await logEvent(db, workspaceId, "seats", describe({ type: "seats", extraSeats }, next), { extraSeats }, actor);
  return next;
}

/** Throws when adding one more person would go past the seats the plan has. For the team invite flow. */
export async function assertSeatAvailable(db: Db, workspaceId: string, opts: { admin?: boolean } = {}): Promise<void> {
  const [plan, usage] = await Promise.all([planFor(db, workspaceId, opts), readUsage(db, workspaceId)]);
  if (usage.members + 1 > plan.seats) {
    throw new BillingError(
      plan.key === "free"
        ? "Adding team members needs the Paid plan."
        : `All ${plan.seats} seats are taken. Add a seat ($${PLANS.paid.seatUsdMonthly}/month) to invite someone else.`
    );
  }
}

// ---------------------------------------------------------------------------
// The Admin's accounts list
// ---------------------------------------------------------------------------

export interface AccountRow {
  workspaceId: string;
  workspace: string;
  owner: { name: string | null; email: string | null } | null;
  plan: EffectivePlan;
  usage: Usage;
  createdAt: string;
}

export async function listAccounts(db: Db, opts: { query?: string; limit?: number } = {}): Promise<AccountRow[]> {
  const q = opts.query?.trim() ? `%${opts.query.trim().toLowerCase()}%` : null;
  const rows = await db.query<{
    id: string;
    name: string;
    created_at: Date | string;
    owner_name: string | null;
    owner_email: string | null;
    plan: string | null;
    extra_seats: number | null;
    paid_until: Date | string | null;
    comp_until: Date | string | null;
    discount: Discount | null;
    source: string | null;
    owner_admin: boolean;
  }>(
    `SELECT w.id, w.name, w.created_at, u.name AS owner_name, u.email AS owner_email,
       s.plan, s.extra_seats, s.paid_until, s.comp_until, s.discount, s.source,
       COALESCE(u.platform_role = 'admin', FALSE) AS owner_admin
     FROM workspaces w
     LEFT JOIN LATERAL (
       SELECT user_id FROM memberships m WHERE m.workspace_id = w.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1
     ) o ON TRUE
     LEFT JOIN users u ON u.id = o.user_id
     LEFT JOIN subscriptions s ON s.workspace_id = w.id
     WHERE $1::text IS NULL OR LOWER(w.name) LIKE $1 OR LOWER(COALESCE(u.email, '')) LIKE $1 OR LOWER(COALESCE(u.name, '')) LIKE $1
     ORDER BY w.created_at DESC
     LIMIT $2`,
    [q, Math.min(opts.limit ?? 200, 500)]
  );
  const settings = await readBillingSettings(db);
  return Promise.all(
    rows.map(async (r) => {
      const sub = r.plan
        ? toSubscription({
            plan: r.plan,
            extra_seats: r.extra_seats ?? 0,
            paid_until: r.paid_until,
            comp_until: r.comp_until,
            discount: r.discount,
            source: r.source ?? "default",
          })
        : { ...DEFAULT_SUBSCRIPTION };
      return {
        workspaceId: r.id,
        workspace: r.name,
        owner: r.owner_email || r.owner_name ? { name: r.owner_name, email: r.owner_email } : null,
        plan: resolvePlan(sub, { beta: settings.betaAllPaid, admin: r.owner_admin }),
        usage: await readUsage(db, r.id),
        createdAt: new Date(r.created_at).toISOString(),
      };
    })
  );
}

export interface SubscriptionEvent {
  id: string;
  kind: string;
  summary: string;
  actor: string | null;
  createdAt: string;
}

export async function listEvents(db: Db, workspaceId: string, limit = 50): Promise<SubscriptionEvent[]> {
  const rows = await db.query<{ id: string; kind: string; summary: string; actor: string | null; created_at: Date | string }>(
    `SELECT e.id, e.kind, e.summary, COALESCE(u.email, e.actor) AS actor, e.created_at
     FROM subscription_events e LEFT JOIN users u ON u.id = e.actor
     WHERE e.workspace_id = $1 ORDER BY e.created_at DESC LIMIT $2`,
    [workspaceId, limit]
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, actor: r.actor, createdAt: new Date(r.created_at).toISOString() }));
}

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

export interface PromoCode {
  id: string;
  code: string;
  kind: "free_months" | "percent" | "amount";
  value: number;
  months: number | null;
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: string | null;
  active: boolean;
  note: string | null;
  createdAt: string;
}

export interface NewPromoCode {
  code: string;
  kind: PromoCode["kind"];
  value: number;
  months?: number | null;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
  note?: string | null;
}

export const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

interface CodeRow {
  id: string;
  code: string;
  kind: PromoCode["kind"];
  value: string | number;
  months: number | null;
  max_redemptions: number | null;
  redemptions: string | number;
  expires_at: Date | string | null;
  active: boolean;
  note: string | null;
  created_at: Date | string;
}

const toCode = (r: CodeRow): PromoCode => ({
  id: r.id,
  code: r.code,
  kind: r.kind,
  value: Number(r.value),
  months: r.months,
  maxRedemptions: r.max_redemptions,
  redemptions: Number(r.redemptions),
  expiresAt: iso(r.expires_at),
  active: r.active,
  note: r.note,
  createdAt: new Date(r.created_at).toISOString(),
});

const CODE_COLUMNS = `c.id, c.code, c.kind, c.value, c.months, c.max_redemptions, c.expires_at, c.active, c.note, c.created_at,
  (SELECT COUNT(*) FROM promo_redemptions r WHERE r.code_id = c.id) AS redemptions`;

export async function listCodes(db: Db): Promise<PromoCode[]> {
  return (await db.query<CodeRow>(`SELECT ${CODE_COLUMNS} FROM promo_codes c ORDER BY c.created_at DESC`)).map(toCode);
}

export async function createCode(db: Db, input: NewPromoCode, actor: string): Promise<PromoCode> {
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new BillingError("Codes are 3 to 40 letters, numbers, - or _");
  const rows = await db.query<{ id: string }>(
    `INSERT INTO promo_codes (code, kind, value, months, max_redemptions, expires_at, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (code) DO NOTHING RETURNING id`,
    [code, input.kind, input.value, input.months ?? null, input.maxRedemptions ?? null, input.expiresAt ?? null, input.note ?? null, actor]
  );
  if (!rows.length) throw new BillingError(`The code ${code} already exists`);
  const [row] = await db.query<CodeRow>(`SELECT ${CODE_COLUMNS} FROM promo_codes c WHERE c.id = $1`, [rows[0].id]);
  return toCode(row);
}

export async function setCodeActive(db: Db, id: string, active: boolean): Promise<boolean> {
  const rows = await db.query("UPDATE promo_codes SET active = $2 WHERE id = $1 RETURNING id", [id, active]);
  return rows.length > 0;
}

/** Someone enters a code on their plan page. Each workspace can use a code once. */
export async function redeemCode(
  db: Db,
  workspaceId: string,
  rawCode: string,
  userId: string,
  now: Date = new Date()
): Promise<{ summary: string; subscription: Subscription }> {
  const code = normalizeCode(rawCode);
  const [row] = await db.query<CodeRow>(`SELECT ${CODE_COLUMNS} FROM promo_codes c WHERE c.code = $1`, [code]);
  const c = row && toCode(row);
  if (!c || !c.active || (c.expiresAt && new Date(c.expiresAt) < now)) throw new BillingError("That code isn't valid");
  const claimed = await db.query(
    `INSERT INTO promo_redemptions (code_id, workspace_id, redeemed_by)
     SELECT $1, $2, $3
     WHERE (SELECT max_redemptions FROM promo_codes WHERE id = $1) IS NULL
        OR (SELECT COUNT(*) FROM promo_redemptions WHERE code_id = $1) < (SELECT max_redemptions FROM promo_codes WHERE id = $1)
     ON CONFLICT (code_id, workspace_id) DO NOTHING
     RETURNING code_id`,
    [c.id, workspaceId, userId]
  );
  if (!claimed.length) {
    const [mine] = await db.query("SELECT 1 FROM promo_redemptions WHERE code_id = $1 AND workspace_id = $2", [c.id, workspaceId]);
    throw new BillingError(mine ? "You've already used this code" : "This code has been used up");
  }
  const sub = await readSubscription(db, workspaceId);
  let next: Subscription;
  let summary: string;
  if (c.kind === "free_months") {
    const months = Math.max(1, Math.round(c.value));
    next = { ...withFreeMonths(sub, months, now), source: sub.source === "provider" ? "provider" : "code" };
    summary = `${months} free month${months === 1 ? "" : "s"} of Paid, until ${day(next.compUntil!)}`;
  } else {
    next = {
      ...sub,
      discount: {
        kind: c.kind,
        value: c.value,
        until: c.months ? addMonths(now, c.months).toISOString() : null,
        note: `Code ${c.code}`,
      },
    };
    const what = c.kind === "percent" ? `${c.value}% off` : `$${c.value} off a month`;
    summary = `${what}${c.months ? ` for ${c.months} month${c.months === 1 ? "" : "s"}` : ""}`;
  }
  await writeSubscription(db, workspaceId, next, userId);
  await logEvent(db, workspaceId, "code", `Used code ${c.code}: ${summary}`, { codeId: c.id }, userId);
  return { summary, subscription: next };
}
