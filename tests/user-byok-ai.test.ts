import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { syncUser } from "../src/lib/auth/users";
import {
  saveProviderKey,
  readProviderKey,
  getUserAiSettings,
  saveUserAiSettings,
  saveUserProviderKey,
  readUserProviderKey,
  deleteUserProviderKey,
  listUserProviderKeys,
  readEffectiveProviderKey,
  getPlatformByokPolicy,
  setPlatformByokPolicy,
} from "../src/lib/ai/settings";
import { getChatModelCatalog } from "../src/lib/ai/auto-models";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

test("user AI settings defaults to platform mode and can be switched to byok", async () => {
  const db = await freshDb();
  await syncUser(db, { sub: "auth0|user1", email: "user1@example.com" });

  // Default is platform mode
  const initial = await getUserAiSettings(db, "auth0|user1");
  assert.equal(initial.mode, "platform");
  assert.equal(initial.autoSelect, true);

  // Switch to byok
  const updated = await saveUserAiSettings(db, "auth0|user1", { mode: "byok", autoSelect: true });
  assert.equal(updated.mode, "byok");
  assert.equal(updated.autoSelect, true);

  // Reads back as byok
  const readBack = await getUserAiSettings(db, "auth0|user1");
  assert.equal(readBack.mode, "byok");

  // Switch back to platform
  const back = await saveUserAiSettings(db, "auth0|user1", { mode: "platform" });
  assert.equal(back.mode, "platform");
});

test("user BYOK keys are encrypted and isolated per user and from platform keys", async () => {
  const db = await freshDb();
  await syncUser(db, { sub: "auth0|admin", email: "admin@example.com" });
  await syncUser(db, { sub: "auth0|alice", email: "alice@example.com" });
  await syncUser(db, { sub: "auth0|bob", email: "bob@example.com" });

  // Platform has its own Anthropic key
  await saveProviderKey(db, "anthropic", "sk-ant-platform-key-0000", "auth0|admin");

  // Alice saves her own Anthropic key
  await saveUserProviderKey(db, "auth0|alice", "anthropic", "sk-ant-alice-private-1111");

  // Bob saves his OpenAI key
  await saveUserProviderKey(db, "auth0|bob", "openai", "sk-proj-bob-private-2222");

  // Verify encryption in DB: plain text is never stored
  const rows = await db.query<{ encrypted_key: string }>("SELECT encrypted_key FROM provider_keys");
  for (const r of rows) {
    assert.equal(r.encrypted_key.includes("sk-ant-platform"), false);
    assert.equal(r.encrypted_key.includes("sk-ant-alice"), false);
    assert.equal(r.encrypted_key.includes("sk-proj-bob"), false);
  }

  // Alice reads her key, Bob cannot read Alice's key
  assert.equal(await readUserProviderKey(db, "auth0|alice", "anthropic"), "sk-ant-alice-private-1111");
  assert.equal(await readUserProviderKey(db, "auth0|bob", "anthropic"), null);

  // Bob reads his key, Alice cannot read Bob's key
  assert.equal(await readUserProviderKey(db, "auth0|bob", "openai"), "sk-proj-bob-private-2222");
  assert.equal(await readUserProviderKey(db, "auth0|alice", "openai"), null);

  // Platform key is preserved and isolated
  assert.equal(await readProviderKey(db, "anthropic"), "sk-ant-platform-key-0000");

  // Key lists show hints and status without exposing secrets
  const aliceKeys = await listUserProviderKeys(db, "auth0|alice");
  const ant = aliceKeys.find((k) => k.provider === "anthropic")!;
  assert.equal(ant.saved, true);
  assert.equal(ant.hint, "…1111");
  assert.equal(aliceKeys.find((k) => k.provider === "openai")!.saved, false);
});

