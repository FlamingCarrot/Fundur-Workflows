import { NextResponse } from "next/server";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { meetingsResponse } from "@/lib/comms/routes";
import { currentProvider } from "@/lib/comms/calls";
import { createMeeting } from "@/lib/comms/store";
import { newMeetingSchema } from "@/lib/comms/types";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** The project's meetings, optionally between ?from and ?to. */
export async function GET(req: Request, { params }: Context) {
  const s = await teamScope((await params).id);
  if (s instanceof NextResponse) return s;
  return meetingsResponse(s, new URL(req.url));
}

/** Schedules a meeting; its chat becomes a thread in a channel. */
export async function POST(req: Request, { params }: Context) {
  const s = await teamScope((await params).id, "project:edit");
  if (s instanceof NextResponse) return s;
  const input = newMeetingSchema.safeParse(await readBody(req));
  if (!input.success) return commsJson({ error: "Give the meeting a title and a time" }, 400);
  try {
    return commsJson({ meeting: await createMeeting(s, input.data, await currentProvider(s.db)) }, 201);
  } catch (e) {
    return commsFailure(e);
  }
}
