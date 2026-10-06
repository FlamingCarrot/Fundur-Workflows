import { NextRequest, NextResponse } from "next/server";
import { realtimeBus, RealtimeEventPayload, REALTIME_EVENT_TYPES } from "@/lib/realtime/bus";
import { requireWorkspace, usesServerPersistence } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, projectId, phaseKey, origin, data } = body;
    let { workspaceId } = body;

    if (!type || !projectId) {
      return NextResponse.json(
        { error: "type and projectId are required" },
        { status: 400 }
      );
    }
    if (!REALTIME_EVENT_TYPES.includes(type)) {
      return NextResponse.json({ error: `Unknown event type '${type}'` }, { status: 400 });
    }

    // Scoped like the stream: only the signed-in person's workspace hears it.
    if (usesServerPersistence()) {
      const ctx = await requireWorkspace();
      if (ctx instanceof NextResponse) return ctx;
      workspaceId = ctx.workspaceId;
    }

    const event: RealtimeEventPayload = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type,
      projectId,
      workspaceId: workspaceId || "default-workspace",
      phaseKey,
      origin: typeof origin === "string" ? origin : undefined,
      timestamp: new Date().toISOString(),
      data: data || {},
    };

    realtimeBus.broadcast(event);

    return NextResponse.json({
      success: true,
      event,
      activeListeners: realtimeBus.getListenerCount(event.workspaceId, projectId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to publish event" },
      { status: 500 }
    );
  }
}
