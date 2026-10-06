import { test } from "node:test";
import assert from "node:assert/strict";
import definition from "../src/lib/workflow/definitions/interior-design-corporate.json";
import { validateWorkflowDefinition } from "../src/lib/workflow/validator";
import { getWorkflow, getForm, label } from "../src/lib/workflow";

const clone = () => JSON.parse(JSON.stringify(definition));

test("the interior design definition is valid", () => {
  const result = validateWorkflowDefinition(definition);
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("a definition that fails the schema is rejected with a readable message", () => {
  const def = clone();
  def.phases = [];
  const result = validateWorkflowDefinition(def);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /phases: Workflow must have at least one phase/);
});

test("a module that is not in the library is reported, not accepted", () => {
  const def = clone();
  def.phases[1].modules.push("budget_tracker");
  const result = validateWorkflowDefinition(def);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /module 'budget_tracker', which is not in the module library/);
});

test("a structured form must name a form the workflow defines", () => {
  const def = clone();
  def.phases[0].modules[0] = "structured_form:intake";
  const result = validateWorkflowDefinition(def);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /no form 'intake'/);
});

test("checklist ids must be unique across the workflow", () => {
  const def = clone();
  def.phases[1].checklist[0].id = def.phases[0].checklist[0].id;
  const result = validateWorkflowDefinition(def);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /Checklist item id '.+' is used more than once/);
});

test("handoffs must point at real phases", () => {
  const def = clone();
  def.handoffs.push({ from: "discovery.brief", to: "nowhere.context" });
  const result = validateWorkflowDefinition(def);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /unknown phase 'nowhere'/);
});

test("phases, checklists, forms and labels come from the definition", () => {
  const wf = getWorkflow(definition.id);
  assert.deepEqual(
    wf.phases.map((p) => p.key),
    definition.phases.map((p) => p.key)
  );
  assert.equal(getForm(definition.id, "brief")?.fields.length, definition.forms[0].fields.length);
  assert.equal(label(definition.id, "brief", "Brief"), definition.labels.brief);
});

test("a project stays on the version it started with", () => {
  const wf = getWorkflow({ workflowId: definition.id, workflowVersion: definition.version });
  assert.equal(wf.version, definition.version);
});

test("a project pinned to a version that is not loaded fails instead of running on another", () => {
  assert.throws(() => getWorkflow({ workflowId: definition.id, workflowVersion: 99 }), /version 99 is not loaded/);
});
