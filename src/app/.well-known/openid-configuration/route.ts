import { authorizationServerMetadata } from "@/lib/mcp/oauth";
import { json, preflight, publicOrigin } from "@/lib/mcp/http";

/** The same as oauth-authorization-server, for apps that look here first. */
export async function GET(req: Request) {
  return json(authorizationServerMetadata(publicOrigin(req)));
}

export const OPTIONS = preflight;
