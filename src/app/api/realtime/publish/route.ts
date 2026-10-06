import { NextRequest, NextResponse } from "next/server";
import { realtimeBus, RealtimeEventPayload, REALTIME_EVENT_TYPES } from "@/lib/realtime/bus";
import { publishEvent, pruneEvents, shouldPrune } from "@/lib/realtime/channel";
import { requireWorkspace, usesServerPersistence } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/**
 * Sends one change to whoever is watching this project. On the server it goes
 * through the database, so people on other instances hear it too; on demo data
 * the in-memory bus is all there is, and all that is needed.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, projectId, phaseKey, origin, data } = body;

    if (!type || !projectId) {
      return NextResponse.json({ error: "type and projectId are required" }, { status: 400 });
    }
    if (!REALTIME_EVENT_TYPES.includes(type)) {
      return NextResponse.json({ error: `Unknown event type '${type}'` }, { status: 400 });
    }

    if (usesServerPersistence()) {
      // Scoped like the stream: only the signed-in person's workspace hears it.
      const ctx = await requireWorkspace();
      if (ctx instanceof NextResponse) return ctx;
      const event = await publishEvent(ctx.db, {
        workspaceId: ctx.workspaceId,
        projectId,
        type,
        phaseKey,
        origin: typeof origin === "string" ? origin : undefined,
        data: data ?? {},
      });
      // Also straight to anyone this instance is already streaming to, so they see it at once.
      realtimeBus.broadcast(event);
      if (shouldPrune()) await pruneEvents(ctx.db).catch(() => undefined);
      return NextResponse.json({ success: true, event });
    }

    const event: RealtimeEventPayload = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      type,
      projectId,
      workspaceId: body.workspaceId || "default-workspace",
      phaseKey,
      origin: typeof origin === "string" ? origin : undefined,
      timestamp: new Date().toISOString(),
      data: data || {},
    };
    realtimeBus.broadcast(event);
    return NextResponse.json({ success: true, event });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "Failed to publish event" }, { status: 500 });
  }
}
