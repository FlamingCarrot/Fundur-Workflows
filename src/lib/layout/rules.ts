import { z } from "zod";

/**
 * The designer's layout rules (P4-01): workstation sizes, clearances, escape
 * route widths and which teams or rooms belong near each other. A rule set is
 * kept once per workspace and reused on every project; each generated layout
 * keeps a copy of the rules it was made with, so editing the rules later does
 * not quietly change what an earlier option was checked against.
 *
 * Every size is in millimetres.
 */

export type AdjacencyKind = "near" | "apart";

export interface Adjacency {
  /** A team or a room name, as the brief or the plan spells it. */
  a: string;
  b: string;
  kind: AdjacencyKind;
}

export interface LayoutRules {
  /** One workstation. */
  deskWidth: number;
  deskDepth: number;
  /** Desks per group, two rows facing each other: 2, 4, 6, 8 or 10. The generator tries each. */
  groupSizes: number[];
  /** Behind a desk, for the chair and sitting down. */
  chairSpace: number;
  /** Between groups of desks, beyond their chair space. */
  aisle: number;
  /** The main route through the floor and to every door: the escape route. */
  mainRoute: number;
  /** Kept clear in front of each door, on both sides. */
  doorClearance: number;
  /** Kept clear around a column. */
  columnClearance: number;
  /** Around a meeting table, to pull chairs out and walk behind them. */
  tableClearance: number;
  /** The longest walk from a desk to a door. */
  maxTravel: number;
  /** "Near" pairs are met when their closest desks or room are within this. */
  nearWithin: number;
  /** "Apart" pairs are met when they are at least this far apart. */
  apartBeyond: number;
  /** Generic pairs for every project, e.g. the kitchen away from the boardroom. */
  adjacencies: Adjacency[];
}

export interface RuleSet {
  id: string;
  name: string;
  rules: LayoutRules;
  /** Goes up by one with every save. */
  revision: number;
  updatedAt: string;
  updatedBy?: string;
}

/**
 * A starting point, until the working session with the designer replaces it:
 * common South African and international office practice. SANS 10400-T asks
 * for escape routes of at least 1 100 mm and limits travel distance; 1 200 mm
 * and 45 m are used here.
 */
export const DEFAULT_RULES: LayoutRules = {
  deskWidth: 1_400,
  deskDepth: 700,
  groupSizes: [4, 6, 8],
  chairSpace: 750,
  aisle: 900,
  mainRoute: 1_200,
  doorClearance: 1_200,
  columnClearance: 300,
  tableClearance: 1_000,
  maxTravel: 45_000,
  nearWithin: 6_000,
  apartBeyond: 10_000,
  adjacencies: [],
};

export const DEFAULT_RULE_SET_NAME = "Studio standard";

/** How each measurement is named and explained on the rules screen, in order. */
export const RULE_FIELDS: { key: keyof LayoutRules & string; label: string; hint: string; min: number; max: number }[] = [
  { key: "deskWidth", label: "Desk width", hint: "One workstation, side to side", min: 600, max: 3_000 },
  { key: "deskDepth", label: "Desk depth", hint: "Front to back", min: 400, max: 1_500 },
  { key: "chairSpace", label: "Chair space", hint: "Behind each desk, for the chair", min: 500, max: 2_000 },
  { key: "aisle", label: "Aisle", hint: "Between desk groups, beyond the chair space", min: 600, max: 3_000 },
  { key: "mainRoute", label: "Main route", hint: "The escape route through the floor and to each door", min: 900, max: 4_000 },
  { key: "doorClearance", label: "In front of doors", hint: "Kept clear on both sides of every door", min: 500, max: 3_000 },
  { key: "columnClearance", label: "Around columns", hint: "Kept clear around each column", min: 0, max: 1_500 },
  { key: "tableClearance", label: "Around meeting tables", hint: "To pull chairs out and walk behind them", min: 600, max: 2_500 },
  { key: "maxTravel", label: "Longest walk to a door", hint: "From any desk", min: 5_000, max: 200_000 },
  { key: "nearWithin", label: "Near means within", hint: "For teams and rooms that belong together", min: 1_000, max: 50_000 },
  { key: "apartBeyond", label: "Apart means beyond", hint: "For teams and rooms kept away from each other", min: 1_000, max: 100_000 },
];

export const GROUP_SIZES = [2, 4, 6, 8, 10, 12] as const;

const name = z.string().trim().min(1).max(120);

export const adjacencySchema = z.object({ a: name, b: name, kind: z.enum(["near", "apart"]) });

export const rulesSchema = z
  .object({
    ...Object.fromEntries(RULE_FIELDS.map((f) => [f.key, z.number().finite().min(f.min).max(f.max)])),
    groupSizes: z
      .array(z.number().int().refine((n) => (GROUP_SIZES as readonly number[]).includes(n), "Groups hold 2 to 12 desks, in twos"))
      .min(1)
      .max(GROUP_SIZES.length),
    adjacencies: z.array(adjacencySchema).max(200),
  })
  .transform((r) => r as unknown as LayoutRules);

export const ruleSetInput = z.object({ name, rules: rulesSchema });

