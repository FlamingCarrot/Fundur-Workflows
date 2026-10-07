import { NextRequest, NextResponse } from "next/server";
import { realtimeBus, RealtimeEventPayload } from "@/lib/realtime/bus";
import { eventsSince, latestEventId, POLL_MS } from "@/lib/realtime/channel";
import { requireWorkspace, requireProjectAccess, refreshWorkspaceContext, usesServerPersistence, type WorkspaceContext } from "@/lib/server/workspace-context";
import type { Db } from "@/lib/db";

export const dynamic = "force-dynamic";
/** A stream is closed before the platform's own limit, and the browser reconnects. */
export const maxDuration = 300;

const STREAM_MS = Number(process.env.REALTIME_STREAM_MS) || 240_000;
const HEARTBEAT_MS = Number(process.env.REALTIME_HEARTBEAT_INTERVAL_MS) || 15_000;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") || "default-project";
  let workspaceId = url.searchParams.get("workspaceId") || "default-workspace";
  let db: Db | null = null;
  let workspace: WorkspaceContext | null = null;
  // Project slugs are only unique within a workspace, so channels are scoped to the
  // signed-in person's workspace rather than to whatever the browser asks for.
  if (usesServerPersistence()) {
    const ctx = await requireWorkspace();
    if (ctx instanceof NextResponse) return ctx;
    const denied = await requireProjectAccess(ctx, projectId);
    if (denied) return denied;
    workspace = ctx;
    workspaceId = ctx.workspaceId;
    db = ctx.db;
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let poll: NodeJS.Timeout | null = null;
  let endTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };
      let delivery = Promise.resolve();
      const sendEvent = (event: RealtimeEventPayload) => {
        delivery = delivery.then(async () => {
        if (workspace) {
          const fresh = await refreshWorkspaceContext(workspace);
          if (fresh instanceof NextResponse || await requireProjectAccess(fresh, projectId)) { stop(); return; }
          workspace = fresh;
        }
        send(`data: ${JSON.stringify(event)}\n\n`);
        });
        return delivery;
      };
      const stop = () => {
        open = false;
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        if (poll) clearInterval(poll);
        if (endTimer) clearTimeout(endTimer);
        try {
          controller.close();
        } catch {
          // Already closed by the browser going away.
        }
      };

      send(
        `data: ${JSON.stringify({ type: "CONNECTED", projectId, workspaceId, timestamp: new Date().toISOString() })}\n\n`
      );

      // Changes made on this instance, heard without waiting for the next look at the database.
      const seen = new Set<string>();
      unsubscribe = realtimeBus.subscribe(workspaceId, projectId, (event) => {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        void sendEvent(event).catch(() => stop());
      });

      if (db) {
        // Everything already in the channel happened before this stream opened.
        let cursor = await latestEventId(db, workspaceId, projectId).catch(() => "0");
        let polling = false;
        poll = setInterval(() => {
          if (!open || polling) return;
          polling = true;
          void (async () => {
            if (workspace) {
              const fresh = await refreshWorkspaceContext(workspace);
              if (fresh instanceof NextResponse || await requireProjectAccess(fresh, projectId)) { stop(); return { events: [], cursor }; }
              workspace = fresh;
            }
            return eventsSince(db!, workspaceId, projectId, cursor);
          })().then(
            ({ events, cursor: next }) => {
              cursor = next;
              for (const event of events) {
                if (seen.has(event.id)) continue;
                seen.add(event.id);
                void sendEvent(event).catch(() => stop());
              }
              // Ids only ever grow, so the set stays small: just what the last few looks returned.
              if (seen.size > 500) seen.clear();
            },
            () => undefined
          ).finally(() => { polling = false; });
        }, POLL_MS);
      }

      heartbeat = setInterval(() => send(`: heartbeat ${new Date().toISOString()}\n\n`), HEARTBEAT_MS);
      // Serverless functions are cut off at their limit; ending first makes the browser reconnect cleanly.
      endTimer = setTimeout(stop, STREAM_MS);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      if (poll) clearInterval(poll);
      if (endTimer) clearTimeout(endTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
