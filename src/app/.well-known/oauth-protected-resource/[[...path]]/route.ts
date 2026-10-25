import { protectedResourceMetadata } from "@/lib/mcp/oauth";
import { json, preflight, publicOrigin } from "@/lib/mcp/http";

/** RFC 9728: where an AI app learns that /api/mcp signs in through Fundur (at this path and /api/mcp under it). */
export async function GET(req: Request) {
  return json(protectedResourceMetadata(publicOrigin(req)));
}

export const OPTIONS = preflight;