/** Rules saved by an earlier version, or typed in part, filled out with the defaults. */
export function normalizeRules(input: Partial<LayoutRules> | null | undefined): LayoutRules {
  const out = { ...DEFAULT_RULES, ...(input ?? {}) } as LayoutRules;
  out.groupSizes = [...new Set((out.groupSizes ?? DEFAULT_RULES.groupSizes).filter((n) => (GROUP_SIZES as readonly number[]).includes(n)))].sort(
    (a, b) => a - b
  );
  if (!out.groupSizes.length) out.groupSizes = [...DEFAULT_RULES.groupSizes];
  out.adjacencies = (out.adjacencies ?? []).filter((p) => p && p.a?.trim() && p.b?.trim());
  return out;
}

/** The first problem with a set of rules, in words; null when they are fine. */
export function rulesProblem(rules: LayoutRules): string | null {
  for (const f of RULE_FIELDS) {
    const v = rules[f.key] as number;
    if (!Number.isFinite(v) || v < f.min || v > f.max) return `${f.label} must be between ${f.min} and ${f.max} mm.`;
  }
  if (!rules.groupSizes.length) return "Choose at least one desk group size.";
  if (rules.apartBeyond <= rules.nearWithin) return "Apart must be further than near.";
  return null;
}

// ---------------------------------------------------------------------------
// Reading the brief
// ---------------------------------------------------------------------------

export interface Department {
  name: string;
  headcount: number;
}

/**
 * Teams and their sizes from the brief's free text, e.g.
 * "Executive (12), Finance (30), Sales: 24, 18 Marketing". Lines without a
 * number are left out; they cannot be seated.
 */
export function parseDepartments(text: string | undefined): Department[] {
  if (!text?.trim()) return [];
  const out: Department[] = [];
  for (const raw of text.split(/[,;\n]+|\s+(?:and|&)\s+/i)) {
    const part = raw.trim().replace(/\.$/, "");
    if (!part) continue;
    // "Finance (30)", "Finance: 30", "Finance - 30 people", or "30 in Finance".
    const after = part.match(/^(.+?)\s*[(:\-–]?\s*(\d{1,4})\s*(?:people|staff|desks|pax|ppl)?\s*\)?$/i);
    const before = after ? null : part.match(/^(\d{1,4})\s*(?:people|staff|desks|pax|ppl)?\s*(?:in|for|x)?\s+(.+)$/i);
    if (!after && !before) continue;
    const [nameText, count] = after ? [after[1], after[2]] : [before![2], before![1]];
    const n = Number(count);
    const cleaned = nameText.replace(/\s+/g, " ").trim();
    if (!cleaned || !Number.isFinite(n) || n <= 0) continue;
    const existing = out.find((d) => d.name.toLowerCase() === cleaned.toLowerCase());
    if (existing) existing.headcount += n;
    else out.push({ name: cleaned.slice(0, 120), headcount: Math.min(n, 5_000) });
  }
  return out;
}

/** The first whole number in the brief's headcount, e.g. "about 140 people" gives 140. */
export function parseHeadcount(text: string | undefined): number | null {
  const m = text?.replace(/(\d)[\s,](?=\d{3}\b)/g, "$1").match(/\d{1,5}/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const NEAR = /\b(?:next to|near(?:by)?|beside|close to|adjacent to|by|alongside|with)\b/i;
const APART = /\b(?:away from|far from|not near|apart from|separate from|separated from|not next to|distant from)\b/i;

const clean = (s: string) =>
  s
    .replace(/^(?:and|also|keep|put|place|seat|have|the)\s+/gi, "")
    .replace(/^(?:the)\s+/i, "")
    .replace(/\b(?:should|must|needs? to|to)\s+(?:be|sit|stay)\b/gi, "")
    .replace(/\b(?:be|sits?|stays?|is|are)\b/gi, "")
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Pairs from the brief's adjacencies, e.g. "Finance next to the boardroom;
 * IT away from reception". Only pairs whose two sides both name a team or a
 * room that exists are kept, matched without regard to case or "the".
 */
export function parseAdjacencies(text: string | undefined, names: string[]): Adjacency[] {
  if (!text?.trim()) return [];
  const out: Adjacency[] = [];
  for (const raw of text.split(/[;\n]+|,\s*(?=[A-Za-z])|\.\s+/)) {
    const part = raw.trim();
    if (!part) continue;
    const apart = part.match(APART);
    const near = apart ? null : part.match(NEAR);
    const hit = apart ?? near;
    if (!hit || hit.index == null) continue;
    const left = clean(part.slice(0, hit.index));
    const right = clean(part.slice(hit.index + hit[0].length));
    const a = matchName(left, names);
    const b = matchName(right, names);
    if (!a || !b || a === b) continue;
    const kind: AdjacencyKind = apart ? "apart" : "near";
    if (!out.some((p) => p.kind === kind && ((p.a === a && p.b === b) || (p.a === b && p.b === a)))) out.push({ a, b, kind });
  }
  return out;
}

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/s\b/g, "");

/** The team or room a phrase names: an exact match first, then one that contains the other. */
export function matchName(phrase: string, names: string[]): string | null {
  const k = key(phrase);
  if (!k) return null;
  const exact = names.find((n) => key(n) === k);
  if (exact) return exact;
  const containing = names.filter((n) => {
    const nk = key(n);
    return nk && (k.includes(nk) || nk.includes(k));
  });
  // The longest name wins, so "Finance" does not match before "Finance admin".
  return containing.sort((x, y) => key(y).length - key(x).length)[0] ?? null;
}
