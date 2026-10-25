import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { createProject } from "../src/lib/projects/store";
import { getProject } from "../src/lib/projects/store";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";
import { listTools, registerTool } from "../src/lib/ai/tools";
import { createPersonalToken, listTokens, revokeToken, verifyToken } from "../src/lib/mcp/tokens";
import { allowedRedirect, exchange, issueCode, readAuthorizeRequest, registerClient } from "../src/lib/mcp/oauth";
import { handleMessage, sessionFor, type McpSession } from "../src/lib/mcp/server";
import { isPublicTokenRoute } from "../src/lib/auth/public-routes";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

async function setup() {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|designer" });
  await syncUser(db, { sub: "auth0|designer", email: "designer@example.com", email_verified: true, name: "Designer" });
  await createProject(db, ws, {
    id: "harbour-house",
    name: "Harbour House",
    client: "Harbour Holdings",
    workflowId: DEFAULT_WORKFLOW_ID,
    startDate: "2026-10-01T00:00:00.000Z",
    swatch: "sage",
  });
  return { db, ws };
}

async function connect(db: Db, ws: string, userId = "auth0|designer", canConfirm = false): Promise<McpSession> {
  const { token } = await createPersonalToken(db, { userId, workspaceId: ws, name: "Claude Code", canConfirm });
  const owner = await verifyToken(db, token);
  assert.ok(owner);
  const session = await sessionFor(db, owner, "https://app.example.com");
  assert.ok(!("error" in session));
  return session as McpSession;
}

let ids = 0;
async function rpc(session: McpSession, method: string, params: Record<string, unknown> = {}) {
  const res = await handleMessage(session, { jsonrpc: "2.0", id: ++ids, method, params });
  assert.ok(res && "result" in res, JSON.stringify(res));
  return res.result as Record<string, unknown>;
}
const call = async (session: McpSession, name: string, args: Record<string, unknown>) =>
  (await rpc(session, "tools/call", { name, arguments: args })) as { content: { text: string }[]; isError?: boolean; structuredContent?: { changes: { id: string; status: string }[] } };

test("personal tokens are stored hashed, work until revoked, and note when they were used", async () => {
  const { db, ws } = await setup();
  const { token, view } = await createPersonalToken(db, { userId: "auth0|designer", workspaceId: ws, name: "Cursor" });
  assert.match(token, /^fdr_pat_[A-Za-z0-9_-]{43}$/);
  const [row] = await db.query<{ token_hash: string }>("SELECT token_hash FROM mcp_tokens WHERE id = $1", [view.id]);
  assert.equal(row.token_hash, createHash("sha256").update(token).digest("hex"));
  assert.equal((await verifyToken(db, token))?.userId, "auth0|designer");
  assert.equal(await verifyToken(db, token + "x"), null);
  assert.ok((await listTokens(db, "auth0|designer"))[0].lastUsedAt);
  assert.equal(await revokeToken(db, "auth0|someone-else", view.id), false);
  assert.equal(await revokeToken(db, "auth0|designer", view.id), true);
  assert.equal(await verifyToken(db, token), null);
});

test("a switched-off account loses its connections at once", async () => {
  const { db, ws } = await setup();
  const { token } = await createPersonalToken(db, { userId: "auth0|designer", workspaceId: ws, name: "x" });
  await db.query("UPDATE users SET active = FALSE WHERE id = 'auth0|designer'");
  const session = await sessionFor(db, (await verifyToken(db, token))!, "https://app.example.com");
  assert.ok("error" in session);
});

test("initialize, and the tools are the assistant's registry read live, project tools taking a project", async () => {
  const { db, ws } = await setup();
  const session = await connect(db, ws);
  const init = await rpc(session, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.protocolVersion, "2025-06-18");
  assert.ok(String(init.instructions).includes("list_projects"));
  assert.equal(await handleMessage(session, { jsonrpc: "2.0", method: "notifications/initialized" }), null);

  const tools = (await rpc(session, "tools/list")).tools as { name: string; inputSchema: { properties: Record<string, unknown>; required?: string[] }; annotations: { readOnlyHint?: boolean } }[];
  const names = new Set(tools.map((t) => t.name));
  for (const t of ["list_projects", "add_task", "edit_plan", "read_library", "edit_blueprint", "undo_change", "list_changes", "dismiss_change"]) assert.ok(names.has(t), t);
  assert.ok(!names.has("confirm_change"), "only for connections allowed to confirm");
  assert.ok(tools.length > 60);
  const addTask = tools.find((t) => t.name === "add_task")!;
  assert.deepEqual(addTask.inputSchema.required?.[0], "project");
  assert.ok("title" in addTask.inputSchema.properties);
  const listProjects = tools.find((t) => t.name === "list_projects")!;
  assert.ok(!("project" in listProjects.inputSchema.properties));
  assert.equal(listProjects.annotations.readOnlyHint, true);
  // A tool a module adds later is offered with no change here.
  registerTool({ name: "mcp_test_probe", module: "checklist", anywhere: true, label: "Probe", description: "Test.", input: z.object({}), run: async () => ({ content: "probed" }) });
  const again = (await rpc(session, "tools/list")).tools as { name: string }[];
  assert.ok(again.some((t) => t.name === "mcp_test_probe"));
  assert.equal((await call(session, "mcp_test_probe", {})).content[0].text, "probed");
  assert.ok(listTools().length > 0);
});

