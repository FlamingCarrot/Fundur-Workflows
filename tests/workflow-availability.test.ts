import { test } from "node:test";
import assert from "node:assert/strict";
import { getWorkflow } from "../src/lib/workflow";
import { workflowAvailability } from "../src/lib/workflow/availability";
import { DEMO_VIEWER } from "../src/lib/studio/viewer";

test("availability uses pinned workflow labels and deduplicates tools across phases", () => {
  const workflow = getWorkflow("ux-product-design");
  const report = workflowAvailability(workflow, DEMO_VIEWER);
  assert.equal(report.unavailable.length, 0);
  assert.equal(report.aiActions, 6);
  assert.equal(report.aiEnabled, true);
  assert.equal(report.modules.filter(m => m.ref === "documents").length, 1);
  assert.equal(report.modules.find(m => m.ref === "canvas_board:moodboard")?.name, "Interface references");
});

test("disabled features and restricted roles explain access without changing workflow gates", () => {
  const workflow = structuredClone(getWorkflow("interior-design-corporate"));
  const before = structuredClone(workflow);
  workflow.phases[0].modules.push("ai_chat", "sharing", "comments");
  const report = workflowAvailability(workflow, { ...DEMO_VIEWER, workspaceRole: "collaborator", features: { ai: true, floor_plan: false, layout: true, design: false, sharing: true } });
  assert.equal(report.aiEnabled, false);
  for (const key of ["ai_chat", "sharing", "comments", "floor_plan_editor:floor_plan", "layout_generator", "canvas_board:moodboard", "item_register:register"])
    assert.equal(report.modules.find(m => m.ref === key)?.available, false, key);
  assert.equal(report.modules.find(m => m.ref === "documents")?.available, true);
  assert.deepEqual(workflow.phases.map(p => p.checklist), before.phases.map(p => p.checklist));
  const unknown = workflowAvailability({ ...workflow, phases: [{ ...workflow.phases[0], modules: ["unshipped_module"] }] }, DEMO_VIEWER);
  assert.match(unknown.unavailable[0].reason!, /not available yet/);
});
