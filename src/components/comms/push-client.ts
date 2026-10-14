"use client";
import { commsRequest } from "@/lib/comms/client";

/**
 * This device's pushes: the browser's service worker receives them even when
 * Fundur is closed. On an iPhone or iPad they work once Fundur is added to
 * the Home Screen.
 */

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Whether this is an iPhone or iPad browser tab, where pushes need Fundur on the Home Screen first. */
export function needsHomeScreen(): boolean {
  if (typeof window === "undefined") return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && !window.matchMedia("(display-mode: standalone)").matches;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function currentPush(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

const fromBase64Url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Subscribes this device to pushes and tells the server. The browser must already allow notifications. */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const { publicKey } = await commsRequest<{ publicKey: string }>("/api/me/push");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) }));
  await commsRequest("/api/me/push", { method: "POST", body: JSON.stringify(sub.toJSON()) });
  return true;
}

export async function disablePush(): Promise<void> {
  const sub = await currentPush();
  if (!sub) return;
  await commsRequest("/api/me/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
