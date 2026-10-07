import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { syncUser } from "../src/lib/auth/users";
import { MAX_SETTINGS_PER_PERSON, settingsInput } from "../src/lib/view-settings/schema";
import { getViewSettings, saveViewSettings } from "../src/lib/view-settings/store";
import { getViewSetting, oneOf, resetViewSettings, setViewSetting } from "../src/lib/view-settings/client";

async function setup() {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  const dee = await syncUser(db, { sub: "auth0|dee", email: "dee@example.com", name: "Dee" });
  const sam = await syncUser(db, { sub: "auth0|sam", email: "sam@example.com", name: "Sam" });
  return { db, dee: dee.id, sam: sam.id };
}

test("each person's view settings are kept apart, updated in place and forgotten on null", async () => {
  const { db, dee, sam } = await setup();
  await saveViewSettings(db, dee, { "calendar.view": "month", "plan.layers": { walls: true, rooms: false } });
  await saveViewSettings(db, sam, { "calendar.view": "day" });
  await saveViewSettings(db, dee, { "calendar.view": "week" });

  assert.deepEqual(await getViewSettings(db, dee), { "calendar.view": "week", "plan.layers": { walls: true, rooms: false } });
  assert.deepEqual(await getViewSettings(db, sam), { "calendar.view": "day" });

  await saveViewSettings(db, dee, { "plan.layers": null });
  assert.deepEqual(await getViewSettings(db, dee), { "calendar.view": "week" });
});

test("past the limit, the settings left longest ago go first", async () => {
  const { db, dee } = await setup();
  await saveViewSettings(db, dee, { oldest: 1 });
  await db.query("UPDATE user_view_settings SET updated_at = NOW() - INTERVAL '1 day' WHERE key = 'oldest'");
  const many = Object.fromEntries(Array.from({ length: MAX_SETTINGS_PER_PERSON }, (_, i) => [`k${i}`, i]));
  await saveViewSettings(db, dee, many);
  const kept = await getViewSettings(db, dee);
  assert.equal(Object.keys(kept).length, MAX_SETTINGS_PER_PERSON);
  assert.equal("oldest" in kept, false);
});

test("odd names and oversized values are refused", () => {
  assert.equal(settingsInput.safeParse({ settings: { "calendar.view": "week" } }).success, true);
  assert.equal(settingsInput.safeParse({ settings: { "bad key!": 1 } }).success, false);
  assert.equal(settingsInput.safeParse({ settings: { big: "x".repeat(5_000) } }).success, false);
  assert.equal(settingsInput.safeParse({ settings: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 1])) }).success, false);
});

test("in the browser, a setting is kept in local storage and read back after a reload", () => {
  const stored = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v) },
  };
  try {
    resetViewSettings();
    assert.equal(getViewSetting("calendar.view"), undefined);
    setViewSetting("calendar.view", "month");
    resetViewSettings(); // as if the page were opened again
    assert.equal(getViewSetting("calendar.view"), "month");

    const isView = oneOf(["day", "week", "month"] as const);
    assert.equal(isView("month"), true);
    assert.equal(isView("quarter"), false);
  } finally {
    delete (globalThis as { window?: unknown }).window;
    resetViewSettings();
  }
});
