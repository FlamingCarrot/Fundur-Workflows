import { test } from "node:test";
import assert from "node:assert/strict";
import {
  projectSections,
  activeProjectSection,
} from "../src/lib/studio/project-navigation";
import { newProject } from "../src/lib/studio/transitions";
import { DEMO_VIEWER } from "../src/lib/studio/viewer";
import { getWorkflow } from "../src/lib/workflow";

const project = newProject({
  id: "test-2",
  name: "Test 2",
  client: "Client",
  swatch: "sage",
  workflowId: "interior-design-corporate",
  startDate: "2026-10-08",
});

test("project sections include every workflow tool once, in a stable order", () => {
  const sections = projectSections(project, DEMO_VIEWER);
  const paths = sections.map((s) => s.href);
  for (const path of [
    "items/palette",
    "items/schedule",
    "items/register",
    "items/outstanding",
    "regulations",
    "rfqs",
    "documents",
    "templates",
    "export",
  ])
    assert.ok(paths.includes(`/projects/test-2/${path}`), path);
  assert.equal(new Set(paths).size, paths.length);
  for (const page of paths) {
    const active = activeProjectSection(sections, page);
    assert.equal(sections.filter((s) => s.href === active).length, 1);
  }
  assert.equal(
    activeProjectSection(sections, "/projects/test-2/phases/concept"),
    "/projects/test-2/phases/discovery",
  );
  assert.equal(
    activeProjectSection(sections, "/projects/test-20/items/register"),
    undefined,
  );
});

test("project navigation respects workspace features and restricted roles", () => {
  const restricted = projectSections(project, {
    ...DEMO_VIEWER,
    workspaceRole: "collaborator",
    features: {
      ai: false,
      design: false,
      floor_plan: false,
      layout: false,
      sharing: false,
    },
  });
  assert.deepEqual(
    restricted.map((s) => s.href),
    [
      "/projects/test-2",
      "/projects/test-2/phases/discovery",
      "/projects/test-2/brief",
      "/projects/test-2/forms/notes:space_planning",
      "/projects/test-2/documents",
    ],
  );
  const collaborator = projectSections(project, {
    ...DEMO_VIEWER,
    workspaceRole: "collaborator",
  });
  assert.ok(collaborator.some((s) => s.href.endsWith("/rfqs")));
  assert.ok(
    !collaborator.some((s) => /\/(concepts|export|templates)$/.test(s.href)),
  );
});

test("custom projects use their frozen workflow, labels and repeated-module deduplication", () => {
  const workflow = structuredClone(getWorkflow(project));
  workflow.id = "custom-practice";
  workflow.version = 3;
  workflow.labels.palette = "Finish library";
  workflow.phases.forEach((phase) => {
    phase.modules = ["item_register:palette", "sharing"];
    phase.ai_actions = [];
  });
  const custom = {
    ...project,
    workflowId: workflow.id,
    workflowVersion: 3,
    workflowDefinition: workflow,
  };
  const sections = projectSections(custom, DEMO_VIEWER);
  assert.equal(
    sections.filter((s) => s.href.endsWith("/items/palette")).length,
    1,
  );
  assert.equal(
    sections.find((s) => s.href.endsWith("/items/palette"))?.label,
    "Finish library",
  );
  assert.ok(
    !sections.some((s) =>
      /\/(regulations|rfqs|plan|layout|concepts)$/.test(s.href),
    ),
  );
});
