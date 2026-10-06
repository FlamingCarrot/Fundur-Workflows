// ==============================================================================
// Fundur Workflows: Real-Time Event Bus
// Provides in-process pub/sub broadcasting for Server-Sent Events (SSE).
// Compatible with Vercel serverless functions, Neon, and client event streams.
// ==============================================================================

export type RealtimeEventType =
  | "TASK_TOGGLED"
  | "TASK_CREATED"
  | "PHASE_CHANGED"
  | "RECORD_AUTOSAVED"
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_VERSIONED"
  | "AI_STREAM_CHUNK"
  | "AI_COMPLETED"
  | "WAITING_ON_TOGGLED"
  | "ISSUE_REPORTED"
  | "PRESENCE_PING";

export interface RealtimeEventPayload<T = unknown> {
  id: string;
  type: RealtimeEventType;
  projectId: string;
  workspaceId: string;
  phaseKey?: string;
  timestamp: string;
  data: T;
}

type EventListener = (event: RealtimeEventPayload) => void;

class RealtimeEventBus {
  private listeners: Map<string, Set<EventListener>> = new Map();

  /**
   * Subscribe to events for a specific project
   */
  public subscribe(projectId: string, listener: EventListener): () => void {
    if (!this.listeners.has(projectId)) {
      this.listeners.set(projectId, new Set());
    }
    const set = this.listeners.get(projectId)!;
    set.add(listener);

    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(projectId);
      }
    };
  }

  /**
   * Broadcast an event to all connected listeners for a project
   */
  public broadcast(event: RealtimeEventPayload): void {
    const projectListeners = this.listeners.get(event.projectId);
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

  public getListenerCount(projectId: string): number {
    return this.listeners.get(projectId)?.size ?? 0;
  }
}

// Global singleton to persist across hot-reloads in development
const globalForBus = globalThis as unknown as { realtimeBus?: RealtimeEventBus };
export const realtimeBus = globalForBus.realtimeBus ?? new RealtimeEventBus();
if (process.env.NODE_ENV !== "production") {
  globalForBus.realtimeBus = realtimeBus;
}
