import { test } from "node:test";
import assert from "node:assert/strict";
import { blankBlueprint } from "../src/lib/blueprints/edit";
import { assetBrief } from "../src/lib/game-assets/schema";
import { linkAssetReference, referenceImages, referencePreview, setAssetReferences } from "../src/lib/game-assets/references";
import { blueprintBody } from "../src/lib/blueprints/schema";
import type { ProjectDocument } from "../src/lib/studio/types";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const doc = (patch: Partial<ProjectDocument> = {}): ProjectDocument => ({ id, name: "guardian-front.PNG", sizeBytes: 1000, stored: true, phaseKey: "asset_design", uploadedAt: "2026-10-16T10:00:00Z", clientVisible: false, ...patch });
const blueprint = () => ({ ...blankBlueprint("Guardian"), id: "guardian", revision: 4, gameAsset: { ...assetBrief("game-project", "guardian"), assumptions: ["Hidden back surfaces inferred"] } });

test("reference previews require a stored image explicitly present in this project", () => {
  const reference = { fileName: "guardian-front.PNG", view: "front" as const, documentId: id };
  const expected = "/api/projects/game-project/documents/" + id + "/file?inline=1";
  assert.equal(referencePreview("game-project", [doc()], reference), expected);
  assert.equal(referencePreview("game-project", [], reference), null);
  assert.equal(referencePreview("game-project", [doc({ stored: false })], reference), null);
  assert.equal(referencePreview("game-project", [doc({ name: "guardian.svg" })], reference), null);
  assert.equal(referencePreview("game-project", [doc({ id: otherId })], reference), null, "a matching filename cannot substitute another document");
  assert.equal(referencePreview("game-project", [doc()], { ...reference, documentId: "https://outside.example/image.png" }), null);
  assert.equal(referencePreview("a/b?x=1", [doc()], reference), "/api/projects/a%2Fb%3Fx%3D1/documents/" + id + "/file?inline=1");
});

test("the image picker excludes unfiled names, unsafe IDs and unsupported content", () => {
  const valid = doc();
  const list = [valid, doc({ id: otherId, name: "side.webp" }), doc({ name: "notes.pdf" }), doc({ name: "front.png", stored: false }), doc({ id: "../outside", name: "image.jpg" })];
  assert.deepEqual(referenceImages(list).map(d => d.id), [id, otherId]);
});

test("linking references keeps geometry, asset requirements and revision immutable until Save", () => {
  const before = blueprint(), snapshot = structuredClone(before);
  const result = linkAssetReference(before, "game-project", [doc()], id, "front");
  assert.ok(result.ok);
  assert.equal(result.blueprint.parts, before.parts);
  assert.equal(result.blueprint.id, before.id);
  assert.equal(result.blueprint.revision, 4);
  assert.deepEqual(result.blueprint.gameAsset!.assumptions, before.gameAsset.assumptions);
  assert.deepEqual(result.blueprint.gameAsset!.references, [{ documentId: id, fileName: doc().name, view: "front" }]);
  assert.deepEqual(before, snapshot);
  const reloaded = blueprintBody.parse(JSON.parse(JSON.stringify(result.blueprint)));
  assert.deepEqual(reloaded.gameAsset!.references, result.blueprint.gameAsset!.references);
  assert.equal(linkAssetReference(result.blueprint, "game-project", [doc()], id, "front").ok, false);
});

test("cross-project links, missing files and the reference limit fail without changing the model", () => {
  const bp = blueprint(), snapshot = structuredClone(bp);
  assert.equal(linkAssetReference(bp, "another-project", [doc()], id, "front").ok, false);
  assert.equal(linkAssetReference(bp, "game-project", [], id, "front").ok, false);
  assert.equal(linkAssetReference(bp, "game-project", [doc({ stored: false })], id, "front").ok, false);
  const references = Array.from({ length: 12 }, (_, i) => ({ fileName: "sheet-" + i + ".png", view: "sheet" as const, region: "row " + i }));
  const full = setAssetReferences(bp, references); assert.ok(full.ok);
  assert.equal(linkAssetReference(full.blueprint, "game-project", [doc()], id, "front").ok, false);
  assert.deepEqual(bp, snapshot);
});

test("sheet labels and unlinking update only source metadata, with inputs still bounded", () => {
  const bp = blueprint();
  const link = linkAssetReference(bp, "game-project", [doc()], id, "sheet"); assert.ok(link.ok);
  const labeled = setAssetReferences(link.blueprint, [{ ...link.blueprint.gameAsset!.references[0], region: "Guardian · row 2, three views" }]); assert.ok(labeled.ok);
  assert.equal(labeled.blueprint.gameAsset!.references[0].region, "Guardian · row 2, three views");
  assert.equal(labeled.blueprint.parts, bp.parts);
  const removed = setAssetReferences(labeled.blueprint, []); assert.ok(removed.ok);
  assert.equal(removed.blueprint.gameAsset!.references.length, 0);
  assert.equal(setAssetReferences(bp, [{ fileName: "photo.jpg", view: "front", region: "x".repeat(201) }]).ok, false);
  assert.equal(setAssetReferences({ ...bp, gameAsset: undefined }, []).ok, false);
});
