import { NextResponse } from "next/server";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { channelsResponse } from "@/lib/comms/routes";
import { createChannel } from "@/lib/comms/store";
import { newChannelSchema } from "@/lib/comms/types";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** The project's channels this person is in, with unread counts, and who can be mentioned. */
export async function GET(_req: Request, { params }: Context) {
  const s = await teamScope((await params).id);
  if (s instanceof NextResponse) return s;
  return channelsResponse(s);
}

export async function POST(req: Request, { params }: Context) {
  const s = await teamScope((await params).id, "project:edit");
  if (s instanceof NextResponse) return s;
  const input = newChannelSchema.safeParse(await readBody(req));
  if (!input.success) return commsJson({ error: "Give the channel a name" }, 400);
  try {
    return commsJson({ channel: await createChannel(s, input.data) }, 201);
  } catch (e) {
    return commsFailure(e);
  }
}
