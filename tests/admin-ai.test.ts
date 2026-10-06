import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { qualifiesAsAdmin, syncUser } from "../src/lib/auth/users";
import { decryptSecret, encryptSecret } from "../src/lib/server/secrets";
import {
  deleteProviderKey,
  readAiSettings,
  readDefaultModel,
  readProviderKey,
  addEnabledModel,
  listEnabledModels,
  removeEnabledModel,
  saveDefaultModel,
  saveProviderKey,
} from "../src/lib/ai/settings";
import { listModels, ProviderKeyError } from "../src/lib/ai/providers";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";
const ADMIN = "andre1.swanepoel1@gmail.com";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

test("secrets round-trip, and a changed ciphertext or key fails to open", () => {
  const sealed = encryptSecret("sk-ant-secret-value");
  assert.ok(!sealed.includes("sk-ant"));
  assert.notEqual(encryptSecret("sk-ant-secret-value"), sealed, "each encryption uses a fresh IV");
  assert.equal(decryptSecret(sealed), "sk-ant-secret-value");

  const parts = sealed.split(":");
  const data = Buffer.from(parts[3], "base64");
  data[0] ^= 1;
  assert.throws(() => decryptSecret([...parts.slice(0, 3), data.toString("base64")].join(":")));

  process.env.SETTINGS_ENCRYPTION_KEY = "a".repeat(64);
  try {
    assert.throws(() => decryptSecret(sealed));
  } finally {
    delete process.env.SETTINGS_ENCRYPTION_KEY;
  }
});

test("only a verified email on the admin list makes an Admin", () => {
  assert.equal(qualifiesAsAdmin({ sub: "google-oauth2|1", email: ADMIN, email_verified: true }), true);
  assert.equal(qualifiesAsAdmin({ sub: "google-oauth2|1", email: ADMIN.toUpperCase(), email_verified: true }), true);
  assert.equal(qualifiesAsAdmin({ sub: "auth0|2", email: ADMIN, email_verified: false }), false);
  assert.equal(qualifiesAsAdmin({ sub: "auth0|2", email: ADMIN }), false);
  assert.equal(qualifiesAsAdmin({ sub: "auth0|3", email: "designer@example.com", email_verified: true }), false);

  process.env.PLATFORM_ADMIN_EMAILS = "ops@example.com, Second@Example.com";
  try {
    assert.equal(qualifiesAsAdmin({ sub: "x", email: "second@example.com", email_verified: true }), true);
    assert.equal(qualifiesAsAdmin({ sub: "x", email: ADMIN, email_verified: true }), false);
  } finally {
    delete process.env.PLATFORM_ADMIN_EMAILS;
  }
});

test("the Admin role is stored against the sign-in id and kept", async () => {
  const db = await freshDb();
  const admin = await syncUser(db, { sub: "google-oauth2|andre", email: ADMIN, email_verified: true, name: "Andre" });
  assert.equal(admin.platformRole, "admin");
  // A later session without the verified claim does not take the role away.
  assert.equal((await syncUser(db, { sub: "google-oauth2|andre", email: ADMIN })).platformRole, "admin");
  // Someone signing up with the address but without verifying it gets nothing.
  assert.equal((await syncUser(db, { sub: "auth0|impostor", email: ADMIN, email_verified: false })).platformRole, "user");
  assert.equal((await syncUser(db, { sub: "auth0|designer", email: "d@example.com", email_verified: true })).platformRole, "user");
});

test("a provider key is stored encrypted and only its hint is listed", async () => {
  const db = await freshDb();
  await syncUser(db, { sub: "auth0|admin" });
  const key = "sk-or-v1-abcdefghijklmnop1234";
  await saveProviderKey(db, "openrouter", key, "auth0|admin");

  const [row] = await db.query<{ encrypted_key: string }>("SELECT encrypted_key FROM provider_keys");
  assert.ok(!row.encrypted_key.includes(key));
  assert.equal(await readProviderKey(db, "openrouter"), key);

  const status = await readAiSettings(db);
  assert.equal(JSON.stringify(status).includes(key), false);
  const or = status.keys.find((k) => k.provider === "openrouter")!;
  assert.equal(or.saved, true);
  assert.equal(or.hint, "…1234");
  assert.ok(or.verifiedAt);
  assert.equal(status.keys.find((k) => k.provider === "anthropic")!.saved, false);

  // Saving again replaces the platform key rather than adding a second one.
  await saveProviderKey(db, "openrouter", "sk-or-v1-replacement-9999", "auth0|admin");
  assert.equal((await db.query("SELECT 1 FROM provider_keys")).length, 1);
  assert.equal(await readProviderKey(db, "openrouter"), "sk-or-v1-replacement-9999");

  await deleteProviderKey(db, "openrouter");
  assert.equal(await readProviderKey(db, "openrouter"), null);
});

