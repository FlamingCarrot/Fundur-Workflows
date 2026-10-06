import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { briefPrompt, briefSchema, parseBriefDraft } from "../src/lib/ai/brief";
import { extractText, UnreadableFileError } from "../src/lib/ai/extract";
import { AiNotConfiguredError, costOf, runAi } from "../src/lib/ai/runs";
import { ProviderRefusalError } from "../src/lib/ai/providers";
import { saveDefaultModel, saveProviderKey } from "../src/lib/ai/settings";
import { BRIEF_DRAFT_TASK, createProject, getProject, projectDbId } from "../src/lib/projects/store";
import { DEFAULT_WORKFLOW_ID, getForm } from "../src/lib/workflow";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";
const fields = getForm(DEFAULT_WORKFLOW_ID, "brief")!.fields;

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

async function docx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** A one-page PDF with one line of text, written by hand. */
function pdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

test("notes are read from text, Word and PDF files", async () => {
  assert.equal(await extractText("notes.txt", new TextEncoder().encode("140 people")), "140 people");
  assert.match(await extractText("Meeting.DOCX", await docx(["Headcount 140", "Budget R 4.8m"])), /Headcount 140\s+Budget R 4\.8m/);
  assert.match(await extractText("minutes.pdf", pdf("Two floors of 1100 m2")), /Two floors of 1100 m2/);
  await assert.rejects(extractText("old.doc", new Uint8Array([1, 2])), UnreadableFileError);
  await assert.rejects(extractText("broken.docx", new Uint8Array([1, 2, 3])), UnreadableFileError);
  await assert.rejects(extractText("photo.jpg", new Uint8Array([1])), UnreadableFileError);
});

test("the prompt names every field of the workflow's form and carries the notes", () => {
  const { system, prompt } = briefPrompt({
    workflowName: "Corporate Interior Fit-out",
    formLabel: "Design Brief",
    fields,
    existing: { clientName: "Harbour Holdings" },
    sources: [{ name: "minutes.docx", text: "140 people over two floors" }],
  });
  for (const f of fields) assert.ok(system.includes(`"${f.key}": ${f.label}`), f.key);
  assert.match(system, /Do not invent/);
  assert.match(prompt, /Client: Harbour Holdings/);
  assert.match(prompt, /<notes source="minutes.docx">\n140 people over two floors\n<\/notes>/);

  const schema = briefSchema(fields) as { required: string[]; additionalProperties: boolean };
  assert.deepEqual(schema.required, fields.map((f) => f.key));
  assert.equal(schema.additionalProperties, false);
});

test("the answer is read leniently and only the form's fields come back", () => {
  const draft = parseBriefDraft('Here it is:\n```json\n{"headcount": 140, "targetBudget": " R 4.8m ", "bogus": "x"}\n```', fields);
  assert.equal(draft.headcount, "140");
  assert.equal(draft.targetBudget, "R 4.8m");
  assert.equal(draft.departments, "");
  assert.equal("bogus" in draft, false);
  assert.throws(() => parseBriefDraft("I could not find anything", fields));
});

test("cost uses the provider's own figure when it gives one, else the model's prices", () => {
  assert.equal(costOf({ inputTokens: 1_000_000, outputTokens: 100_000 }, { inputUsdPerMTok: 4, outputUsdPerMTok: 20 }), 6);
  assert.equal(costOf({ inputTokens: 5, outputTokens: 5, reportedCostUsd: 0.0123 }, { inputUsdPerMTok: 4, outputUsdPerMTok: 20 }), 0.0123);
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function projectSetup() {
  const db = await freshDb();
  const ws = await ensureWorkspace(db, { sub: "auth0|designer" });
  await createProject(db, ws, {
    id: "harbour-house",
    name: "Harbour House",
    client: "Harbour Holdings",
    workflowId: DEFAULT_WORKFLOW_ID,
    startDate: "2026-10-01T00:00:00.000Z",
    swatch: "sage",
  });
  const projectId = (await projectDbId(db, ws, "harbour-house"))!;
  return { db, ws, ctx: { workspaceId: ws, projectId, userId: "auth0|designer", task: BRIEF_DRAFT_TASK } };
}

test("with no model set up, drafting says so and logs nothing", async () => {
  const { db, ctx } = await projectSetup();
  await assert.rejects(runAi(db, ctx, { system: "s", prompt: "p" }), AiNotConfiguredError);
  assert.equal((await db.query("SELECT 1 FROM ai_runs")).length, 0);
});

test("every call is logged, and the costs shown are the sums of the log", async () => {
  const { db, ws, ctx } = await projectSetup();
  await saveProviderKey(db, "anthropic", "sk-ant-test-key-1234", "auth0|admin");
  await saveDefaultModel(db, { provider: "anthropic", model: "claude-opus-5-5", inputUsdPerMTok: 4, outputUsdPerMTok: 20, zarPerUsd: 18 }, "auth0|admin");

  let sent: { model?: string; system?: string; output_config?: unknown } = {};
  const answer = (usage: { input_tokens: number; output_tokens: number }, stop = "end_turn") =>
    (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: '{"headcount":"140"}' }],
        stop_reason: stop,
        usage,
      });
    }) as typeof fetch;

  const run = await runAi(db, ctx, { system: "sys", prompt: "notes", schema: briefSchema(fields) }, answer({ input_tokens: 10_000, output_tokens: 1_000 }));
  assert.equal(sent.model, "claude-opus-5-5");
  assert.ok(sent.output_config, "asks for the brief's JSON shape");
  assert.equal(run.text, '{"headcount":"140"}');
  // 10k in at $4/M + 1k out at $20/M = $0.06 = R1.08
  assert.equal(Math.round(run.costUsd * 1e6) / 1e6, 0.06);
  assert.equal(Math.round(run.costZar * 1e4) / 1e4, 1.08);

  // A refused answer still used tokens: it is logged as failed, with its cost.
  await assert.rejects(
    runAi(db, ctx, { system: "sys", prompt: "notes" }, answer({ input_tokens: 5_000, output_tokens: 0 }, "refusal")),
    ProviderRefusalError
  );
  // Another task's call counts toward the project, not the brief.
  await runAi(db, { ...ctx, task: "assistant" }, { system: "s", prompt: "p" }, answer({ input_tokens: 1_000, output_tokens: 0 }));

  const runs = await db.query<{ task_name: string; outcome: string; prompt_tokens: number; cost_zar: string; model_name: string }>(
    "SELECT task_name, outcome, prompt_tokens, cost_zar, model_name FROM ai_runs ORDER BY created_at, prompt_tokens DESC"
  );
  assert.deepEqual(runs.map((r) => [r.task_name, r.outcome, r.prompt_tokens]), [
    [BRIEF_DRAFT_TASK, "success", 10_000],
    [BRIEF_DRAFT_TASK, "failed", 5_000],
    ["assistant", "success", 1_000],
  ]);
  const logged = runs.reduce((n, r) => n + Number(r.cost_zar), 0);
  const loggedBrief = runs.filter((r) => r.task_name === BRIEF_DRAFT_TASK).reduce((n, r) => n + Number(r.cost_zar), 0);

  const project = (await getProject(db, ws, "harbour-house"))!;
  assert.equal(project.aiSpendZar, logged);
  assert.equal(project.briefCostZar, loggedBrief);
  assert.equal(project.briefCostZar, 1.08 + 0.36);
});