test("readEffectiveProviderKey routes to platform or user BYOK keys based on active mode", async () => {
  const db = await freshDb();
  await syncUser(db, { sub: "auth0|admin" });
  await syncUser(db, { sub: "auth0|carol", email: "carol@example.com" });

  await saveProviderKey(db, "anthropic", "sk-ant-platform-key", "auth0|admin");
  await saveUserProviderKey(db, "auth0|carol", "anthropic", "sk-ant-carol-key");

  // Carol is in platform mode by default -> uses platform key
  const keyInPlatformMode = await readEffectiveProviderKey(db, "anthropic", { userId: "auth0|carol" });
  assert.equal(keyInPlatformMode, "sk-ant-platform-key");

  // Carol switches to BYOK mode -> uses Carol's key
  await saveUserAiSettings(db, "auth0|carol", { mode: "byok" });
  const keyInByokMode = await readEffectiveProviderKey(db, "anthropic", { userId: "auth0|carol" });
  assert.equal(keyInByokMode, "sk-ant-carol-key");

  // Carol switches back to platform mode -> uses platform key again
  await saveUserAiSettings(db, "auth0|carol", { mode: "platform" });
  const keyAfterReset = await readEffectiveProviderKey(db, "anthropic", { userId: "auth0|carol" });
  assert.equal(keyAfterReset, "sk-ant-platform-key");
});

test("deleting a user BYOK key removes only that user key", async () => {
  const db = await freshDb();
  await syncUser(db, { sub: "auth0|admin" });
  await syncUser(db, { sub: "auth0|dan" });

  await saveProviderKey(db, "openai", "sk-platform-key", "auth0|admin");
  await saveUserProviderKey(db, "auth0|dan", "openai", "sk-dan-key");

  assert.equal(await readUserProviderKey(db, "auth0|dan", "openai"), "sk-dan-key");
  await deleteUserProviderKey(db, "auth0|dan", "openai");
  assert.equal(await readUserProviderKey(db, "auth0|dan", "openai"), null);

  // Platform key is untouched
  assert.equal(await readProviderKey(db, "openai"), "sk-platform-key");
});

test("platform BYOK policy tracks user stats and can be toggled by admin", async () => {
  const db = await freshDb();
  await syncUser(db, { sub: "auth0|u1" });
  await syncUser(db, { sub: "auth0|u2" });

  await saveUserAiSettings(db, "auth0|u1", { mode: "byok" });
  await saveUserAiSettings(db, "auth0|u2", { mode: "platform" });

  const policy = await getPlatformByokPolicy(db);
  assert.equal(policy.byokAllowed, true);
  assert.equal(policy.byokUserCount, 1);
  assert.equal(policy.platformUserCount, 1);

  await setPlatformByokPolicy(db, false);
  const updatedPolicy = await getPlatformByokPolicy(db);
  assert.equal(updatedPolicy.byokAllowed, false);
});

test("getChatModelCatalog reflects user BYOK vs platform mode", async () => {
  const db = await freshDb();
  await syncUser(db, { sub: "auth0|admin" });
  await syncUser(db, { sub: "auth0|eve" });

  await saveProviderKey(db, "anthropic", "sk-ant-platform", "auth0|admin");
  await saveUserProviderKey(db, "auth0|eve", "openai", "sk-openai-eve");

  // Default / platform mode for eve
  const platformCatalog = await getChatModelCatalog(db, "auth0|eve");
  assert.equal(platformCatalog.mode, "platform");
  assert.ok(platformCatalog.models.some((m) => m.provider === "anthropic"));
  assert.ok(!platformCatalog.models.some((m) => m.provider === "openai"));

  // Eve switches to BYOK mode
  await saveUserAiSettings(db, "auth0|eve", { mode: "byok" });
  const byokCatalog = await getChatModelCatalog(db, "auth0|eve");
  assert.equal(byokCatalog.mode, "byok");
  assert.ok(byokCatalog.models.some((m) => m.provider === "openai"));
  assert.ok(!byokCatalog.models.some((m) => m.provider === "anthropic"));
});
