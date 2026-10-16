import { test } from "node:test";
import assert from "node:assert/strict";
import { getWorkflow, listWorkflows } from "../src/lib/workflow";
import { validateWorkflowDefinition } from "../src/lib/workflow/validator";
import { newProject } from "../src/lib/studio/transitions";
import { projectSections } from "../src/lib/studio/project-navigation";
import { DEMO_VIEWER } from "../src/lib/studio/viewer";
import { blueprintBody } from "../src/lib/blueprints/schema";
import { blankBlueprint } from "../src/lib/blueprints/edit";
import { resolver } from "../src/lib/blueprints/resolve";
import type { Blueprint } from "../src/lib/blueprints/types";
import { assetBrief } from "../src/lib/game-assets/schema";
import { inspectGameAsset } from "../src/lib/game-assets/quality";
import { exportGameGLTF } from "../src/lib/game-assets/export";
import "../src/lib/ai/tools/game-assets";
import { getTool, toolSpecs, type ToolContext } from "../src/lib/ai/tools/registry";

function model(): Blueprint {
  return { ...blankBlueprint("Crate"), id: "crate", revision: 1, category: "Props", gameAsset: assetBrief("game", "crate") };
}

test("game workflow is published, validated and exposes the asset studio before other milestones complete", () => {
  const wf = getWorkflow("indie-game-development");
  assert.ok(listWorkflows().some(w => w.id === wf.id));
  assert.deepEqual(validateWorkflowDefinition(wf).errors, []);
  assert.equal(wf.phases.length, 10);
  const project = newProject({ id: "game", name: "Game", client: "Indie", swatch: "sage", workflowId: wf.id, startDate: "2026-10-16" });
  assert.equal(project.currentPhase, "vision");
  assert.ok(projectSections(project, DEMO_VIEWER).some(s => s.href === "/projects/game/assets"));
  assert.ok(!projectSections(project, { ...DEMO_VIEWER, features: { ai: true, design: true, layout: true, sharing: true, floor_plan: false } }).some(s => s.href.endsWith("/assets")));
  assert.ok(!projectSections({ ...project, myAccess: { level: "view", hiddenTools: ["assets"], hiddenSteps: [], hiddenPhases: [] } }, DEMO_VIEWER).some(s => s.href.endsWith("/assets")));
});

test("blueprint validation preserves three views and rejects invalid geometry and production budgets", () => {
  const bp = model();
  bp.gameAsset!.references = ["front", "side", "back"].map(view => ({ fileName: `${view}.png`, view: view as "front" | "side" | "back", region: "crate_01" }));
  assert.deepEqual(blueprintBody.parse(bp).gameAsset, bp.gameAsset);
  assert.equal(blueprintBody.safeParse({ ...bp, gameAsset: { ...bp.gameAsset, targetTriangles: -1 } }).success, false);
  assert.equal(blueprintBody.safeParse({ ...bp, parts: [{ ...bp.parts[0], shape: "mesh", mesh: { v: [[0,0,0],[1,0,0],[0,1,0]], f: [[0,1,9]] } }] }).success, false);
});

test("asset reports empty models, geometry budgets and unfinished rigging without claiming readiness", () => {
  const bp = model();
  assert.equal(inspectGameAsset(resolver(), bp).triangles, 12);
  bp.gameAsset = { ...bp.gameAsset!, targetTriangles: 12, rigging: "animated" };
  bp.parts.push({ ...bp.parts[0], id: "second" });
  const report = inspectGameAsset(resolver(), bp);
  assert.equal(report.triangles, 24);
  assert.match(report.issues.join(" "), /Over/);
  assert.match(report.pending.join(" "), /Skeleton/);
  assert.match(inspectGameAsset(resolver(), { ...bp, parts: [] }).issues.join(" "), /No model/);
});

test("glTF export is self contained, triangulated, Y up in metres and retains production metadata", () => {
  const bp = model();
  const gltf = JSON.parse(exportGameGLTF(resolver(), bp));
  assert.equal(gltf.asset.version, "2.0");
  const position = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
  assert.equal(position.count, 36);
  assert.deepEqual(position.min, [-.5, 0, -.3]);
  assert.deepEqual(position.max, [.5, .75, .3]);
  assert.equal(gltf.extras.gameAsset.assetKey, "crate");
  const bytes = Buffer.from(gltf.buffers[0].uri.split(",")[1], "base64");
  assert.equal(bytes.length, gltf.buffers[0].byteLength);
  assert.ok(gltf.bufferViews.every((v: { byteOffset: number; byteLength: number }) => v.byteOffset % 4 === 0 && v.byteOffset + v.byteLength <= bytes.length));
  assert.throws(() => exportGameGLTF(resolver(), { ...bp, parts: [] }), /Build model/);
});

test("nested game exports preserve scaled, rotated geometry and inherited materials", () => {
  const child = model();
  const parent = { ...model(), id: "parent", parts: [{ id: "child", blueprintId: child.id, at: { x: 2000, y: 0, z: 1000 }, size: { w: 2000, d: 1200, h: 1500 }, rotation: 90, material: "std:white-paint" }] };
  const gltf = JSON.parse(exportGameGLTF(resolver({ blueprints: [child] }), parent));
  const p = gltf.accessors[0];
  assert.deepEqual(p.min, [1.4, 1, -1]);
  assert.deepEqual(p.max, [2.6, 2.5, 1]);
  assert.equal(gltf.materials[0].name, "White paint");
});

test("assistant asset tools export valid schemas and refuse restricted project access before reading storage", async () => {
  const tools = ["read_game_assets", "save_game_asset", "inspect_game_asset_references"].map(name => getTool(name)!);
  assert.equal(toolSpecs(tools).length, 3);
  for (const tool of tools) {
    const ctx = { project: { myAccess: { level: "view", hiddenTools: ["assets"] } } } as unknown as ToolContext;
    const result = await tool.run(ctx, {});
    assert.equal(result.isError, true);
  }
});
