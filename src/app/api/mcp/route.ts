import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { handleMessage, sessionFor, type RpcResponse } from "@/lib/mcp/server";
import { verifyToken } from "@/lib/mcp/tokens";
import { bearer, json, preflight, publicOrigin, unauthorized, withCors } from "@/lib/mcp/http";
import { usesServerPersistence } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
// A tool that drafts, renders or researches can take a few minutes, like a chat reply.
export const maxDuration = 300;

/**
 * Fundur's MCP server over Streamable HTTP (src/lib/mcp/server.ts). Stateless:
 * every POST carries its own bearer token, a personal access token from
 * Settings → Connected AI apps or an OAuth login, and gets its answer as JSON.
 */
export async function POST(req: NextRequest) {
  const db = getDb();
  if (!db || !usesServerPersistence()) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "This Fundur deployment has no server storage, so it cannot be connected to." } }, 503);
  }
  const token = bearer(req);
  if (!token) return unauthorized(req);
  const owner = await verifyToken(db, token);
  if (!owner) return unauthorized(req, "That access token is unknown, revoked or expired");
  const session = await sessionFor(db, owner, publicOrigin(req));
  if ("error" in session) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: session.error } }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const batch = Array.isArray(body);
  const messages = batch ? (body as unknown[]) : [body];
  if (!messages.length || messages.length > 50) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Send one to fifty messages" } }, 400);
  // One after another, so two changes in a batch never race on the same project.
  const answers: RpcResponse[] = [];
  for (const m of messages) {
    const answer = await handleMessage(session, m);
    if (answer) answers.push(answer);
  }
  // Only notifications or responses: accepted, nothing to say.
  if (!answers.length) return withCors(new Response(null, { status: 202 }));
  return json(batch ? answers : answers[0]);
}

/** No server-to-app stream: everything the server says is in its answers. */
export async function GET() {
  return withCors(new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } }));
}

export async function DELETE() {
  return withCors(new Response(null, { status: 405, headers: { allow: "POST, OPTIONS" } }));
}

export const OPTIONS = preflight;
