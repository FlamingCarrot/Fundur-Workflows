import { NextResponse } from "next/server";
import { z } from "zod";
import { commsFailure, commsJson, readBody, teamScope } from "@/lib/comms/http";
import { TRANSLATE_LANGUAGES, translatePost } from "@/lib/comms/write-help";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const input = z.object({ to: z.enum(TRANSLATE_LANGUAGES).default("English") }).strict();

/** The post put into another language by the assistant. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  if (s.ctx.features.ai === false) return commsJson({ error: "The assistant is turned off for this workspace" }, 403);
  const body = input.safeParse((await readBody(req)) ?? {});
  if (!body.success || !z.uuid().safeParse(postId).success) return commsJson({ error: "Pick a language" }, 400);
  try {
    return commsJson(await translatePost(s, postId, body.data.to));
  } catch (e) {
    return commsFailure(e);
  }
}