test("the default model saves once and updates in place", async () => {
  const db = await freshDb();
  assert.equal(await readDefaultModel(db), null);
  const setting = { provider: "anthropic" as const, model: "claude-opus-5-5", inputUsdPerMTok: 4, outputUsdPerMTok: 20, zarPerUsd: 18 };
  await saveDefaultModel(db, setting, "auth0|admin");
  assert.deepEqual(await readDefaultModel(db), setting);
  await saveDefaultModel(db, { ...setting, model: "claude-sonnet-5-5", inputUsdPerMTok: 2, outputUsdPerMTok: 10 }, "auth0|admin");
  assert.equal((await readDefaultModel(db))!.model, "claude-sonnet-5-5");
  assert.equal((await db.query("SELECT 1 FROM model_settings")).length, 1);
});

/** A stand-in for the network: answers by URL. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = Object.keys(routes).find((r) => url.startsWith(r));
    if (!route) throw new Error(`unexpected request to ${url}`);
    return routes[route](init);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("a wrong key is refused, per provider", async () => {
  const unauthorized = () => json({ error: { message: "invalid x-api-key" } }, 401);
  await assert.rejects(
    listModels("openrouter", "bad", fakeFetch({ "https://openrouter.ai/api/v1/key": unauthorized })),
    ProviderKeyError
  );
  await assert.rejects(
    listModels("openai", "bad", fakeFetch({ "https://api.openai.com/v1/models": unauthorized })),
    ProviderKeyError
  );
  await assert.rejects(
    listModels(
      "gemini",
      "bad",
      fakeFetch({
        "https://generativelanguage.googleapis.com/": () =>
          json({ error: { code: 400, message: "API key not valid.", status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, 400),
      })
    ),
    ProviderKeyError
  );
  await assert.rejects(
    listModels(
      "anthropic",
      "bad",
      fakeFetch({ "https://api.anthropic.com/v1/models": () => json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, 401) })
    ),
    ProviderKeyError
  );
});

test("a right key lists models with prices where the provider has them", async () => {
  const openrouter = await listModels(
    "openrouter",
    "good",
    fakeFetch({
      "https://openrouter.ai/api/v1/key": () => json({ data: { label: "x" } }),
      "https://openrouter.ai/api/v1/models": () =>
        json({
          data: [
            {
              id: "anthropic/claude-opus-5-5",
              name: "Claude Opus 5.5",
              created: 1788220800,
              description: "  A capable\n model. ".padEnd(400, "x"),
              context_length: 1000000,
              architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
              pricing: { prompt: "0.000004", completion: "0.00002" },
              supported_parameters: ["tools", "tool_choice", "structured_outputs", "response_format", "reasoning"],
            },
            {
              id: "acme/painter",
              name: "Painter",
              architecture: { input_modalities: ["text"], output_modalities: ["image"] },
              pricing: { prompt: "0", completion: "0" },
            },
            { id: "openrouter/auto", name: "Auto Router", pricing: { prompt: "-1", completion: "-1" } },
          ],
        }),
    })
  );
  assert.equal(openrouter.length, 2, "an image-only model cannot draft, so it is left out");
  const [opus, auto] = openrouter;
  assert.equal(opus.id, "anthropic/claude-opus-5-5");
  assert.equal(opus.inputUsdPerMTok, 4);
  assert.equal(opus.outputUsdPerMTok, 20);
  assert.equal(opus.contextLength, 1_000_000);
  assert.equal(opus.created, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(opus.inputs, ["image", "file"]);
  assert.deepEqual(opus.features, ["tools", "structured", "reasoning"]);
  assert.ok(opus.description!.startsWith("A capable model."));
  assert.ok(opus.description!.length <= 280 && opus.description!.endsWith("…"));
  // A router's "-1" price means "varies": no price rather than a negative one, and no empty fields.
  assert.deepEqual(auto, { id: "openrouter/auto", name: "Auto Router" });

  let sentKey: string | null = null;
  const anthropic = await listModels(
    "anthropic",
    "sk-ant-good",
    fakeFetch({
      "https://api.anthropic.com/v1/models": (init) => {
        sentKey = new Headers(init?.headers).get("x-api-key");
        return json({
          data: [
            {
              type: "model",
              id: "claude-opus-5-5",
              display_name: "Claude Opus 5.5",
              created_at: "2026-09-01T00:00:00Z",
              max_input_tokens: 1000000,
              capabilities: { image_input: { supported: true }, pdf_input: { supported: true }, structured_outputs: { supported: true }, thinking: { supported: true } },
            },
          ],
          has_more: false,
          first_id: "claude-opus-5-5",
          last_id: "claude-opus-5-5",
        });
      },
    })
  );
  assert.equal(sentKey, "sk-ant-good");
  assert.deepEqual(anthropic, [
    {
      id: "claude-opus-5-5",
      name: "Claude Opus 5.5",
      inputUsdPerMTok: 4,
      outputUsdPerMTok: 20,
      contextLength: 1_000_000,
      created: "2026-09-01T00:00:00.000Z",
      inputs: ["image", "file"],
      features: ["tools", "structured", "reasoning"],
    },
  ]);

  const gemini = await listModels(
    "gemini",
    "good",
    fakeFetch({
      "https://generativelanguage.googleapis.com/": () =>
        json({
          models: [
            {
              name: "models/gemini-flash",
              displayName: "Gemini Flash",
              inputTokenLimit: 1048576,
              thinking: true,
              supportedGenerationMethods: ["generateContent"],
            },
            { name: "models/text-embedding", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
    })
  );
  assert.deepEqual(gemini, [{ id: "gemini-flash", name: "Gemini Flash", contextLength: 1048576, features: ["reasoning"] }]);
});

test("OpenAI offers only models that answer on Chat Completions", async () => {
  const ids = [
    "gpt-5",
    "gpt-4.1-mini",
    "o4-mini",
    "chatgpt-4o-latest",
    "sora-2",
    "computer-use-preview",
    "gpt-5-codex",
    "o3-pro",
    "o3-deep-research",
    "gpt-image-1",
    "gpt-4o-realtime-preview",
    "gpt-3.5-turbo-instruct",
    "text-embedding-3-small",
    "omni-moderation-latest",
  ];
  const openai = await listModels(
    "openai",
    "good",
    fakeFetch({ "https://api.openai.com/v1/models": () => json({ data: ids.map((id) => ({ id })) }) })
  );
  assert.deepEqual(
    openai.map((m) => m.id),
    ["chatgpt-4o-latest", "gpt-4.1-mini", "gpt-5", "o4-mini"]
  );
});

test("the shortlist keeps each model once, with the provider's name and prices", async () => {
  const db = await freshDb();
  assert.deepEqual(await listEnabledModels(db), []);
  const opus = { id: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5", inputUsdPerMTok: 4, outputUsdPerMTok: 20, contextLength: 1_000_000 };
  await addEnabledModel(db, "openrouter", opus, "auth0|admin");
  await addEnabledModel(db, "openrouter", { id: "google/gemini-flash", name: "Gemini Flash" }, "auth0|admin");
  // Adding again refreshes it rather than adding a second row.
  await addEnabledModel(db, "openrouter", { ...opus, inputUsdPerMTok: 3.5 }, "auth0|admin");

  const list = await listEnabledModels(db);
  assert.equal(list.length, 2);
  const row = list.find((m) => m.model === opus.id)!;
  assert.equal(row.name, "Claude Opus 5.5");
  assert.equal(row.inputUsdPerMTok, 3.5);
  assert.equal(row.contextLength, 1_000_000);
  assert.equal(list.find((m) => m.model === "google/gemini-flash")!.inputUsdPerMTok, null);
  assert.equal((await readAiSettings(db)).enabledModels.length, 2);

  await removeEnabledModel(db, "openrouter", opus.id);
  assert.deepEqual((await listEnabledModels(db)).map((m) => m.model), ["google/gemini-flash"]);
});
