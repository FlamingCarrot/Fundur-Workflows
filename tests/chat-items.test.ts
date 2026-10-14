import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { saveProviderKey, saveRoleModel } from "../src/lib/ai/settings";
import { createProject, getProject, projectDbId } from "../src/lib/projects/store";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";
import { runTool, type ToolContext } from "../src/lib/ai/tools";
import { createDocument, getDocument, listVersions, restoreVersion, saveDocument } from "../src/lib/ai/chat-documents";
import { describeContext } from "../src/lib/ai/context";
import { markdownToHtml } from "../src/lib/ai/markdown";
import { safeImageUrl } from "../src/lib/ai/chat-items";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";

const MODEL = { provider: "openrouter" as const, model: "m/one", inputUsdPerMTok: 1, outputUsdPerMTok: 2, zarPerUsd: 18 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function setup(fetchImpl?: typeof fetch) {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  const db: Db = { query: async (text, params) => (await pg.query(text, params)).rows as never };
  const ws = await ensureWorkspace(db, { sub: "auth0|designer" });
  await createProject(db, ws, { id: "harbour", name: "Harbour", client: "H", workflowId: DEFAULT_WORKFLOW_ID, startDate: "2026-10-01T00:00:00.000Z", swatch: "sage" });
  const projectId = (await projectDbId(db, ws, "harbour"))!;
  await saveProviderKey(db, "openrouter", "sk-or-test-key-1234", "auth0|admin");
  await saveRoleModel(db, "orchestrator", MODEL, "auth0|admin");
  await saveRoleModel(db, "worker", MODEL, "auth0|admin");
  const ctx: ToolContext = {
    db,
    run: { workspaceId: ws, projectId, userId: "me" },
    project: (await getProject(db, ws, "harbour"))!,
    readFile: async () => null,
    fetchImpl,
  };
  return { db, ws, projectId, ctx };
}

test("links must be real https addresses, and become link cards", async () => {
  const { ctx } = await setup();
  const ok = await runTool(ctx, "show_link", { url: "https://www.sabs.co.za/", title: "SABS" });
  assert.deepEqual(ok.cards, [{ kind: "link", url: "https://www.sabs.co.za/", title: "SABS" }]);
  const bad = await runTool(ctx, "show_link", { url: "javascript:alert(1)", title: "x" });
  assert.equal(bad.isError, true);
  assert.equal(bad.cards, undefined);
  assert.equal(safeImageUrl("javascript:alert(1)"), false);
  assert.equal(safeImageUrl("/api/projects/harbour/documents/123e4567-e89b-12d3-a456-426614174000/file?inline=1"), true);
});

test("documents are written, edited with find and replace, versioned and restored", async () => {
  const { db, ws, projectId, ctx } = await setup();
  const made = await runTool(ctx, "create_document", { title: "Scope of work", content: "# Scope\n\n- Paint walls\n- Lay oak floor" });
  const card = made.cards![0];
  assert.equal(card.kind, "document");
  const id = (card as { id: string }).id;
  assert.match((card as { preview: string }).preview, /Scope Paint walls Lay oak floor/);

  const edited = await runTool(ctx, "edit_document", { id, edits: [{ find: "oak", replace: "white oak" }, { find: "missing", replace: "x" }] });
  assert.match(edited.content, /version 2/);
  assert.match(edited.content, /Not found.*missing/);
  assert.match((await getDocument(db, ws, projectId, "me", id))!.content, /white oak/);
  // Nothing to find at all is an error, and nothing is saved.
  assert.equal((await runTool(ctx, "edit_document", { id, edits: [{ find: "nope", replace: "x" }] })).isError, true);

  // Her save after the assistant's is refused when she started from the older version.
  assert.equal(await saveDocument(db, ws, projectId, "me", id, { content: "mine", expectedVersion: 1 }), "conflict");
  assert.deepEqual((await listVersions(db, ws, projectId, "me", id)).map((v) => v.version), [1]);
  const back = await restoreVersion(db, ws, projectId, "me", id, 1);
  assert.ok(back && back !== "conflict");
  assert.equal(back.version, 3);
  assert.doesNotMatch(back.content, /white oak/);

  // Another project's or another person's studio document can't be reached.
  const studio = await createDocument(db, ws, null, { userId: "me", title: "Mine", content: "x" });
  assert.equal(await getDocument(db, ws, null, "someone-else", studio.id), null);
  assert.equal(await getDocument(db, ws, projectId, "me", studio.id), null);
});

test("deep research plans questions, searches the web and writes a report with its sources", async () => {
  const bodies: { plugins?: unknown; messages: { content: string }[] }[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const system = body.messages[0].content as string;
    if (system.startsWith("Break a research question")) {
      return json({ choices: [{ message: { content: JSON.stringify({ title: "Acoustic panels in Cape Town", questions: ["Who supplies them?", "What do they cost?"] }) } }], usage: {} });
    }
    if (system.startsWith("You research")) {
      const q = body.messages[1].content as string;
      return json({
        choices: [{ message: { content: `Findings for ${q}`, annotations: [{ type: "url_citation", url_citation: { url: q.includes("supplies") ? "https://a.example/s" : "https://b.example/c", title: "Source" } }] } }],
        usage: {},
      });
    }
    return json({ choices: [{ message: { content: "Panels cost R900 to R1,400 per m² [2].\n\n## Suppliers\nTwo local suppliers [1]." } }], usage: {} });
  }) as typeof fetch;
  const { db, ws, projectId, ctx } = await setup(fetchImpl);
  const out = await runTool(ctx, "deep_research", { question: "Acoustic panels for an office in Cape Town" });
  const card = out.cards![0] as { kind: string; id: string; title: string; summary: string; sources: { url: string }[]; web: boolean };
  assert.equal(card.kind, "research");
  assert.equal(card.title, "Acoustic panels in Cape Town");
  assert.equal(card.web, true);
  assert.deepEqual(card.sources.map((s) => s.url), ["https://a.example/s", "https://b.example/c"]);
  assert.match(card.summary, /R900/);
  // Each question searched the web.
  assert.equal(bodies.filter((b) => b.plugins).length, 2);
  const doc = await getDocument(db, ws, projectId, "me", card.id);
  assert.match(doc!.content, /^# Acoustic panels in Cape Town[\s\S]*## Sources\n\n1\. \[Source\]\(https:\/\/a\.example\/s\)/);
});

test("the canvas and voice tell the assistant what she has open and how she listens", () => {
  const text = describeContext({ page: "other", selection: [], documentId: "123e4567-e89b-12d3-a456-426614174000", voice: true }, null);
  assert.match(text, /document 123e4567-e89b-12d3-a456-426614174000\] open in the canvas/);
  assert.match(text, /talking by voice/);
});

test("document Markdown becomes safe HTML", () => {
  const html = markdownToHtml("# Title <script>\n\n**bold** [ok](https://x.y) [bad](javascript:alert(1))\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done");
  assert.match(html, /<h1>Title &lt;script&gt;<\/h1>/);
  assert.match(html, /<strong>bold<\/strong> <a href="https:\/\/x.y"/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody>/);
  assert.match(html, /<li>☑ done<\/li>/);
});
