import { z } from "zod";
import type { Db } from "@/lib/db";
import { registerTaskType } from "@/lib/ai/routing";
import { runAi, type AiRunResult } from "@/lib/ai/runs";
import type { CompletionRequest } from "@/lib/ai/providers";
import { routeName } from "./events";
import { usageOverview, type Overview } from "./store";

/**
 * The improvement advisor: the AI reads how the app is used, what people
 * reported, and the Admin's customer and competitor research, and says what
 * to improve next and why. The Admin works the list top-down: start it, mark
 * it done or set it aside, and the next one rises.
 */

export const ADVICE_TASK = "usage_advice";

registerTaskType({
  key: ADVICE_TASK,
  label: "Advising what to improve",
  description: "Reading usage, reports and research to rank the next improvements.",
  defaultTier: "top",
  reviewed: false,
});

// ---------------------------------------------------------------------------
// Research notes
// ---------------------------------------------------------------------------

export const RESEARCH_KINDS = ["customer", "competitor", "other"] as const;
export type ResearchKind = (typeof RESEARCH_KINDS)[number];

export interface ResearchNote {
  id: string;
  kind: ResearchKind;
  title: string;
  body: string;
  createdAt: string;
}

export const researchInput = z.object({
  kind: z.enum(RESEARCH_KINDS),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
});

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function listResearch(db: Db): Promise<ResearchNote[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT id, kind, title, body, created_at FROM research_notes ORDER BY created_at DESC LIMIT 200"
  );
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as ResearchKind,
    title: String(r.title),
    body: String(r.body),
    createdAt: iso(r.created_at),
  }));
}

export async function addResearch(db: Db, userId: string, input: z.output<typeof researchInput>): Promise<ResearchNote> {
  const [r] = await db.query<Record<string, unknown>>(
    `INSERT INTO research_notes (kind, title, body, created_by) VALUES ($1, $2, $3, $4)
     RETURNING id, kind, title, body, created_at`,
    [input.kind, input.title, input.body, userId]
  );
  return { id: String(r.id), kind: r.kind as ResearchKind, title: String(r.title), body: String(r.body), createdAt: iso(r.created_at) };
}

export async function deleteResearch(db: Db, id: string): Promise<boolean> {
  const rows = await db.query("DELETE FROM research_notes WHERE id = $1 RETURNING id", [id]);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

export const IMPACTS = ["high", "medium", "low"] as const;
export const EFFORTS = ["small", "medium", "large"] as const;
export const BASES = ["usage", "reports", "customer research", "competitors"] as const;
export const SUGGESTION_STATUSES = ["open", "doing", "done", "dismissed"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number] | "superseded";

export interface Suggestion {
  id: string;
  runId: string;
  rank: number;
  title: string;
  why: string;
  evidence: string;
  impact: (typeof IMPACTS)[number];
  effort: (typeof EFFORTS)[number];
  area: string;
  steps: string[];
  basis: string[];
  status: SuggestionStatus;
  statusChangedAt: string | null;
  createdAt: string;
}

export interface AdvisorRun {
  id: string;
  summary: string;
  periodDays: number;
  model: string | null;
  costZar: number;
  createdAt: string;
  evidence: AdvisorEvidence;
}

function toSuggestion(r: Record<string, unknown>): Suggestion {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    rank: Number(r.rank),
    title: String(r.title),
    why: String(r.why),
    evidence: String(r.evidence ?? ""),
    impact: r.impact as Suggestion["impact"],
    effort: r.effort as Suggestion["effort"],
    area: String(r.area ?? ""),
    steps: Array.isArray(r.steps) ? (r.steps as string[]) : [],
    basis: Array.isArray(r.basis) ? (r.basis as string[]) : [],
    status: r.status as SuggestionStatus,
    statusChangedAt: r.status_changed_at ? iso(r.status_changed_at) : null,
    createdAt: iso(r.created_at),
  };
}

const IMPACT_ORDER = "CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";

/**
 * What the Admin works from: what is under way, then what is still open in
 * rank order (the first of these is "do this next"), then what was finished
 * or set aside.
 */
