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

  const list = await listSuggestions(db);
  assert.deepEqual(list.map((s) => [s.role, s.suggestedModel]).sort(), [
    // The top model is offered the closest cheaper model, not the much smaller one.
    ["orchestrator", "acme/pro-1-lite"],
    ["worker", "acme/mini-1-lite"],
    ["worker", "acme/mini-2"],
  ].sort());

  const top = list.find((s) => s.role === "orchestrator")!;
  // The provider's entry as checked on accepting: its price today is used.
  await acceptSuggestion(db, top.id, "admin", model("acme/pro-1-lite", 1.4, 7));
  const roles = await readRoleModels(db);
  assert.equal(roles.orchestrator!.model, "acme/pro-1-lite");
  assert.equal(roles.orchestrator!.inputUsdPerMTok, 1.4);
  assert.equal(roles.orchestrator!.zarPerUsd, 18);
  assert.ok((await listEnabledModels(db)).some((m) => m.model === "acme/pro-1-lite"), "the model joins the shortlist");
  await assert.rejects(acceptSuggestion(db, top.id, "admin", model("acme/pro-1-lite", 1.4, 7)), SuggestionGoneError);

  // Two suggestions for one role accepted at once: only one switches the role.
  const worker = (await listSuggestions(db)).filter((s) => s.role === "worker");
  const both = await Promise.allSettled(worker.map((w) => acceptSuggestion(db, w.id, "admin", model(w.suggestedModel, w.inputUsdPerMTok, w.outputUsdPerMTok))));
  assert.equal(both.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(String((both.find((r) => r.status === "rejected") as PromiseRejectedResult).reason), /dealt with|has changed since/);
  const won = worker[both.findIndex((r) => r.status === "fulfilled")].suggestedModel;
  assert.equal((await readRoleModels(db)).worker!.model, won);
  assert.deepEqual(await listSuggestions(db), []);
});

test("a suggestion is dismissed, and refused once the role has changed", async () => {
  const db = await freshDb();
  await saveRoleModel(db, "worker", role("acme/mini-1", 0.8, 4), "admin");
  const next = [...LIST, model("acme/mini-1-lite", 0.2, 1), model("acme/mini-2", 0.8, 4, { created: "2026-09-01" })];
  assert.equal(await recordSuggestions(db, "openrouter", LIST, next), 2);
  const [a, b] = await listSuggestions(db);
  await dismissSuggestion(db, a.id, "admin");
  await assert.rejects(dismissSuggestion(db, a.id, "admin"), SuggestionGoneError);
  // A role changed by hand hides suggestions made against its old model, and accepting one is refused.
  await saveRoleModel(db, "worker", role("other/big", 2, 8), "admin");
  assert.deepEqual(await listSuggestions(db), []);
  await assert.rejects(acceptSuggestion(db, b.id, "admin", model(b.suggestedModel, 0.8, 4)), /has changed since/);
  assert.equal((await readRoleModels(db)).worker!.model, "other/big");
});

test("the current model's capabilities come from the earlier list when the new one drops it, and are never guessed", async () => {
  const db = await freshDb();
  await saveRoleModel(db, "worker", role("acme/mini-1", 0.8, 4), "admin");
  // mini-1 leaves the list as a cheaper model without tool calls arrives: not like for like.
  const dropped = [LIST[0], LIST[2], model("acme/mini-0", 0.2, 1, { features: ["structured"] })];
  assert.equal(await recordSuggestions(db, "openrouter", LIST, dropped), 0);
  // A model nobody has the entry for is not compared at all.
  assert.deepEqual(suggestionsFor("worker", role("acme/unknown", 3, 15), "openrouter", [model("acme/x", 0.1, 0.5)], LIST), []);
});
