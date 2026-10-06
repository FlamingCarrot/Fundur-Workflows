import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { realtimeBus, RealtimeEventPayload } from "@/lib/realtime/bus";
import { requireWorkspace, usesServerPersistence } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId") || "default-project";
  let workspaceId = url.searchParams.get("workspaceId") || "default-workspace";
  // Project slugs are only unique within a workspace, so channels are scoped to the
  // signed-in person's workspace rather than to whatever the browser asks for.
  if (usesServerPersistence()) {
    const ctx = await requireWorkspace();
    if (ctx instanceof NextResponse) return ctx;
    workspaceId = ctx.workspaceId;
  }

  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeatInterval: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // 1. Send initial connection confirmation
      const initMessage = `data: ${JSON.stringify({
        type: "CONNECTED",
        projectId,
        workspaceId,
        timestamp: new Date().toISOString(),
      })}\n\n`;
      controller.enqueue(encoder.encode(initMessage));

      // 2. Subscribe to real-time project channel
      unsubscribe = realtimeBus.subscribe(workspaceId, projectId, (event: RealtimeEventPayload) => {
        try {
          const payload = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch (err) {
          console.error("[SSE Stream] Failed to enqueue event:", err);
        }
      });

      // 3. Heartbeat to keep connection alive on Vercel serverless / proxies
      const intervalMs = Number(process.env.REALTIME_HEARTBEAT_INTERVAL_MS) || 15000;
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
        } catch {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
        }
      }, intervalMs);
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform, no-store",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disables Nginx buffering on proxy
    },
  });
}
