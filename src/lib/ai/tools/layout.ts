import { z } from "zod";
import { checkLayout } from "@/lib/layout/check";
import { generateLayouts } from "@/lib/layout/generate";
import { layoutItems, withLayout } from "@/lib/layout/options";
import { parseAdjacencies, parseDepartments, parseHeadcount } from "@/lib/layout/rules";
import { listRuleSets } from "@/lib/layout/store";
import { levelOf, onLevel, type Plan } from "@/lib/plan/geometry";
import { getPlanState } from "@/lib/plan/store";
import { registerTool } from "./registry";

/**
 * The layout generator (P4-02 to P4-05) as assistant tools: reading the
 * options kept on the plan, and laying a floor out with her rules to talk
 * through. Options are kept and chosen on the Layout options page, where she
 * sees them drawn; these tools change nothing.
 */

const m2 = (n: number) => `${n.toFixed(1)} m²`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function floorFor(plan: Plan, floor?: string) {
  if (!floor?.trim()) return plan.levels[0];
  const wanted = floor.trim().toLowerCase();
  return plan.levels.find((l) => l.name.toLowerCase() === wanted) ?? plan.levels.find((l) => l.name.toLowerCase().includes(wanted)) ?? null;
}

registerTool({
  name: "read_layouts",
  module: "layout_generator",
  label: "Reading the layout options",
  description:
    "Reads the layout options kept on the floor plan: per option its score, desks, area per desk, circulation and rule breaks, which one is chosen, and the notes on why.",
  input: z.object({}),
  async run(ctx) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    const plan = state?.plan;
    if (!plan) return { content: "No floor plan has been drawn or imported for this project yet, so there are no layout options." };
    if (!plan.layouts.length) return { content: "No layout options have been made yet. They are made on the project's Layout options page." };
    const lines: string[] = [];
    for (const layout of plan.layouts) {
      const shown = withLayout(plan, layout);
      const report = checkLayout(onLevel(shown, layout.levelId), { rules: layout.rules, headcount: layout.headcount, adjacencies: layout.adjacencies });
      const m = report.metrics;
      lines.push(
        `${layout.name}${layout.chosen ? " (chosen)" : ""}, ${levelOf(plan, layout.levelId).name}, rules "${layout.ruleSetName}": score ${m.score}/100; ` +
          `${m.desks} desks${m.headcount ? ` for ${m.headcount} people` : ""}; usable ${m2(m.usableArea)}; ` +
          `${m.areaPerDesk != null ? `${m2(m.areaPerDesk)} per desk; ` : ""}circulation ${pct(m.circulation)}; ` +
          `${report.issues.length} rule break${report.issues.length === 1 ? "" : "s"}; ${layoutItems(plan, layout).length} items.`
      );
      if (layout.summary) lines.push(`  ${layout.summary}`);
      for (const issue of report.issues.slice(0, 5)) lines.push(`  - ${issue.message}`);
      if (layout.notes) lines.push(`  Notes: "${layout.notes}"`);
    }
    return { content: lines.join("\n") };
  },
});

registerTool({
  name: "try_layouts",
  module: "layout_generator",
  label: "Laying out the floor",
  description:
    "Lays out desks for the brief's people and teams on a floor of the plan with the designer's layout rules, three to five ways, and returns each option's score and measures. " +
    "Nothing is saved: to keep options she makes them on the Layout options page. Use it to answer how many desks fit, or how the rules change the result.",
  input: z.object({
    floor: z.string().max(120).optional().describe("The floor's name; the first floor when left out."),
    ruleSet: z.string().max(120).optional().describe("The rule set's name; her first set when left out."),
    headcount: z.number().int().min(1).max(10_000).optional().describe("People to seat; the brief's headcount when left out."),
  }),
  async run(ctx, input) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    const plan = state?.plan;
    if (!plan) return { content: "No floor plan has been drawn or imported for this project yet." };
    const level = floorFor(plan, input.floor);
    if (!level) return { content: `There is no floor called "${input.floor}". The floors are: ${plan.levels.map((l) => l.name).join(", ")}.` };
    const sets = await listRuleSets(ctx.db, ctx.run.workspaceId, ctx.run.userId);
    const set = input.ruleSet ? sets.find((s) => s.name.toLowerCase() === input.ruleSet!.trim().toLowerCase()) : sets[0];
    if (!set) return { content: `There is no rule set called "${input.ruleSet}". The sets are: ${sets.map((s) => s.name).join(", ")}.` };

    const brief = ctx.project.brief;
    const departments = parseDepartments(brief.departments);
    const roomNames = plan.rooms.filter((r) => r.levelId === level.id).map((r) => r.name);
    const adjacencies = [...parseAdjacencies(brief.adjacencies, [...departments.map((d) => d.name), ...roomNames]), ...set.rules.adjacencies];
    const result = generateLayouts(plan, level.id, {
      rules: set.rules,
      ruleSetName: set.name,
      headcount: input.headcount ?? parseHeadcount(brief.headcount),
      departments,
      adjacencies,
    });
    if (!result.ok) return { content: result.error };
    const lines = [`${level.name} laid out with "${set.name}" (nothing saved):`];
    result.options.forEach((o, i) => {
      const m = o.report.metrics;
      const met = m.adjacencies.filter((a) => a.met).length;
      lines.push(
        `${i + 1}. Score ${m.score}/100. ${o.option.summary} Area per desk ${m.areaPerDesk != null ? m2(m.areaPerDesk) : "n/a"}; circulation ${pct(m.circulation)}` +
          `${m.adjacencies.length ? `; ${met} of ${m.adjacencies.length} near/apart pairs met` : ""}; ${o.report.issues.length} rule breaks.`
      );
    });
    for (const note of result.notes) lines.push(`Note: ${note}`);
    return { content: lines.join("\n") };
  },
});
