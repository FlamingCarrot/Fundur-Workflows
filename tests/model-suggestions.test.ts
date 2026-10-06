import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import type { ModelOption } from "../src/lib/ai/catalog";
import { listEnabledModels, readRoleModels, saveRoleModel, type DefaultModel } from "../src/lib/ai/settings";
import { acceptSuggestion, dismissSuggestion, listSuggestions, recordSuggestions, suggestionsFor, SuggestionGoneError } from "../src/lib/ai/suggestions";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

const model = (id: string, input: number, output: number, extra: Partial<ModelOption> = {}): ModelOption => ({
  id,
  name: id,
  inputUsdPerMTok: input,
  outputUsdPerMTok: output,
  contextLength: 200_000,
  created: "2026-03-01",
  features: ["tools", "structured"],
  ...extra,
});
const role = (m: string, input: number, output: number): DefaultModel => ({ provider: "openrouter", model: m, inputUsdPerMTok: input, outputUsdPerMTok: output, zarPerUsd: 18 });

const LIST = [model("acme/pro-1", 3, 15), model("acme/mini-1", 0.8, 4), model("other/big", 2, 8)];

test("a new model is suggested when it is clearly cheaper or newer from the same maker, with the same capabilities", () => {
  const top = role("acme/pro-1", 3, 15);
  // Clearly cheaper, same maker and capabilities.
  const cheap = model("acme/pro-1-lite", 1.5, 7.5, { created: "2026-02-01" });
  // Newer, about the same price.
  const newer = model("acme/pro-2", 3, 16, { created: "2026-09-01" });
  // Not relevant: another maker, missing tool calls, a smaller context, a free variant, much dearer.
  const others = [
    model("other/cheap", 0.1, 0.4),
    model("acme/no-tools", 0.5, 1, { features: ["structured"] }),
    model("acme/short", 0.5, 1, { contextLength: 32_000 }),
    model("acme/pro-1:free", 0, 0),
    model("acme/ultra", 15, 75, { created: "2026-10-01" }),
  ];
  const all = [...LIST, cheap, newer, ...others];
  const out = suggestionsFor("orchestrator", top, "openrouter", [cheap, newer, ...others], all);
  assert.deepEqual(out.map((s) => [s.kind, s.suggestedModel]), [["cheaper", "acme/pro-1-lite"], ["newer", "acme/pro-2"]]);
  assert.match(out[0].reason, /About 50% cheaper than the top model/);
  assert.match(out[1].reason, /^Newer from the same maker .*, 4% dearer, with the same capabilities\./);

  // Only a little cheaper is not worth a switch; another provider's role is left alone.
  assert.deepEqual(suggestionsFor("worker", role("acme/pro-1", 3, 15), "openrouter", [model("acme/pro-1b", 2.8, 14)], all), []);
  assert.deepEqual(suggestionsFor("worker", { ...top, provider: "anthropic" }, "openrouter", [cheap], all), []);
});

test("suggestions are kept once, listed for the role's current model, and accepted or dismissed", async () => {
  const db = await freshDb();
  await saveRoleModel(db, "orchestrator", role("acme/pro-1", 3, 15), "admin");
  await saveRoleModel(db, "worker", role("acme/mini-1", 0.8, 4), "admin");

  // The first list has nothing to compare with.
  assert.equal(await recordSuggestions(db, "openrouter", null, LIST), 0);
  const next = [...LIST, model("acme/pro-1-lite", 1.5, 7.5), model("acme/mini-1-lite", 0.2, 1), model("acme/mini-2", 0.8, 4, { created: "2026-09-01" })];
  assert.equal(await recordSuggestions(db, "openrouter", LIST, next), 3);
  // The same list again makes none, even for a model already suggested.
  assert.equal(await recordSuggestions(db, "openrouter", LIST, next), 0);

  let list = await listSuggestions(db);
  assert.deepEqual(list.map((s) => [s.role, s.suggestedModel]).sort(), [
    // The top model is offered the closest cheaper model, not the much smaller one.
    ["orchestrator", "acme/pro-1-lite"],
    ["worker", "acme/mini-1-lite"],
    ["worker", "acme/mini-2"],
  ].sort());

  const top = list.find((s) => s.role === "orchestrator")!;
  await acceptSuggestion(db, top.id, "admin");
  const roles = await readRoleModels(db);
  assert.equal(roles.orchestrator!.model, "acme/pro-1-lite");
  assert.equal(roles.orchestrator!.inputUsdPerMTok, 1.5);
  assert.equal(roles.orchestrator!.zarPerUsd, 18);
  assert.ok((await listEnabledModels(db)).some((m) => m.model === "acme/pro-1-lite"), "the model joins the shortlist");
  await assert.rejects(acceptSuggestion(db, top.id, "admin"), SuggestionGoneError);

  const worker = (await listSuggestions(db)).filter((s) => s.role === "worker");
  await dismissSuggestion(db, worker[0].id, "admin");
  // A role changed by hand hides suggestions made against its old model, and accepting one is refused.
  await saveRoleModel(db, "worker", role("other/big", 2, 8), "admin");
  list = await listSuggestions(db);
  assert.deepEqual(list, []);
  await assert.rejects(acceptSuggestion(db, worker[1].id, "admin"), /has changed since/);
});
