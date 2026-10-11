import { test } from "node:test";
import assert from "node:assert/strict";
import { newProject, completePhase } from "../src/lib/studio/transitions";
import { getWorkflow, listWorkflows } from "../src/lib/workflow";
import { phaseGuidance, phaseAssistantSuggestions } from "../src/lib/workflow/guidance";
import { projectTasks } from "../src/lib/studio/tasks";
import { projectSections } from "../src/lib/studio/project-navigation";
import { DEMO_VIEWER } from "../src/lib/studio/viewer";
import { publishErrors } from "../src/lib/workflow/editor-model";

const create = () => newProject({ id: "ux-pilot", name: "Product pilot", client: "Team", swatch: "sage", workflowId: "ux-product-design", startDate: "2026-10-09" });

test("the second workflow can be selected, edited, scheduled and completed using the shared core", () => {
  assert.ok(listWorkflows().some(w => w.id === "ux-product-design"));
  let project = create();
  const workflow = getWorkflow(project);
  assert.equal(workflow.phases.length, 6);
  assert.deepEqual(publishErrors(workflow).errors, []);
  assert.equal(projectTasks(project).length, 18);
  const paths = projectSections(project, DEMO_VIEWER).map(s => s.href);
  assert.ok(paths.includes("/projects/ux-pilot/forms/research"));
  assert.ok(paths.includes("/projects/ux-pilot/boards/moodboard"));
  assert.ok(!paths.some(p => /\/(plan|layout|regulations|rfqs|brief)$/.test(p)));
  for (const phase of workflow.phases) {
    const blocked = completePhase(project, phase.key);
    assert.equal(blocked, project);
    project = { ...project, checks: { ...project.checks, ...Object.fromEntries(phase.checklist.map(i => [i.id, true])) } };
    assert.equal(phaseGuidance(project, phase.key)?.canComplete, true);
    project = completePhase(project, phase.key);
  }
  assert.equal(project.status, "complete");
});

test("guidance uses saved form facts and gates only on essentials and project state", () => {
  let project = create();
  let guide = phaseGuidance(project, "research")!;
  assert.equal(guide.forms[0].filled, 0);
  assert.equal(guide.openEssentials.length, 3);
  assert.equal(guide.canComplete, false);
  project = { ...project, formValues: { research: { goals: "  Confirmed goal  ", evidence: " \n " } }, checks: Object.fromEntries(guide.openEssentials.map(i => [i.id, true])) };
  guide = phaseGuidance(project, "research")!;
  assert.equal(guide.forms[0].filled, 1);
  assert.equal(guide.forms[0].missing.length, 3);
  assert.equal(guide.canComplete, true, "empty optional form fields are not invented gates");
  assert.equal(phaseGuidance({ ...project, status: "on_hold" }, "research")?.canComplete, false);
  assert.equal(phaseGuidance(project, "strategy")?.canComplete, false);
  assert.equal(phaseGuidance(project, "missing"), null);
  assert.equal(guide.outgoing[0].to, "strategy.context");
});

test("frozen custom definitions drive guidance and phase-specific AI requests", () => {
  const original = create();
  const definition = structuredClone(getWorkflow(original));
  definition.id = "private-process";
  definition.version = 7;
  definition.labels.research = "Evidence log";
  definition.phases[0].name = "Investigate";
  definition.forms[0].fields = [{ key: "source", label: "Source record" }];
  const project = { ...original, workflowId: definition.id, workflowVersion: 7, workflowDefinition: definition, formValues: { research: { source: "Verified source" } } };
  const guide = phaseGuidance(project, "research")!;
  assert.equal(guide.phase.name, "Investigate");
  assert.equal(guide.forms[0].name, "Evidence log");
  assert.equal(guide.forms[0].filled, 1);
  const suggestions = phaseAssistantSuggestions(project, "validation");
  assert.ok(suggestions.some(s => s.prompt.includes("Do not fabricate test sessions")));
  assert.ok(suggestions.every(s => s.prompt.includes("Test & iterate")));
  assert.ok(!suggestions.some(s => /floor area|headcount/i.test(s.prompt)));
  assert.deepEqual(phaseAssistantSuggestions(project, "unknown"), []);
});

test("on-hold projects cannot complete phases even when all essentials are checked", () => {
  const project = create();
  const phase = getWorkflow(project).phases[0];
  const held = { ...project, status: "on_hold" as const, checks: Object.fromEntries(phase.checklist.map(i => [i.id, true])) };
  assert.equal(completePhase(held, phase.key), held);
});

test("the assistant readiness tool reports missing evidence without writing or exposing file storage", async () => {
  await import("../src/lib/ai/tools/project");
  const { getTool } = await import("../src/lib/ai/tools/registry");
  const project = create();
  project.documents = [{ id: "doc-1", name: "Interview notes", phaseKey: "research", kind: "notes", stored: true } as typeof project.documents[number]];
  const before = structuredClone(project);
  const tool = getTool("read_phase_readiness")!;
  const result = await tool.run({ project } as Parameters<typeof tool.run>[0], { phaseKey: "research" });
  assert.match(result.content, /Interview notes/);
  assert.match(result.content, /"canComplete":false/);
  assert.match(result.content, /"filled":0/);
  assert.equal(result.proposals, undefined);
  assert.deepEqual(project, before);
  const missing = await tool.run({ project } as Parameters<typeof tool.run>[0], { phaseKey: "foreign" });
  assert.match(missing.content, /Choose a phase key/);
});
