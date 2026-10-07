/**
 * Plans and what each one allows. Pure data and pure functions, so the
 * browser, the server and tests read the same rules.
 *
 * There are two plans, Free and Paid. A Paid plan with extra seats is shown
 * as Team; dropping the last extra seat makes it plain Paid again. Nothing
 * here knows about interior design: limits name workflows and modules by
 * their keys, so a new workflow (UX design next) or module is covered by the
 * "*" defaults until a plan says otherwise.
 */

export type PlanKey = "free" | "paid";

/** How much of a module or workflow a plan gets: all of it, its plan limits apply, or none. */
export type Access = "full" | "limited" | "none";

/** Named caps on one module, e.g. the plan editor's { floors: 1, exportDxf: false }. */
export type ModuleLimits = Record<string, number | boolean>;

export interface WorkflowRules {
  /** Whether projects can be started on this workflow. */
  access?: Access;
  /** Module access inside this workflow, over the plan's own module rules. */
  modules?: Record<string, Access>;
  moduleLimits?: Record<string, ModuleLimits>;
}

export interface PlanLimits {
  /** Projects open at once (active or on hold); completed ones don't count. Null is no limit. */
  openProjects: number | null;
  /** Total file storage across projects. */
  storageMb: number | null;
  /** AI spend allowance per calendar month, in US dollars, across the workspace. */
  aiUsdPerMonth: number | null;
  /** People who can work in the workspace, the owner included, before seats are added. */
  includedSeats: number;
  /** Platform features by key. Keys not listed are allowed. */
  features: Record<string, boolean>;
  /** Module access by module key; "*" is every module not listed. */
  modules: Record<string, Access> & { "*": Access };
  /** Caps that apply where a module's access is "limited". */
  moduleLimits: Record<string, ModuleLimits>;
  /** Rules per workflow id; "*" is every workflow not listed. */
  workflows: Record<string, WorkflowRules>;
}

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  /** What it's for, in a line. */
  tagline: string;
  priceUsdMonthly: number;
  /** Price of each seat beyond the included ones; 0 when seats can't be added. */
  seatUsdMonthly: number;
  limits: PlanLimits;
}

/**
 * Platform feature keys. Modules gate their own capabilities with
 * moduleLimits; these are the ones that sit above any one module.
 */
export const FEATURES = {
  customWorkflows: "custom_workflows",
  teamSeats: "team_seats",
  clientPortal: "client_portal",
  templates: "templates",
} as const;

export const FEATURE_LABELS: Record<string, string> = {
  custom_workflows: "Build your own workflows",
  team_seats: "Add team members",
  client_portal: "Client progress pages",
  templates: "Save projects as templates",
};

/** What each module limit means, for plan pages. Keys a module doesn't list here still apply. */
export const MODULE_LIMIT_LABELS: Record<string, Record<string, string>> = {
  floor_plan_editor: {
    floors: "Floors per plan",
    namedVersions: "Named versions per plan",
    exportDxf: "DXF export",
    exportIfc: "IFC export",
    importDxf: "DXF import",
    traceImage: "Trace over a photo or scan",
  },
};

export const PLANS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: "free",
    name: "Free",
    tagline: "One project at a time, with the core of every workflow.",
    priceUsdMonthly: 0,
    seatUsdMonthly: 0,
    limits: {
      openProjects: 1,
      storageMb: 1024,
      aiUsdPerMonth: 1,
      includedSeats: 1,
      features: {
        custom_workflows: false,
        team_seats: false,
        client_portal: false,
        templates: false,
      },
      modules: {
        "*": "full",
        floor_plan_editor: "limited",
        layout_generator: "none",
        template_export: "none",
        sharing: "none",
      },
      moduleLimits: {
        floor_plan_editor: {
          floors: 1,
          namedVersions: 3,
          exportDxf: false,
          exportIfc: false,
          importDxf: false,
          traceImage: false,
        },
      },
      workflows: { "*": { access: "full" } },
    },
  },
  paid: {
    key: "paid",
    name: "Paid",
    tagline: "Everything, for as many projects as you run.",
    priceUsdMonthly: 20,
    seatUsdMonthly: 5,
    limits: {
      openProjects: null,
      storageMb: 50 * 1024,
      aiUsdPerMonth: 10,
      includedSeats: 1,
      features: {},
      modules: { "*": "full" },
      moduleLimits: {},
      workflows: { "*": { access: "full" } },
    },
  },
};

/** Everything, with no caps: the platform Admin and the open demo. */
export const UNLIMITED: PlanLimits = {
  ...PLANS.paid.limits,
  storageMb: null,
  aiUsdPerMonth: null,
  includedSeats: 1000,
};

export type DiscountKind = "percent" | "amount";

export interface Discount {
  kind: DiscountKind;
  /** Percent off (0-100) or US dollars off each month. */
  value: number;
  /** Last day it applies; null is for as long as the plan runs. */
  until: string | null;
  note?: string | null;
}

