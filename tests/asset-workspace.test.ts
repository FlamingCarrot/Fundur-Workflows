import { test } from "node:test";
import assert from "node:assert/strict";
import { getWorkflow } from "../src/lib/workflow";
import { newProject } from "../src/lib/studio/transitions";
import { DEMO_VIEWER } from "../src/lib/studio/viewer";
import { projectSections } from "../src/lib/studio/project-navigation";
import { moduleTarget } from "../src/components/modules/moduleTarget";
import { workflowAvailability } from "../src/lib/workflow/availability";
import { moduleAccess, PLANS } from "../src/lib/billing/plans";
import { systemPrompt } from "../src/lib/ai/orchestrator";
import { enabledTools } from "../src/lib/ai/tools/registry";
import "../src/lib/ai/tools/game-assets";

const project = () => newProject({ id: "artist", name: "Asset production", client: "Artist", swatch: "sage", workflowId: "indie-game-development", startDate: "2026-10-16" });

test("new game workflows use a separate asset module, while pinned first-edition projects keep their original definitions", () => {
  const wf = getWorkflow("indie-game-development");
  assert.equal(wf.version, 2);
  assert.ok(wf.phases.find(p => p.key === "asset_design")!.modules.includes("game_asset_studio"));
  assert.ok(!wf.phases.some(p => p.modules.some(m => m.startsWith("floor_plan_editor"))));
  assert.ok(getWorkflow({ workflowId: wf.id, workflowVersion: 1 }).phases.find(p => p.key === "asset_design")!.modules.includes("floor_plan_editor:game_assets"));
  assert.equal(workflowAvailability(wf, DEMO_VIEWER).unavailable.length, 0);
});

test("both legacy and new asset module links open the asset workspace, never the technical plan", () => {
  const p = project();
  assert.equal(moduleTarget(p, "game_asset_studio").href, "/projects/artist/assets");
  assert.equal(moduleTarget(p, "floor_plan_editor:game_assets").href, "/projects/artist/assets");
  assert.ok(projectSections(p, DEMO_VIEWER).some(s => s.href.endsWith("/assets")));
  assert.ok(!projectSections(p, DEMO_VIEWER).some(s => s.href.endsWith("/plan")));
});

test("asset assistance has asset-production context without injecting an empty architectural plan", () => {
  const p = project();
  const prompt = systemPrompt(p, null);
  assert.match(prompt, /reusable blueprint mesh modeler/);
  assert.ok(!prompt.includes("<plan>"));
  const legacy = { ...p, workflowVersion: 1, workflowDefinition: getWorkflow({ workflowId: p.workflowId, workflowVersion: 1 }) };
  assert.ok(!systemPrompt(legacy, null).includes("<plan>"));
});

test("the dedicated asset module preserves modeling entitlements and disabled engine access", () => {
  for (const plan of Object.values(PLANS)) assert.equal(moduleAccess(plan.limits, "game_asset_studio"), moduleAccess(plan.limits, "floor_plan_editor"));
  assert.equal(moduleAccess({ ...PLANS.paid.limits, modules: { ...PLANS.paid.limits.modules, floor_plan_editor: "full", game_asset_studio: "none" } }, "game_asset_studio"), "none");
  assert.ok(!enabledTools({ ai: true, design: true, sharing: true, layout: true, floor_plan: false }).some(t => t.module === "game_asset_studio"));
});
