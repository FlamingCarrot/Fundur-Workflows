import { authorizationServerMetadata } from "@/lib/mcp/oauth";
import { json, preflight, publicOrigin } from "@/lib/mcp/http";

/** RFC 8414: how an AI app registers, signs her in and gets tokens. */
export async function GET(req: Request) {
  return json(authorizationServerMetadata(publicOrigin(req)));
}

export const OPTIONS = preflight;