/** A workspace's subscription as stored. Dates are ISO strings. */
export interface Subscription {
  plan: PlanKey;
  /** Seats bought beyond the plan's included ones. More than 0 on Paid makes it a Team plan. */
  extraSeats: number;
  /** Paid until this moment, when bought or assigned for a set time; null runs until changed. */
  paidUntil: string | null;
  /** Free months given by the Admin: Paid at no charge until this moment. */
  compUntil: string | null;
  discount: Discount | null;
  /** Who set it: the Admin, the payment provider, or nobody yet. */
  source: "default" | "admin" | "provider" | "code";
}

export const DEFAULT_SUBSCRIPTION: Subscription = {
  plan: "free",
  extraSeats: 0,
  paidUntil: null,
  compUntil: null,
  discount: null,
  source: "default",
};

/** Why the plan in force is what it is. */
export type PlanReason = "subscription" | "free_months" | "beta" | "admin" | "demo" | "lapsed" | "free";

export interface EffectivePlan {
  key: PlanKey;
  /** "Free", "Paid" or "Team", as people see it. */
  label: string;
  reason: PlanReason;
  limits: PlanLimits;
  /** Seats including the owner. */
  seats: number;
  /** What it would cost each month, after any discount; 0 while free months or beta apply. */
  monthlyUsd: number;
  /** The list price before discounts, for showing the saving. */
  listUsd: number;
  /** When the paid time runs out, if it does. */
  endsAt: string | null;
  subscription: Subscription;
}

const after = (iso: string | null, now: Date) => iso != null && new Date(iso).getTime() > now.getTime();

/** The list price of a subscription: the plan plus its extra seats. */
export function listPrice(sub: Subscription): number {
  const plan = PLANS[sub.plan];
  return plan.priceUsdMonthly + (plan.seatUsdMonthly ? sub.extraSeats * plan.seatUsdMonthly : 0);
}

/** The monthly price after a discount that is still running. */
export function discountedPrice(sub: Subscription, now: Date = new Date()): number {
  const list = listPrice(sub);
  const d = sub.discount;
  if (!d || (d.until && new Date(d.until).getTime() < now.getTime())) return list;
  const off = d.kind === "percent" ? (list * Math.min(100, Math.max(0, d.value))) / 100 : d.value;
  return Math.max(0, Math.round((list - off) * 100) / 100);
}

export function planLabel(key: PlanKey, extraSeats: number): string {
  if (key === "paid" && extraSeats > 0) return "Team";
  return PLANS[key].name;
}

/**
 * The plan in force for a workspace. Free months and paid time make it Paid
 * until they run out, then it falls back to Free (seats and all) without
 * anyone touching it. While the beta is on, every workspace gets Paid.
 */
