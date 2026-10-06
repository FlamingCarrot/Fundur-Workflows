import { test } from "node:test";
import assert from "node:assert/strict";
import { reducer, type State } from "../src/components/providers/StudioProvider";
import { makeSeedProjects } from "../src/lib/studio/seed";
import { phaseProgress } from "../src/lib/studio/selectors";
import { getWorkflow } from "../src/lib/workflow";
import type { Project } from "../src/lib/studio/types";

function stateWith(project: Project): State {
  return { ready: true, projects: [project], issues: [] };
}

function discoveryProject(): Project {
  const p = makeSeedProjects().find((x) => x.currentPhase === "discovery")!;
  return { ...p, checks: {} };
}

test("a phase cannot be completed until its essentials are ticked", () => {
  const project = discoveryProject();
  const after = reducer(stateWith(project), { type: "completePhase", projectId: project.id, phaseKey: "discovery" });
  assert.equal(after.projects[0].currentPhase, "discovery");
  assert.deepEqual(after.projects[0].completedPhases, []);
});

test("completing the open phase opens the next one, once", () => {
  const project = discoveryProject();
  const essentials = getWorkflow(project).phases[0].checklist.filter((i) => i.essential);
  const ticked = { ...project, checks: Object.fromEntries(essentials.map((i) => [i.id, true])) };
  let state = reducer(stateWith(ticked), { type: "completePhase", projectId: project.id, phaseKey: "discovery" });
  assert.equal(state.projects[0].currentPhase, "space_planning");
  // A second completion of the same phase (a double click, a stale tab) changes nothing.
  state = reducer(state, { type: "completePhase", projectId: project.id, phaseKey: "discovery" });
  assert.equal(state.projects[0].currentPhase, "space_planning");
  assert.deepEqual(state.projects[0].completedPhases, ["discovery"]);
});

test("a phase with no essential steps is ready straight away", () => {
  const project = discoveryProject();
  const wf = getWorkflow(project);
  const original = wf.phases[0].checklist;
  wf.phases[0].checklist = original.map((i) => ({ ...i, essential: false }));
  try {
    assert.equal(phaseProgress(project, "discovery").ready, true);
  } finally {
    wf.phases[0].checklist = original;
  }
});

test("projects saved before versions were recorded load on version 1", () => {
  const { workflowVersion: _omit, ...legacy } = discoveryProject();
  void _omit;
  const state = reducer({ ready: false, projects: [], issues: [] }, {
    type: "hydrate",
    state: { ready: false, projects: [legacy as Project], issues: [] },
  });
  assert.equal(state.projects[0].workflowVersion, 1);
});

test("a collaborator's brief edit clears the AI-draft mark on the fields they changed", () => {
  const project = { ...discoveryProject(), briefAiFields: ["headcount", "departments"] };
  const brief = { ...project.brief, headcount: "150" };
  const state = reducer(stateWith(project), { type: "applyRemoteBrief", projectId: project.id, brief });
  assert.equal(state.projects[0].brief.headcount, "150");
  assert.deepEqual(state.projects[0].briefAiFields, ["departments"]);
});
