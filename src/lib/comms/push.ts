import { after } from "next/server";
import webpush from "web-push";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { getPlanner } from "@/lib/planner/store";
import { getViewSettings } from "@/lib/view-settings/store";
import { siteUrl } from "@/lib/site/company";
import { isAlertSettings, shouldAlert } from "./alerts";

/**
 * Notifications pushed to people's phones and computers (Web Push), so a
 * client message reaches the designer the way WhatsApp would. The server's
 * own keys are made once and kept with the platform settings; each device
 * someone allows is kept until its browser says it is gone. Pushes follow the
 * person's alert settings: paused, or only in working hours.
 */

const SETTING = "webpush";

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.url().max(1000).refine((u) => u.startsWith("https://"), "The push address must be https"),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  })
  .loose();

/** The server's push keys, made the first time they are needed. Only the public one leaves the server. */
export async function vapidKeys(db: Db): Promise<{ publicKey: string; privateKey: string }> {
  const [row] = await db.query<{ value: { publicKey: string; privateKey: string } }>("SELECT value FROM ai_platform_settings WHERE key=$1", [SETTING]);
  if (row?.value?.publicKey) return { publicKey: row.value.publicKey, privateKey: decryptSecret(row.value.privateKey) };
  const keys = webpush.generateVAPIDKeys();
  await db.query(`INSERT INTO ai_platform_settings (key, value, updated_by) VALUES ($1, $2::jsonb, 'system') ON CONFLICT (key) DO NOTHING`, [
    SETTING,
    JSON.stringify({ publicKey: keys.publicKey, privateKey: encryptSecret(keys.privateKey) }),
  ]);
  // Two servers starting at once keep whichever was saved first.
  const [saved] = await db.query<{ value: { publicKey: string; privateKey: string } }>("SELECT value FROM ai_platform_settings WHERE key=$1", [SETTING]);
  return { publicKey: saved.value.publicKey, privateKey: decryptSecret(saved.value.privateKey) };
}

export async function savePushSubscription(db: Db, userId: string, sub: z.infer<typeof pushSubscriptionSchema>): Promise<void> {
  await db.query(
    `INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth) VALUES($1,$2,$3,$4)
     ON CONFLICT(endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`,
    [sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth],
  );
  // Ten devices per person is plenty; the oldest go first.
  await db.query(
    "DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint NOT IN (SELECT endpoint FROM push_subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10)",
    [userId],
  );
}

export async function removePushSubscription(db: Db, userId: string, endpoint: string): Promise<void> {
  await db.query("DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2", [endpoint, userId]);
}

export interface PushMessage {
  title: string;
  body?: string;
  href: string;
  /** Lets a device replace an alert it already showed for the same notification. */
  tag?: string;
}

/** Who the push services can contact about these pushes: the site's own https address. */
function subject(): string {
  const url = siteUrl();
  return url.protocol === "https:" ? url.origin : "https://fundur.app";
}

type Sender = (sub: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => Promise<unknown>;

/** Pushes a notification to each device of the people named, as their alert settings allow. Never throws. */
export async function pushToUsers(db: Db, workspaceId: string, userIds: string[], msg: PushMessage, send: Sender = webpush.sendNotification): Promise<number> {
  try {
    if (!userIds.length) return 0;
    const subs = await db.query<{ endpoint: string; user_id: string; p256dh: string; auth: string }>(
      "SELECT endpoint,user_id,p256dh,auth FROM push_subscriptions WHERE user_id = ANY($1::text[])",
      [userIds],
    );
    if (!subs.length) return 0;
    const keys = await vapidKeys(db);
    const payload = JSON.stringify({ title: msg.title.slice(0, 200), body: (msg.body ?? "").slice(0, 300), href: msg.href, tag: msg.tag });
    const allowed = new Map<string, boolean>();
    let sent = 0;
    for (const sub of subs) {
      if (!allowed.has(sub.user_id)) {
        const settings = (await getViewSettings(db, sub.user_id))["alerts.device"];
        const week = (await getPlanner(db, workspaceId, sub.user_id)).state.workWeek;
        allowed.set(sub.user_id, !isAlertSettings(settings) || shouldAlert({ ...settings, on: true }, week, new Date()));
      }
      if (!allowed.get(sub.user_id)) continue;
      try {
        await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          vapidDetails: { subject: subject(), publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 60 * 60 * 12,
          timeout: 5_000,
        });
        sent++;
        await db.query("UPDATE push_subscriptions SET last_sent_at=NOW() WHERE endpoint=$1", [sub.endpoint]);
      } catch (err) {
        // The browser threw the device away (uninstalled, signed out): forget it.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.query("DELETE FROM push_subscriptions WHERE endpoint=$1", [sub.endpoint]);
      }
    }
    return sent;
  } catch (err) {
    console.error("Push failed", err instanceof Error ? err.message : "unknown");
    return 0;
  }
}

/** Pushes once the response has gone out (or straight away outside a request), so posting never waits on push services. */
export function queuePush(db: Db, workspaceId: string, userIds: string[], msg: PushMessage): void {
  const job = () => pushToUsers(db, workspaceId, userIds, msg).then(() => undefined);
  try {
    after(job);
  } catch {
    void job();
  }
}
