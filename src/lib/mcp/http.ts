import { NextResponse } from "next/server";

/**
 * HTTP pieces shared by the MCP endpoint and its OAuth routes. They are
 * reached by AI apps, some from a browser, with a bearer token and no cookies,
 * so any origin may call them.
 */

/** The app's public address: the configured base URL, else the one the request came in on. */
export function publicOrigin(req: Request): string {
  const configured = process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the request's own
    }
  }
  return new URL(req.url).origin;
}

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
  "access-control-max-age": "86400",
};

export function withCors<T extends Response>(res: T): T {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

export const preflight = () => withCors(new NextResponse(null, { status: 204 }));

export function json(body: unknown, init?: number | ResponseInit): NextResponse {
  const res = NextResponse.json(body, typeof init === "number" ? { status: init } : init);
  res.headers.set("cache-control", "no-store");
  return withCors(res);
}

/** The bearer token on a request, if any. */
export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/** Tells an app to sign in, and where to find out how (RFC 9728). */
export function unauthorized(req: Request, message = "Connect with a Fundur access token or sign in"): NextResponse {
  const origin = publicOrigin(req);
  const res = json({ jsonrpc: "2.0", id: null, error: { code: -32001, message } }, 401);
  res.headers.set("www-authenticate", `Bearer realm="fundur", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"`);
  return res;
}

/** A form-encoded or JSON body as plain strings (token endpoints accept either). */
export async function readForm(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  const raw = await req.text().catch(() => "");
  if (type.includes("application/json")) {
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}
