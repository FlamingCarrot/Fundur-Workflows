import { NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { updateChannel } from "@/lib/comms/store";
import { channelChangeSchema } from "@/lib/comms/types";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; channelId: string }> };

/** Renames, describes, shares with clients or archives a channel. */
export async function PATCH(req: Request, { params }: Context) {
  const { id, channelId } = await params;
  const s = await teamScope(id, "project:edit");
  if (s instanceof NextResponse) return s;
  const input = channelChangeSchema.safeParse(await readBody(req));
  if (!input.success || !z.uuid().safeParse(channelId).success) return commsJson({ error: "Nothing to change" }, 400);
  try {
    return commsJson({ channel: await updateChannel(s, channelId, input.data) });
  } catch (e) {
    return commsFailure(e);
  }
}
