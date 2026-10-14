"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useViewSetting } from "@/lib/view-settings/client";
import { usePlanner } from "@/lib/planner/client";
import { DEFAULT_ALERTS, isAlertSettings, shouldAlert, type AlertSettings } from "@/lib/comms/alerts";
import type { InboxItem } from "./useNotifications";
import { currentPush } from "./push-client";

/** This person's alert settings, remembered with their other settings. */
export function useAlertSettings() {
  return useViewSetting<AlertSettings>("alerts.device", DEFAULT_ALERTS, isAlertSettings);
}

/** Whether this browser can show alerts, and whether it was allowed to. */
export function alertPermission(): NotificationPermission | "unsupported" {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported";
}

/**
 * Shows a device alert for each new notification while the app is in the
 * background, unless alerts are off, paused, or it is outside working hours.
 * What was already there when the page opened never alerts, and a device
 * that gets pushes leaves the alert to them so nothing shows twice.
 */
export function useDeviceAlerts(items: InboxItem[] | undefined) {
  const [settings] = useAlertSettings();
  const { planner } = usePlanner();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  const pushed = useRef(false);
  useEffect(() => {
    void currentPush()
      .then((sub) => (pushed.current = !!sub))
      .catch(() => undefined);
  }, [settings.on]);
  useEffect(() => {
    if (!items) return;
    if (!seen.current) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !n.read && !seen.current!.has(n.id));
    items.forEach((n) => seen.current!.add(n.id));
    if (!fresh.length || pushed.current || alertPermission() !== "granted" || !shouldAlert(settings, planner.workWeek, new Date())) return;
    if (document.visibilityState === "visible" && document.hasFocus()) return;
    for (const n of fresh.slice(0, 3)) {
      try {
        const alert = new Notification(n.title, { body: n.body || undefined, tag: n.id });
        alert.onclick = () => {
          window.focus();
          router.push(n.href);
          alert.close();
        };
      } catch {
        // Some phones only show alerts from a service worker; the badge still counts it.
      }
    }
  }, [items, settings, planner.workWeek, router]);
}
