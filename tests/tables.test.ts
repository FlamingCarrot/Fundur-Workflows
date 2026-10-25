import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyPlan, FIRST_LEVEL_ID, type EditResult } from "../src/lib/plan/geometry";
import { addDraft, describeDraft, drafts, segmentsOf, tableLayout, tableTexts, transformDraft, updateDraft } from "../src/lib/plan/drafting";
import { explodeDraft } from "../src/lib/plan/draft-modify";
import { exportDxf } from "../src/lib/plan/dxf";
import { planSchema } from "../src/lib/plan/schema";
import { applyDraftOps } from "../src/lib/ai/tools/drafting";

const L = FIRST_LEVEL_ID;
const ok = (r: EditResult) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r as Extract<EditResult, { ok: true }>;
};

test("a table draws its grid and words, edits, scales, explodes and exports", () => {
  const cells = [["Code", "Finish", "Room"], ["F01", "Oak floor", "Lounge"], ["F02", "Porcelain", ""]];
  const r = ok(addDraft(emptyPlan(), { levelId: L, shape: "table", points: [{ x: 1000, y: 5000 }], cells, widths: [600, 1500, 1200] }));
  const t = drafts(r.plan)[0];
  const { xs, ys, rowHeight } = tableLayout(t);
  assert.deepEqual(xs, [1000, 1600, 3100, 4300]);
  assert.equal(rowHeight, 360);
  assert.deepEqual(ys, [5000, 4640, 4280, 3920]);
  // Four row lines and four column lines.
  assert.equal(segmentsOf(t).length, 8);
  assert.equal(tableTexts(t).length, 8);
  assert.ok(tableTexts(t)[0].heading && !tableTexts(t)[3].heading);
  assert.match(describeDraft(t), /3 rows by 3 columns/);
  assert.ok(planSchema.safeParse(r.plan).success);
  // Words change; a ragged or empty table is refused.
  const changed = ok(updateDraft(r.plan, t.id, { cells: [...cells, ["F03", "Carpet", "Bed 1"]] }));
  assert.equal(drafts(changed.plan)[0].cells!.length, 4);
  assert.equal(updateDraft(r.plan, t.id, { cells: [] }).ok, false);
  assert.equal(updateDraft(r.plan, t.id, { widths: [0, 100, 100] }).ok, false);
  // Scaling doubles its sizes and keeps it square to the page.
  const big = transformDraft(t, (p) => ({ x: p.x * 2, y: p.y * 2 }));
  assert.deepEqual(tableLayout(big).xs, [2000, 3200, 6200, 8600]);
  // Explode: 8 lines and 8 words.
  const parts = drafts(ok(explodeDraft(r.plan, t.id)).plan);
  assert.equal(parts.filter((d) => d.shape === "line").length, 8);
  assert.equal(parts.filter((d) => d.shape === "text").length, 8);
  // DXF carries the words.
  const dxf = exportDxf(r.plan);
  assert.ok(dxf.includes("Oak floor") && dxf.includes("Porcelain"));
});

test("the assistant puts a table on the plan and changes its words", () => {
  const made = applyDraftOps(emptyPlan(), L, [{ op: "table", at: { x: 0, y: 0 }, rows: [["Door", "Size"], ["D01", "813 x 2032"]], ref: "t" } as never]);
  assert.ok(made.ok, made.ok ? "" : made.error);
  if (!made.ok) return;
  const id = drafts(made.plan)[0].id;
  const set = applyDraftOps(made.plan, L, [{ op: "set", draftId: id, rows: [["Door", "Size"], ["D01", "813 x 2032"], ["D02", "762 x 2032"]] }]);
  assert.ok(set.ok);
  if (set.ok) assert.equal(drafts(set.plan)[0].cells!.length, 3);
});