export async function listSuggestions(db: Db): Promise<{ active: Suggestion[]; finished: Suggestion[] }> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT s.* FROM advisor_suggestions s JOIN advisor_runs r ON r.id = s.run_id
     WHERE s.status <> 'superseded'
     ORDER BY CASE s.status WHEN 'doing' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
       CASE WHEN s.status IN ('done', 'dismissed') THEN s.status_changed_at END DESC NULLS LAST,
       r.created_at DESC, s.rank, ${IMPACT_ORDER.replace("impact", "s.impact")}
     LIMIT 200`
  );
  const all = rows.map(toSuggestion);
  return {
    active: all.filter((s) => s.status === "open" || s.status === "doing"),
    finished: all.filter((s) => s.status === "done" || s.status === "dismissed").slice(0, 50),
  };
}

export async function setSuggestionStatus(
  db: Db,
  id: string,
  status: (typeof SUGGESTION_STATUSES)[number]
): Promise<Suggestion | null> {
  const [r] = await db.query<Record<string, unknown>>(
    `UPDATE advisor_suggestions SET status = $2, status_changed_at = NOW()
     WHERE id = $1 AND status <> 'superseded' RETURNING *`,
    [id, status]
  );
  return r ? toSuggestion(r) : null;
}

export async function latestRun(db: Db): Promise<AdvisorRun | null> {
  const [r] = await db.query<Record<string, unknown>>(
    "SELECT id, summary, period_days, model, cost_zar, created_at, evidence FROM advisor_runs ORDER BY created_at DESC LIMIT 1"
  );
  if (!r) return null;
  return {
    id: String(r.id),
    summary: String(r.summary),
    periodDays: Number(r.period_days),
    model: (r.model as string) ?? null,
    costZar: Number(r.cost_zar),
    createdAt: iso(r.created_at),
    evidence: r.evidence as AdvisorEvidence,
  };
}

// ---------------------------------------------------------------------------
// Evidence and the AI's reading of it
// ---------------------------------------------------------------------------

export interface AdvisorEvidence {
  periodDays: number;
  overview: Overview;
  tickets: { open: number; byModule: { module: string; count: number }[]; recent: { module: string; note: string; status: string }[] };
  research: { kind: string; title: string; body: string }[];
  history: { title: string; status: string; when: string | null }[];
  totals: { users: number; workspaces: number; projects: number };
}

const RESEARCH_CHARS = 24_000;

export async function gatherEvidence(db: Db, periodDays = 30): Promise<AdvisorEvidence> {
  const [overview, byModule, recent, research, history, totals] = await Promise.all([
    usageOverview(db, { days: periodDays }),
    db.query<Record<string, unknown>>(
      `SELECT module_key AS module, COUNT(*) AS count FROM issue_reports
       WHERE status IN ('open', 'in_progress') GROUP BY module_key ORDER BY count DESC`
    ),
    db.query<Record<string, unknown>>(
      `SELECT module_key AS module, note, status FROM issue_reports
       WHERE created_at >= NOW() - make_interval(days => $1) ORDER BY created_at DESC LIMIT 25`,
      [periodDays * 3]
    ),
    listResearch(db),
    db.query<Record<string, unknown>>(
      `SELECT title, status, status_changed_at FROM advisor_suggestions
       WHERE status IN ('done', 'dismissed', 'doing') ORDER BY COALESCE(status_changed_at, created_at) DESC LIMIT 30`
    ),
    db.query<Record<string, unknown>>(
      `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM workspaces) AS workspaces,
         (SELECT COUNT(*) FROM projects) AS projects`
    ),
  ]);

  // Newest research first, until the budget for it is spent.
  let budget = RESEARCH_CHARS;
  const notes: AdvisorEvidence["research"] = [];
  for (const n of research) {
    if (budget <= 0) break;
    const body = n.body.slice(0, budget);
    budget -= body.length;
    notes.push({ kind: n.kind, title: n.title, body });
  }

  return {
    periodDays,
    overview,
    tickets: {
      open: byModule.reduce((sum, r) => sum + Number(r.count), 0),
      byModule: byModule.map((r) => ({ module: String(r.module), count: Number(r.count) })),
      recent: recent.map((r) => ({ module: String(r.module), note: String(r.note).slice(0, 400), status: String(r.status) })),
    },
    research: notes,
    history: history.map((r) => ({
      title: String(r.title),
      status: String(r.status),
      when: r.status_changed_at ? iso(r.status_changed_at).slice(0, 10) : null,
    })),
    totals: { users: Number(totals[0]?.users ?? 0), workspaces: Number(totals[0]?.workspaces ?? 0), projects: Number(totals[0]?.projects ?? 0) },
  };
}

const SYSTEM = `You are the product improvement advisor for Fundur, a workflow SaaS.
Fundur runs projects through modular, AI-assisted workflows. Interior design is the first workflow (projects, phases with step checklists, a brief, documents, a 2D floor plan editor, layout options, tasks, calendar, timeline, an AI assistant); a UX design workflow comes next, and customers will build their own workflows from the same modules. Free and paid plans are coming. The person reading your advice is the founder and platform Admin, who builds the product with an AI coding assistant and wants to always know the single best next thing to improve, and why.

