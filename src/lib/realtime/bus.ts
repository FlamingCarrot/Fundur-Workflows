// ==============================================================================
// Fundur Workflows: Real-Time Event Bus
// Provides in-process pub/sub broadcasting for Server-Sent Events (SSE).
// Compatible with Vercel serverless functions, Neon, and client event streams.
// ==============================================================================

export const REALTIME_EVENT_TYPES = [
  "TASK_TOGGLED",
  "TASK_CREATED",
  "PHASE_CHANGED",
  "RECORD_AUTOSAVED",
  "DOCUMENT_UPLOADED",
  "DOCUMENT_VERSIONED",
  "CLIENT_REVIEWED",
  "AI_STREAM_CHUNK",
  "AI_COMPLETED",
  "WAITING_ON_TOGGLED",
  "ISSUE_REPORTED",
  "PRESENCE_PING",
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface RealtimeEventPayload<T = unknown> {
  id: string;
  type: RealtimeEventType;
  projectId: string;
  workspaceId: string;
  phaseKey?: string;
  /** The browser tab that sent the event, so it can ignore its own echo. */
  origin?: string;
  timestamp: string;
  data: T;
}

type EventListener = (event: RealtimeEventPayload) => void;

class RealtimeEventBus {
  private listeners: Map<string, Set<EventListener>> = new Map();

  /** Project ids are only unique within a workspace, so a channel is the pair. */
  private channel(workspaceId: string, projectId: string): string {
    return `${workspaceId}:${projectId}`;
  }

  /**
   * Subscribe to events for a specific project
   */
  public subscribe(workspaceId: string, projectId: string, listener: EventListener): () => void {
    const channel = this.channel(workspaceId, projectId);
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    const set = this.listeners.get(channel)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(channel);
      }
    };
  }

  /**
   * Broadcast an event to all connected listeners for a project
   */
  public broadcast(event: RealtimeEventPayload): void {
    const projectListeners = this.listeners.get(this.channel(event.workspaceId, event.projectId));
    if (projectListeners) {
      projectListeners.forEach((listener) => {
        try {
          listener(event);
        } catch (err) {
          console.error("[RealtimeEventBus] Listener error:", err);
        }
      });
    }
  }

  public getListenerCount(workspaceId: string, projectId: string): number {
    return this.listeners.get(this.channel(workspaceId, projectId))?.size ?? 0;
  }
}

// Global singleton to persist across hot-reloads in development
const globalForBus = globalThis as unknown as { realtimeBus?: RealtimeEventBus };
export const realtimeBus = globalForBus.realtimeBus ?? new RealtimeEventBus();
if (process.env.NODE_ENV !== "production") {
  globalForBus.realtimeBus = realtimeBus;
}