test("changes apply like the assistant's: with an undo, on the project's chat, and waiting ones need confirming", async () => {
  const { db, ws } = await setup();
  const session = await connect(db, ws);
  const listed = await call(session, "list_projects", {});
  assert.ok(listed.content[0].text.includes("harbour-house"), listed.content[0].text);

  const missing = await call(session, "add_task", { title: "Call the landlord" });
  assert.equal(missing.isError, true);

  const added = await call(session, "add_task", { project: "harbour-house", title: "Call the landlord" });
  assert.ok(!added.isError, added.content[0].text);
  const change = added.structuredContent!.changes[0];
  assert.equal(change.status, "applied");
  let project = (await getProject(db, ws, "harbour-house"))!;
  assert.ok(JSON.stringify(project).includes("Call the landlord"));

  // The work shows in the project's chat on today's message for this app, with the tool run logged.
  const [msg] = await db.query<{ id: string; content: string; events: unknown }>("SELECT m.id, m.content, m.events FROM ai_chat_messages m JOIN mcp_chat_anchors a ON a.message_id = m.id WHERE a.scope <> 'studio'");
  assert.match(msg.content, /Claude Code/);
  assert.ok(JSON.stringify(msg.events).includes("add_task"), JSON.stringify(msg));
  assert.equal((await db.query("SELECT 1 FROM ai_tool_calls WHERE chat_message_id = $1", [msg.id])).length, 1);
  await call(session, "add_task", { project: "harbour-house", title: "Order samples" });
  assert.equal((await db.query("SELECT 1 FROM mcp_chat_anchors WHERE scope <> 'studio'")).length, 1, "one message per app, project and day");

  const undone = await call(session, "undo_change", { project: "harbour-house", change_id: change.id });
  assert.ok(!undone.isError, undone.content[0].text);
  project = (await getProject(db, ws, "harbour-house"))!;
  assert.ok(!JSON.stringify(project).includes("Call the landlord"));

  const pending = await call(session, "list_changes", { project: "harbour-house", status: "undone" });
  assert.ok(pending.content[0].text.includes("Call the landlord"));
});

test("only a connection allowed to confirm gets confirm_change", async () => {
  const { db, ws } = await setup();
  const session = await connect(db, ws, "auth0|designer", true);
  const tools = (await rpc(session, "tools/list")).tools as { name: string }[];
  assert.ok(tools.some((t) => t.name === "confirm_change"));
  const added = await call(session, "add_task", { project: "harbour-house", title: "Old task" });
  const taskId = /\[id ([0-9a-f-]{36})\]/.exec(added.content[0].text)![1];
  const del = await call(session, "delete_task", { project: "harbour-house", taskId });
  const waiting = del.structuredContent!.changes[0];
  assert.equal(waiting.status, "pending");
  assert.match(del.content[0].text, /Waiting for the designer to confirm/);
  assert.ok(JSON.stringify(await getProject(db, ws, "harbour-house")).includes("Old task"), "nothing deleted before confirming");
  const confirmed = await call(session, "confirm_change", { project: "harbour-house", change_id: waiting.id });
  assert.ok(!confirmed.isError, confirmed.content[0].text);
  assert.ok(!JSON.stringify(await getProject(db, ws, "harbour-house")).includes("Old task"));
  const plain = await connect(db, ws);
  assert.equal((await call(plain, "confirm_change", { project: "harbour-house", change_id: crypto.randomUUID() })).isError, true);
});

test("a teammate's token reaches only the projects she was given", async () => {
  const { db, ws } = await setup();
  await syncUser(db, { sub: "auth0|helper", email: "helper@example.com", email_verified: true, name: "Helper" });
  await db.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, 'auth0|helper', 'collaborator')", [ws]);
  const session = await connect(db, ws, "auth0|helper");
  const res = await call(session, "add_task", { project: "harbour-house", title: "Sneaky" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not found|permission/i);
  const read = await handleMessage(session, { jsonrpc: "2.0", id: 1, method: "resources/read", params: { uri: "fundur://projects/harbour-house" } });
  assert.ok(read && "error" in read);
});