Use four kinds of evidence:
1. usage: the numbers from the app (pages, time on page, scroll, exits, clicks that did nothing, repeated angry clicks, errors, features used, the funnel, returning users).
2. reports: issues people reported in the app.
3. customer research: the Admin's notes from customers.
4. competitors: the Admin's competitor notes, plus what you know about comparable products (for interior design: Houzz Pro, Programa, Studio Designer, Mydoma, DesignFiles, Gather; for workflow tools in general: Monday.com, Asana, Notion, ClickUp). When you rely on your own knowledge rather than the Admin's notes, say so in "evidence" ("general knowledge of ...").

Rules:
- Rank by expected impact on people getting their work done and staying, divided by effort. Prefer small, concrete changes the Admin can ship this week.
- Every suggestion names the page or module it is about and cites the numbers or notes behind it. Never invent numbers; if the data is thin (few users or events), say so and lean on reports, research and comparable products, and suggest how to learn more.
- Do not repeat anything already marked done or dismissed. If something was done recently, say in the summary whether the numbers since then suggest it helped.
- "steps" are 2 to 5 short, plain instructions for what to build or change.
- Write in plain, friendly English for a non-technical founder. No jargon.
- Give 3 to 6 suggestions, best first.

Answer with JSON only, matching the schema.`;

export const adviceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "suggestions"],
  properties: {
    summary: { type: "string", description: "Two or three sentences: what the evidence says overall." },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "evidence", "impact", "effort", "area", "steps", "basis"],
        properties: {
          title: { type: "string", description: "The improvement, as a short instruction." },
          why: { type: "string", description: "Why this matters, in one or two sentences." },
          evidence: { type: "string", description: "The numbers, reports or research behind it." },
          impact: { type: "string", enum: [...IMPACTS] },
          effort: { type: "string", enum: [...EFFORTS] },
          area: { type: "string", description: "The page or module it is about." },
          steps: { type: "array", items: { type: "string" } },
          basis: { type: "array", items: { type: "string", enum: [...BASES] } },
        },
      },
    },
  },
} as const;

const adviceParser = z.object({
  summary: z.string().default(""),
  suggestions: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        why: z.string().default(""),
        evidence: z.string().default(""),
        impact: z.enum(IMPACTS).catch("medium"),
        effort: z.enum(EFFORTS).catch("medium"),
        area: z.string().default("").transform((s) => s.slice(0, 200)),
        steps: z.array(z.string()).default([]),
        basis: z.array(z.string()).default([]),
      })
    )
    .min(1),
});

export type Advice = z.output<typeof adviceParser>;

export function parseAdvice(text: string): Advice {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The AI did not answer with advice");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The AI's advice could not be read");
  }
  const result = adviceParser.safeParse(parsed);
  if (!result.success) throw new Error("The AI's advice was missing its suggestions");
  return { ...result.data, suggestions: result.data.suggestions.slice(0, 8) };
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "n/a");

/** The evidence as the AI reads it: compact, labelled, with page names a person uses. */
export function advicePrompt(e: AdvisorEvidence): string {
  const o = e.overview;
  const t = o.totals;
  const p = o.previous;
  const lines: string[] = [];
  lines.push(`Today: ${new Date().toISOString().slice(0, 10)}. Period: the last ${e.periodDays} days, compared with the ${e.periodDays} days before.`);
  lines.push(`Platform size: ${e.totals.users} accounts, ${e.totals.workspaces} workspaces, ${e.totals.projects} projects. New sign-ups this period: ${o.signups}.`);
  lines.push("", "## Usage");
  lines.push(
    `Active users ${t.activeUsers} (before: ${p.activeUsers}); visits ${t.sessions} (${p.sessions}); page views ${t.pageViews} (${p.pageViews}); ` +
      `clicks ${t.clicks}; actions ${t.actions} (${p.actions}); errors ${t.errors} (${p.errors}); average visit ${t.avgSessionMinutes} min (${p.avgSessionMinutes}). ` +
      `Returning users (active in both periods): ${o.returningUsers}.`
  );
  if (t.pageViews < 50) lines.push("Note: very little usage data so far; treat the numbers as early signals.");
  lines.push("Devices (visits): " + (o.devices.map((d) => `${d.device} ${d.sessions}`).join(", ") || "none"));
  lines.push("Funnel (users): " + o.funnel.map((f) => `${f.step} ${f.users}`).join(" → "));
  lines.push("", "Pages (views, users, avg seconds, avg scroll reached, visits ending here, errors, angry clicks, clicks on things that do nothing):");
  for (const pg of o.pages.slice(0, 25)) {
    lines.push(
      `- ${routeName(pg.route)} [${pg.route}]: ${pg.views} views, ${pg.users} users, ${pg.avgSeconds ?? "?"}s, scroll ${pg.avgScroll == null ? "?" : pct(pg.avgScroll, 1)}, ` +
        `exits ${pg.exits} (${pct(pg.exits, pg.views)}), errors ${pg.errors}, angry ${pg.rageClicks}, dead ${pg.deadClicks}`
    );
  }
  if (o.actions.length) lines.push("", "Features used (times, users): " + o.actions.map((a) => `${a.name} ${a.count}/${a.users}`).join("; "));
  if (o.rageClicks.length) lines.push("", "Angry clicks (3+ in a second): " + o.rageClicks.map((r) => `"${r.target}" on ${routeName(r.route)} ×${r.bursts}`).join("; "));
  if (o.deadClicks.length) lines.push("", "Clicks on things that do nothing: " + o.deadClicks.map((r) => `"${r.target}" on ${routeName(r.route)} ×${r.count}`).join("; "));
  if (o.errors.length) lines.push("", "Errors people hit: " + o.errors.map((r) => `"${r.message.slice(0, 160)}" on ${routeName(r.route)} ×${r.count} (${r.users} users)`).join("; "));

  lines.push("", "## Reports");
  lines.push(`Open reports: ${e.tickets.open}` + (e.tickets.byModule.length ? ` (${e.tickets.byModule.map((m) => `${m.module} ${m.count}`).join(", ")})` : ""));
  for (const r of e.tickets.recent) lines.push(`- [${r.module}, ${r.status}] ${r.note.replace(/\s+/g, " ")}`);

  lines.push("", "## Customer and competitor research (the Admin's notes)");
  if (!e.research.length) lines.push("None yet. Use your general knowledge of comparable products, labelled as such.");
  for (const n of e.research) lines.push(`### ${n.kind}: ${n.title}`, n.body);

  lines.push("", "## Earlier suggestions");
  if (!e.history.length) lines.push("None yet.");
  for (const h of e.history) lines.push(`- ${h.status}${h.when ? ` on ${h.when}` : ""}: ${h.title}`);
  return lines.join("\n");
}

