import { test } from "node:test";
import assert from "node:assert/strict";
import { growPlant, leafOutline, LEAF_SHAPES, PLANT_STYLES } from "../src/lib/blueprints/plants";
import { blueprintBody } from "../src/lib/blueprints/schema";
import { standardBlueprint } from "../src/lib/blueprints/defaults";

test("every plant style and leaf grows valid parts within the blueprint limit", () => {
  for (const style of PLANT_STYLES)
    for (const leaf of LEAF_SHAPES) {
      const parts = growPlant({ base: { x: 0, y: 0, z: 300 }, height: 1200, spread: 800, style, leaf, leaves: 160, leafLength: 180, branches: 10, trunkMaterial: "std:walnut", leafMaterials: ["std:plant", "std:plant-deep"], seed: 3 });
      assert.ok(parts.length <= 400, `${style}/${leaf}: ${parts.length}`);
      assert.equal(parts.filter((p) => p.name === "Leaf").length, 160);
      const body = { name: "Plant", kind: "object", category: "Decor", type: "plant", size: { w: 800, d: 800, h: 1500 }, symbol: "parts", parts: parts.map((p, i) => ({ ...p, id: `p${i}` })) };
      const parsed = blueprintBody.safeParse(body);
      assert.ok(parsed.success, `${style}/${leaf}: ${parsed.success ? "" : parsed.error.message.slice(0, 300)}`);
    }
});

test("a seed grows the same plant, and leaves are real outlines, not spheres", () => {
  const spec = { base: { x: 0, y: 0, z: 0 }, height: 900, spread: 600, style: "tree" as const, leaf: "ovate" as const, leaves: 40, leafLength: 120, seed: 9 };
  assert.deepEqual(growPlant(spec), growPlant(spec));
  assert.notDeepEqual(growPlant(spec), growPlant({ ...spec, seed: 10 }));
  for (const leaf of LEAF_SHAPES) {
    const o = leafOutline(leaf);
    assert.ok(o.length >= 12 && o.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1), leaf);
  }
  const plant = standardBlueprint("std:plant")!;
  assert.ok(!plant.parts.some((p) => p.shape === "sphere"));
  assert.ok(plant.parts.filter((p) => p.name === "Leaf" && p.shape === "extrude").length >= 40);
});
