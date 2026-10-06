import { NextRequest, NextResponse } from "next/server";
import { realtimeBus, RealtimeEventPayload, REALTIME_EVENT_TYPES } from "@/lib/realtime/bus";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, projectId, workspaceId, phaseKey, data } = body;

    if (!type || !projectId) {
      return NextResponse.json(
        { error: "type and projectId are required" },
        { status: 400 }
      );
    }
    if (!REALTIME_EVENT_TYPES.includes(type)) {
      return NextResponse.json({ error: `Unknown event type '${type}'` }, { status: 400 });
    }

    const event: RealtimeEventPayload = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type,
      projectId,
      workspaceId: workspaceId || "default-workspace",
      phaseKey,
      timestamp: new Date().toISOString(),
      data: data || {},
    };

    realtimeBus.broadcast(event);

    return NextResponse.json({
      success: true,
      event,
      activeListeners: realtimeBus.getListenerCount(projectId),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Failed to publish event" },
      { status: 500 }
    );
  }
}