export interface AdviseContext {
  workspaceId: string;
  userId: string;
}

/**
 * Reads the evidence, asks the AI, and stores the ranked suggestions. Older
 * suggestions still waiting are replaced by the new ones; anything under way,
 * done or set aside stays.
 */
export async function generateAdvice(
  db: Db,
  ctx: AdviseContext,
  opts: { periodDays?: number; fetchImpl?: typeof fetch; ai?: (req: Omit<CompletionRequest, "model">) => Promise<AiRunResult> } = {}
): Promise<{ run: AdvisorRun; suggestions: Suggestion[] }> {
  const periodDays = opts.periodDays ?? 30;
  const evidence = await gatherEvidence(db, periodDays);
  const req = { system: SYSTEM, prompt: advicePrompt(evidence), schema: adviceSchema as unknown as Record<string, unknown>, maxTokens: 8_000 };
  const result = opts.ai
    ? await opts.ai(req)
    : await runAi(db, { workspaceId: ctx.workspaceId, projectId: null, userId: ctx.userId, task: ADVICE_TASK, role: "orchestrator" }, req, opts.fetchImpl);
  const advice = parseAdvice(result.text);

  const [run] = await db.query<Record<string, unknown>>(
    `INSERT INTO advisor_runs (summary, period_days, evidence, model, cost_zar, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
    [advice.summary, periodDays, JSON.stringify(evidence), result.model, result.costZar, ctx.userId]
  );
  await db.query("UPDATE advisor_suggestions SET status = 'superseded', status_changed_at = NOW() WHERE status = 'open'");
  await db.query(
    `INSERT INTO advisor_suggestions (run_id, rank, title, why, evidence, impact, effort, area, steps, basis)
     SELECT $1, s.rank, s.title, s.why, s.evidence, s.impact, s.effort, s.area, s.steps, s.basis
     FROM jsonb_to_recordset($2::jsonb) AS s(rank int, title text, why text, evidence text, impact text, effort text,
       area text, steps jsonb, basis jsonb)`,
    [
      run.id,
      JSON.stringify(
        advice.suggestions.map((s, i) => ({ ...s, rank: i + 1, steps: s.steps.slice(0, 8), basis: s.basis.slice(0, 4) }))
      ),
    ]
  );
  const { active } = await listSuggestions(db);
  return {
    run: {
      id: String(run.id),
      summary: advice.summary,
      periodDays,
      model: result.model,
      costZar: result.costZar,
      createdAt: iso(run.created_at),
      evidence,
    },
    suggestions: active,
  };
}