export function resolvePlan(
  sub: Subscription,
  opts: { now?: Date; beta?: boolean; admin?: boolean; demo?: boolean } = {}
): EffectivePlan {
  const now = opts.now ?? new Date();
  const extra = Math.max(0, sub.extraSeats);
  const base = { subscription: sub };

  if (opts.admin || opts.demo) {
    return {
      ...base,
      key: "paid",
      label: "Paid",
      reason: opts.admin ? "admin" : "demo",
      limits: UNLIMITED,
      seats: UNLIMITED.includedSeats,
      monthlyUsd: 0,
      listUsd: 0,
      endsAt: null,
    };
  }

  if (sub.plan === "paid") {
    const comped = after(sub.compUntil, now);
    const running = sub.paidUntil == null || after(sub.paidUntil, now);
    if (comped || running) {
      return {
        ...base,
        key: "paid",
        label: planLabel("paid", extra),
        reason: comped ? "free_months" : "subscription",
        limits: PLANS.paid.limits,
        seats: PLANS.paid.limits.includedSeats + extra,
        monthlyUsd: comped ? 0 : discountedPrice(sub, now),
        listUsd: listPrice(sub),
        endsAt: comped && sub.paidUntil ? latest(sub.compUntil, sub.paidUntil) : comped ? sub.compUntil : sub.paidUntil,
      };
    }
  }

  if (opts.beta) {
    return {
      ...base,
      key: "paid",
      label: "Paid",
      reason: "beta",
      limits: PLANS.paid.limits,
      // Seats aren't counted while the beta is free.
      seats: UNLIMITED.includedSeats,
      monthlyUsd: 0,
      listUsd: PLANS.paid.priceUsdMonthly,
      endsAt: null,
    };
  }

  return {
    ...base,
    key: "free",
    label: "Free",
    reason: sub.plan === "paid" ? "lapsed" : "free",
    limits: PLANS.free.limits,
    seats: PLANS.free.limits.includedSeats,
    monthlyUsd: 0,
    listUsd: 0,
    endsAt: null,
  };
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

/** Adds whole months to a date, keeping the day where the month has it. */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

// ---------------------------------------------------------------------------
// Questions screens and routes ask
// ---------------------------------------------------------------------------

const moduleKey = (ref: string) => ref.split(":")[0];

/** Whether a platform feature is on. Features a plan doesn't mention are on. */
export function hasFeature(limits: PlanLimits, feature: string): boolean {
  return limits.features[feature] ?? true;
}

/** Whether projects can be started on a workflow. */
export function workflowAccess(limits: PlanLimits, workflowId: string): Access {
  return limits.workflows[workflowId]?.access ?? limits.workflows["*"]?.access ?? "full";
}

/** How much of a module the plan gets, inside a workflow when one is given. */
export function moduleAccess(limits: PlanLimits, moduleRef: string, workflowId?: string): Access {
  const key = moduleKey(moduleRef);
  if (workflowId && workflowAccess(limits, workflowId) === "none") return "none";
  const inWorkflow = workflowId ? limits.workflows[workflowId]?.modules?.[key] : undefined;
  return inWorkflow ?? limits.workflows["*"]?.modules?.[key] ?? limits.modules[key] ?? limits.modules["*"];
}

/**
 * A module's cap, e.g. moduleLimit(limits, "floor_plan_editor", "floors").
 * Full access means no cap (true for switches, null for counts); no access
 * means none (false or 0).
 */
export function moduleLimit(
  limits: PlanLimits,
  moduleRef: string,
  name: string,
  workflowId?: string
): number | boolean | null {
  const key = moduleKey(moduleRef);
  const access = moduleAccess(limits, key, workflowId);
  const wf = workflowId ? limits.workflows[workflowId]?.moduleLimits?.[key]?.[name] : undefined;
  const value = wf ?? limits.workflows["*"]?.moduleLimits?.[key]?.[name] ?? limits.moduleLimits[key]?.[name];
  if (access === "full") return typeof value === "number" ? null : true;
  if (access === "none") return typeof value === "number" ? 0 : false;
  return value ?? true;
}

/** True when a switch-type module limit allows it. */
export function moduleAllows(limits: PlanLimits, moduleRef: string, name: string, workflowId?: string): boolean {
  const v = moduleLimit(limits, moduleRef, name, workflowId);
  return v === true || v === null || (typeof v === "number" && v > 0);
}

/** A count-type module limit; null means no cap. */
export function moduleCap(limits: PlanLimits, moduleRef: string, name: string, workflowId?: string): number | null {
  const v = moduleLimit(limits, moduleRef, name, workflowId);
  if (typeof v === "number") return v;
  return v === false ? 0 : null;
}

/** The plan summary the screens get with the signed-in person. */
export interface PlanSummary {
  key: PlanKey;
  label: string;
  reason: PlanReason;
  limits: PlanLimits;
  seats: number;
}

export function summarize(plan: EffectivePlan): PlanSummary {
  return { key: plan.key, label: plan.label, reason: plan.reason, limits: plan.limits, seats: plan.seats };
}

/** What a screen shows when something needs Paid. */
export const UPGRADE_MESSAGE = "This needs the Paid plan.";

// ---------------------------------------------------------------------------
// Plan pages
// ---------------------------------------------------------------------------

export interface IncludedLine {
  text: string;
  included: boolean;
}

const storageText = (mb: number) => (mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB`);

/**
 * What a plan includes, as lines for plan pages, worked out from its limits
 * so a new module or feature shows up without editing the page. `moduleNames`
 * maps module keys to the names people see.
 */
export function describePlan(plan: PlanDefinition, moduleNames: Record<string, string>): IncludedLine[] {
  const l = plan.limits;
  const lines: IncludedLine[] = [
    { text: l.openProjects == null ? "Unlimited projects" : `${l.openProjects} project${l.openProjects === 1 ? "" : "s"} at a time`, included: true },
    { text: l.storageMb == null ? "Unlimited file storage" : `${storageText(l.storageMb)} of file storage`, included: true },
    { text: l.aiUsdPerMonth == null ? "Unlimited AI" : `$${l.aiUsdPerMonth} of AI each month`, included: true },
    {
      text: plan.seatUsdMonthly ? `Team seats, $${plan.seatUsdMonthly} a month each` : "Just you",
      included: plan.seatUsdMonthly > 0,
    },
  ];
  for (const [key, label] of Object.entries(FEATURE_LABELS)) {
    if (key === FEATURES.teamSeats) continue;
    lines.push({ text: label, included: hasFeature(l, key) });
  }
  for (const [key, name] of Object.entries(moduleNames)) {
    const access = moduleAccess(l, key);
    if (access === "full") continue;
    if (access === "none") {
      lines.push({ text: name, included: false });
      continue;
    }
    const labels = Object.entries(MODULE_LIMIT_LABELS[key] ?? {});
    const counts = labels
      .map(([limit, label]) => {
        const v = moduleLimit(l, key, limit);
        return typeof v === "number" ? `${label.toLowerCase()}: ${v}` : null;
      })
      .filter(Boolean);
    lines.push({ text: counts.length ? `${name} (${counts.join(", ")})` : name, included: true });
    for (const [limit, label] of labels) {
      if (moduleLimit(l, key, limit) === false) lines.push({ text: label, included: false });
    }
  }
  if (Object.values(l.modules).every((a) => a === "full") && Object.values(l.features).every(Boolean)) {
    lines.push({ text: "Every workflow, module and tool", included: true });
  }
  return lines;
}
