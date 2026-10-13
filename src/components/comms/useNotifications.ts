"use client";
import { useCallback } from "react";
import type { Notification } from "@/lib/comms/store";
import { commsRequest } from "@/lib/comms/client";
import { usePolling } from "./useComms";

export type InboxItem = Notification;

/** This person's mentions, replies and meeting news, checked every half minute; nothing in the demo. */
export function useNotifications(enabled: boolean) {
  const poll = usePolling<{ notifications: InboxItem[]; unread: number }>(enabled ? () => commsRequest("/api/notifications") : null, 30_000, [enabled]);
  const { setData } = poll;
  const markRead = useCallback(
    async (ids?: string[]) => {
      const next = await commsRequest<{ notifications: InboxItem[]; unread: number }>("/api/notifications", { method: "POST", body: JSON.stringify(ids ? { ids } : {}) });
      setData(next);
    },
    [setData],
  );
  return { ...poll, markRead };
}