test("prompts give the assistant's own instructions, and resources the projects", async () => {
  const { db, ws } = await setup();
  const session = await connect(db, ws);
  const prompts = (await rpc(session, "prompts/list")).prompts as { name: string }[];
  assert.deepEqual(prompts.map((p) => p.name).sort(), ["next_steps", "project_assistant", "studio_assistant"]);
  const got = (await rpc(session, "prompts/get", { name: "project_assistant", arguments: { project: "harbour-house" } })) as { messages: { content: { text: string } }[] };
  assert.ok(got.messages[0].content.text.includes("Fundur's assistant"));
  assert.ok(got.messages[0].content.text.includes("add_task"));

  const list = (await rpc(session, "resources/list")).resources as { uri: string }[];
  assert.ok(list.some((r) => r.uri === "fundur://projects/harbour-house/brief"));
  const read = (await rpc(session, "resources/read", { uri: "fundur://projects" })) as { contents: { text: string }[] };
  assert.ok(read.contents[0].text.includes("Harbour House"));
  const brief = (await rpc(session, "resources/read", { uri: "fundur://projects/harbour-house/brief" })) as { contents: { text: string }[] };
  assert.match(brief.contents[0].text, /brief/);

  const unknown = await handleMessage(session, { jsonrpc: "2.0", id: 9, method: "nope" });
  assert.ok(unknown && "error" in unknown && unknown.error.code === -32601);
});

test("OAuth: apps register, she approves, PKCE codes work once, refresh tokens rotate", async () => {
  const { db, ws } = await setup();
  assert.equal(allowedRedirect("https://claude.ai/api/mcp/auth_callback"), true);
  assert.equal(allowedRedirect("http://127.0.0.1:3334/callback"), true);
  assert.equal(allowedRedirect("cursor://anysphere.cursor-retrieval/oauth/callback"), true);
  assert.equal(allowedRedirect("http://evil.example.com/cb"), false);
  assert.equal(allowedRedirect("javascript:alert(1)"), false);

  const client = await registerClient(db, { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
  const verifier = "v".repeat(20) + "abcdefghijklmnopqrstuvwxyz0123456789";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const bad = await readAuthorizeRequest(db, { client_id: client.clientId, redirect_uri: "https://evil.example.com/cb", response_type: "code", code_challenge: challenge, code_challenge_method: "S256" });
  assert.ok("pageError" in bad);
  const plain = await readAuthorizeRequest(db, { client_id: client.clientId, response_type: "code", code_challenge: "x", code_challenge_method: "plain" });
  assert.ok("redirectError" in plain);
  const ok = await readAuthorizeRequest(db, { client_id: client.clientId, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  assert.ok("ok" in ok);

  const code = await issueCode(db, { clientId: client.clientId, userId: "auth0|designer", workspaceId: ws, redirectUri: client.redirectUris[0], codeChallenge: challenge, canConfirm: false });
  await assert.rejects(exchange(db, { grant_type: "authorization_code", client_id: client.clientId, code, code_verifier: "w".repeat(43) }), /code_verifier|used/);
  const code2 = await issueCode(db, { clientId: client.clientId, userId: "auth0|designer", workspaceId: ws, redirectUri: client.redirectUris[0], codeChallenge: challenge, canConfirm: false });
  const tokens = await exchange(db, { grant_type: "authorization_code", client_id: client.clientId, code: code2, code_verifier: verifier, redirect_uri: client.redirectUris[0] });
  assert.equal(tokens.token_type, "Bearer");
  await assert.rejects(exchange(db, { grant_type: "authorization_code", client_id: client.clientId, code: code2, code_verifier: verifier }), /used/);
  const owner = await verifyToken(db, tokens.access_token);
  assert.equal(owner?.name, "Claude");
  assert.equal(owner?.kind, "oauth");

  const next = await exchange(db, { grant_type: "refresh_token", client_id: client.clientId, refresh_token: tokens.refresh_token });
  assert.equal(await verifyToken(db, tokens.access_token), null, "the old access token stops");
  assert.ok(await verifyToken(db, next.access_token));
  await assert.rejects(exchange(db, { grant_type: "refresh_token", client_id: client.clientId, refresh_token: tokens.refresh_token }), /not valid/);
  assert.equal((await listTokens(db, "auth0|designer")).filter((t) => t.kind === "oauth").length, 1);
});

test("the MCP endpoint and OAuth discovery are reachable without a studio session, the approval form is not", () => {
  for (const p of ["/api/mcp", "/api/oauth/token", "/api/oauth/register", "/api/oauth/revoke", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server"])
    assert.equal(isPublicTokenRoute(p), true, p);
  for (const p of ["/api/oauth/authorize", "/oauth/authorize", "/api/mcp/x", "/api/user/mcp-tokens"]) assert.equal(isPublicTokenRoute(p), false, p);
});
