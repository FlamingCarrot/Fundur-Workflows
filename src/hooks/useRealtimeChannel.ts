"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { RealtimeEventPayload } from "@/lib/realtime/bus";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

interface UseRealtimeChannelOptions {
  projectId: string;
  workspaceId?: string;
  onEvent?: (event: RealtimeEventPayload) => void;
  enabled?: boolean;
}

export function useRealtimeChannel({
  projectId,
  workspaceId = "default-workspace",
  onEvent,
  enabled = true,
}: UseRealtimeChannelOptions) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<RealtimeEventPayload | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);
  const onEventRef = useRef(onEvent);
  const connectRef = useRef<() => void>(() => {});

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (!enabled || !projectId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

    const url = `/api/realtime/stream?projectId=${encodeURIComponent(
      projectId
    )}&workspaceId=${encodeURIComponent(workspaceId)}`;

    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
      reconnectAttemptRef.current = 0;
    };

    es.onmessage = (messageEvent) => {
      try {
        const parsed = JSON.parse(messageEvent.data);
        if (parsed.type === "CONNECTED") {
          setStatus("connected");
          return;
        }

        const event = parsed as RealtimeEventPayload;
        setLastEvent(event);
        if (onEventRef.current) {
          onEventRef.current(event);
        }
      } catch (err) {
        console.error("[useRealtimeChannel] Error parsing event:", err);
      }
    };

    es.onerror = () => {
      es.close();
      setStatus("reconnecting");
      reconnectAttemptRef.current += 1;

      // Exponential backoff with ceiling of 10s
      const delay = Math.min(1000 * Math.pow(1.5, reconnectAttemptRef.current), 10000);
      reconnectTimeoutRef.current = setTimeout(() => {
        connectRef.current();
      }, delay);
    };
  }, [projectId, workspaceId, enabled]);

  useEffect(() => {
    connectRef.current = connect;
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect]);

  // Publish a local optimistic mutation to the server real-time bus
  const broadcast = useCallback(
    async (type: RealtimeEventPayload["type"], data: unknown, phaseKey?: string) => {
      try {
        await fetch("/api/realtime/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            projectId,
            workspaceId,
            phaseKey,
            data,
          }),
        });
      } catch (err) {
        console.error("[useRealtimeChannel] Broadcast error:", err);
      }
    },
    [projectId, workspaceId]
  );

  return { status, lastEvent, broadcast };
}
