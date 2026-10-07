import type { Db } from "@/lib/db";
import { MAX_SETTINGS_PER_PERSON, type ViewSettings } from "./schema";

/** Every view setting the person has left, by name. */
export async function getViewSettings(db: Db, userId: string): Promise<ViewSettings> {
  const rows = await db.query<{ key: string; value: unknown }>(
    "SELECT key, value FROM user_view_settings WHERE user_id = $1",
    [userId]
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Saves the settings given, leaving the others as they are. A null value
 * forgets that setting. Past the limit, the settings left longest ago go first.
 */
export async function saveViewSettings(db: Db, userId: string, settings: ViewSettings): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    if (value === null) {
      await db.query("DELETE FROM user_view_settings WHERE user_id = $1 AND key = $2", [userId, key]);
      continue;
    }
    await db.query(
      `INSERT INTO user_view_settings (user_id, key, value, updated_at) VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [userId, key, JSON.stringify(value)]
    );
  }
  await db.query(
    `DELETE FROM user_view_settings WHERE user_id = $1 AND key IN (
       SELECT key FROM user_view_settings WHERE user_id = $1 ORDER BY updated_at DESC, key OFFSET $2
     )`,
    [userId, MAX_SETTINGS_PER_PERSON]
  );
}
