"use client";

import useSWR from "swr";
import type { SupportRequest, SupportTopic } from "./types";

/** The browser's calls for the signed-in person's own support requests. */

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const SUPPORT_KEY = "/api/support";

/** The person's requests, shared by the support page and the unread badge in the menu. */
export function useSupportRequests(enabled: boolean) {
  return useSWR(enabled ? SUPPORT_KEY : null, (url: string) => call<{ requests: SupportRequest[] }>(url).then((b) => b.requests), {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });
}

export const supportApi = {
  create: (input: { topic: SupportTopic; subject: string; message: string; path: string }) =>
    call<{ request: SupportRequest }>(SUPPORT_KEY, { method: "POST", body: JSON.stringify(input) }).then((b) => b.request),
  reply: (id: string, reply: string) =>
    call<{ request: SupportRequest }>(`${SUPPORT_KEY}/${id}`, { method: "PATCH", body: JSON.stringify({ reply }) }).then((b) => b.request),
  close: (id: string) =>
    call<{ request: SupportRequest }>(`${SUPPORT_KEY}/${id}`, { method: "PATCH", body: JSON.stringify({ close: true }) }).then((b) => b.request),
  seen: (id: string) =>
    call<{ request: SupportRequest }>(`${SUPPORT_KEY}/${id}`, { method: "PATCH", body: JSON.stringify({ seen: true }) }).then((b) => b.request),
};
