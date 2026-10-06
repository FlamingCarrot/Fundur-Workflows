# Real-Time State & Zero-Refresh Architecture

## Core Philosophy
In Fundur Workflows, users (such as interior designers or consultants) spend extended periods inside a single **Phase Workspace**. They interact continuously:
- Uploading plans and notes
- Synthesizing briefs and editing requirements
- Conversing with the AI co-pilot back and forth
- Ticking essential quality gates and adjusting dates
- Toggling waiting-on statuses

**Fundamental Requirement:**
> **No forced page refreshes. Ever.**
> Full page reloads destroy focus, disrupt active AI conversations, drop draft form state, and deliver an inferior user experience. Everything is real-time, optimistic, and self-synchronizing.

---

## 1. Debounced Auto-Save Engine (`useAutoSave`)
Users never need to press a "Save" button to persist their work.

- **Debounce Threshold**: Default 800ms (`NEXT_PUBLIC_AUTOSAVE_DEBOUNCE_MS`).
- **Optimistic UI**: Form fields and canvas changes update React state immediately with zero input latency.
- **Save Status Cycle**:
  1. `idle` / `saved`: Subtle checkmark (`"All changes saved (14:32:05)"`).
  2. `dirty`: User is actively typing (`"Unsaved edits..."`).
  3. `saving`: Debounce threshold reached; background serverless POST in flight (`"Saving..."`).
  4. `error`: Network hiccup; retry queue activates with fallback indicator (`"Failed to save - retrying"`).
- **Flushing**: When advancing phases or closing tabs, `flush()` is invoked synchronously to persist pending mutations without user intervention.

---

## 2. Server-Sent Events (SSE) Real-Time Bus (`/api/realtime/stream`)
Real-time synchronization runs over HTTP Server-Sent Events (SSE), which is natively supported on **Vercel Serverless** and modern browsers without requiring dedicated long-lived stateful socket servers.

### Architecture:
```
[ Browser Client A ] <--- SSE Stream ---+
                                        |
[ Browser Client B ] <--- SSE Stream ---+---> [ /api/realtime/stream ]
                                        |             ^
[ AI Background Worker ] --------------+             |
           |                                          |
           +----> POST /api/realtime/publish ---------+
                           |
                     [ RealtimeEventBus ] (In-Memory / Postgres LISTEN/NOTIFY)
```

- **Keep-Alive Heartbeat**: Sends a `: heartbeat` comment every 15 seconds to prevent edge function termination or intermediate proxy timeouts.
- **Automatic Reconnection**: The `useRealtimeChannel` hook automatically reconnects on disconnect with exponential backoff and jitter.
- **Event Types**:
  - `TASK_TOGGLED`: Essential checklist item marked done/undone; updates gate without reloading.
  - `RECORD_AUTOSAVED`: Collaborative edits to structured briefs or FF&E registers synced across users.
  - `PHASE_CHANGED`: Project advanced to next stage.
  - `WAITING_ON_TOGGLED`: Instant switch between "Waiting on Me" and "Waiting on Client".
  - `AI_STREAM_CHUNK`: Live streaming tokens from worker and orchestrator models.

---

## 3. Collaborative AI Interaction
- When a user asks the AI assistant to perform an action (e.g. *“Draft brief from notes”* or *“Check egress clearances”*):
  1. User message appears in the chat transcript instantly.
  2. Streaming reply streams directly into the assistant panel.
  3. Any resulting structured data (e.g., extracted headcount or budget) is automatically written to the active phase's records.
  4. The task cost is computed in real-time (e.g. `$0.0018 / R 0.03`) and displayed adjacent to the deliverable and in project totals.
