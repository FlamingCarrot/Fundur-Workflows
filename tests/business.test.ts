import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { saveProviderKey, saveRoleModel } from "../src/lib/ai/settings";
import type { ChatFn, ChatRequest, ChatResult } from "../src/lib/ai/chat-stream";
import { createProject, getProject, projectDbId } from "../src/lib/projects/store";
import { DEFAULT_WORKFLOW_ID } from "../src/lib/workflow";
import { businessSettings, isOverdue, lineCents, money, timeLines, totals, type DocLine, type TimeEntry } from "../src/lib/business/model";
import {
  addEntry,
  addLead,
  createDoc,
  deleteDraft,
  enquiryStudio,
  enquiryToken,
  getDoc,
  listLeads,
  listTime,
  markSent,
  publicDoc,
  respondToProposal,
  runningTimer,
  saveSettings,
  setDocStatus,
  startTimer,
  stopTimer,
  updateDoc,
} from "../src/lib/business/store";
import { invoiceLines } from "../src/lib/business/drafts";
import { businessOverview, moneyFacts } from "../src/lib/business/overview";
import { autopilotAgenda, DEFAULT_LEVELS } from "../src/lib/autopilot/model";
import { projectAsks, saveAutopilot } from "../src/lib/autopilot/store";
import { runAutopilot } from "../src/lib/autopilot/run";
import { BACKUP_TABLES } from "../src/lib/backup/backup";
import "../src/lib/ai/tools";

process.env.AUTH0_SECRET = "test-secret-for-key-derivation-0123456789";
const ORIGIN = "https://fundur.test";

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

async function setup() {
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
  const user = await syncUser(db, { sub: "auth0|designer", email: "designer@example.com", email_verified: true, name: "Designer" });
  const projectId = (await projectDbId(db, ws, "harbour-house"))!;
  return { db, ws, projectId, userId: user.id };
}

const line = (description: string, quantity: number, unitCents: number, markupPct = 0): DocLine => ({ id: description, description, quantity, unitCents, kind: "fee", markupPct });

test("totals: lines with markup, and VAT on top", () => {
  assert.equal(lineCents(line("Chair", 2, 10_000, 20)), 24_000);
  const t = totals([line("Fee", 1, 100_000), line("Chair", 2, 10_000, 20)], 15);
  assert.deepEqual(t, { subtotalCents: 124_000, vatCents: 18_600, totalCents: 142_600 });
  assert.match(money(142_600), /^R1\s426[.,]00$/);
  assert.equal(totals([], 15).totalCents, 0);
});

test("time becomes one invoice line per phase and rate", () => {
  const settings = businessSettings.parse({ hourlyRateCents: 90_000 });
  const entry = (id: string, phaseKey: string, minutes: number, extra: Partial<TimeEntry> = {}): TimeEntry =>
    ({ id, phaseKey, minutes, billable: true, invoiceId: null, endedAt: "2026-10-02T10:00:00Z", startedAt: "2026-10-02T09:00:00Z", rateCents: null, ...extra }) as TimeEntry;
  const lines = timeLines(
    [entry("a", "discovery", 90), entry("b", "discovery", 30), entry("c", "concept", 60), entry("d", "concept", 60, { invoiceId: "x" }), entry("e", "concept", 60, { billable: false })],
    settings,
    (k) => (k === "discovery" ? "Discovery" : "Concept")
  );
  assert.equal(lines.length, 2);
  const disc = lines.find((l) => l.description.includes("Discovery"))!;
  assert.equal(disc.quantity, 2);
  assert.equal(disc.unitCents, 90_000);
  assert.deepEqual(disc.timeEntryIds?.sort(), ["a", "b"]);
});

test("documents: drafts change, sending numbers them and makes a link, sent ones are fixed", async () => {
  const { db, ws, userId, projectId } = await setup();
  await saveSettings(db, ws, userId, { vatRegistered: true, vatNumber: "4123456789", paymentTermsDays: 7 });
  const doc = await createDoc(db, ws, userId, { kind: "invoice", projectId, input: { title: "Concept fee", lines: [line("Concept design", 1, 2_000_000)] } });
  assert.equal(doc.status, "draft");
  assert.equal(doc.number, null);
  assert.equal(doc.vatRate, 15);
  assert.equal(doc.totals.totalCents, 2_300_000);

  const edited = await updateDoc(db, ws, doc.id, { lines: [line("Concept design", 1, 3_000_000)] });
  assert.equal(edited.totals.totalCents, 3_450_000);

  const sent = await markSent(db, ws, doc.id, ORIGIN);
  assert.equal(sent.status, "sent");
  assert.equal(sent.number, "INV-0001");
  assert.ok(sent.link?.startsWith(`${ORIGIN}/d/`));
  assert.equal(sent.dueDate, (() => { const d = new Date(`${sent.issueDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return d.toISOString().slice(0, 10); })());
  await assert.rejects(updateDoc(db, ws, doc.id, { title: "Changed" }), /can't change/);
  await assert.rejects(deleteDraft(db, ws, doc.id), /Only drafts/);

  // The second one sent takes the next number; re-sending keeps it.
  const second = await createDoc(db, ws, userId, { kind: "invoice", input: { lines: [line("Site visit", 1, 150_000)] } });
  assert.equal((await markSent(db, ws, second.id, ORIGIN)).number, "INV-0002");
  assert.equal((await markSent(db, ws, doc.id, ORIGIN)).number, "INV-0001");

  // The link shows it to anyone holding it, without the studio's internals.
  const token = sent.link!.split("/d/")[1];
  const seen = await publicDoc(db, token);
  assert.equal(seen?.doc.number, "INV-0001");
  assert.equal(seen?.doc.projectSlug, null);
  assert.equal(await publicDoc(db, "x".repeat(43)), null);

  // Part payment, then the rest makes it paid.
  assert.equal((await setDocStatus(db, ws, doc.id, { status: "sent", paidCents: 1_000_000 })).paidCents, 1_000_000);
  assert.equal((await setDocStatus(db, ws, doc.id, { status: "sent", paidCents: 3_450_000 })).status, "paid");

  // Voiding kills the link.
  await setDocStatus(db, ws, second.id, { status: "void" });
  assert.equal(await publicDoc(db, (await getDoc(db, ws, second.id, ORIGIN))?.link?.split("/d/")[1] ?? "x".repeat(43)), null);
});

test("overdue: a sent invoice past its due day", () => {
  assert.ok(isOverdue({ kind: "invoice", status: "sent", dueDate: "2026-10-01" }, "2026-10-02"));
  assert.ok(!isOverdue({ kind: "invoice", status: "paid", dueDate: "2026-10-01" }, "2026-10-02"));
  assert.ok(!isOverdue({ kind: "proposal", status: "sent", dueDate: "2026-10-01" }, "2026-10-02"));
});

test("a client accepts a proposal from its link with their name, once", async () => {
  const { db, ws, userId } = await setup();
  const lead = await addLead(db, ws, { name: "Thandi", email: "thandi@example.com", phone: "", company: "", budget: "R300k", message: "Two bedrooms in Sea Point" }, "manual");
  const doc = await createDoc(db, ws, userId, { kind: "proposal", leadId: lead.id, input: { title: "Design fees", party: { name: "Thandi", email: "thandi@example.com", address: "", vatNumber: "" }, lines: [line("Concept", 1, 1_500_000)] } });
  assert.match(doc.terms, /./, "the studio's standard terms are attached");
  const sent = await markSent(db, ws, doc.id, ORIGIN);
  const token = sent.link!.split("/d/")[1];
  await assert.rejects(respondToProposal(db, token, { accept: true, name: "T", from: "1.2.3.4" }), /full name/);
  const accepted = await respondToProposal(db, token, { accept: true, name: "Thandi Mokoena", from: "1.2.3.4" });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.acceptedName, "Thandi Mokoena");
  await assert.rejects(respondToProposal(db, token, { accept: false, name: "", from: "1.2.3.4" }), /already accepted/);
  assert.equal((await listLeads(db, ws))[0].status, "won");
});

test("time: one running timer each, logged time, and invoices claim it", async () => {
  const { db, ws, userId, projectId } = await setup();
  await startTimer(db, ws, userId, { projectId, phaseKey: "discovery" });
  await startTimer(db, ws, userId, { projectId, phaseKey: "concept" });
  const running = await runningTimer(db, ws, userId);
  assert.equal(running?.phaseKey, "concept");
  await stopTimer(db, ws, userId);
  assert.equal(await runningTimer(db, ws, userId), null);
  await addEntry(db, ws, userId, { projectId, phaseKey: "discovery", day: "2026-10-05", minutes: 180, note: "Site measure" });
  await assert.rejects(addEntry(db, ws, userId, { projectId, day: "2026-10-05", minutes: 2000 }), /a day/);

  const project = (await getProject(db, ws, "harbour-house"))!;
  const lines = await invoiceLines(db, ws, projectId, project, { time: true, items: false });
  const disc = lines.find((l) => l.description.includes("Discovery"));
  assert.ok(disc && disc.quantity >= 3 && disc.quantity < 3.1, "the measure and the minute-long timer");
  const inv = await createDoc(db, ws, userId, { kind: "invoice", projectId, input: { lines } });
  const billed = (await listTime(db, ws, { projectId })).filter((e) => e.invoiceId === inv.id);
  assert.ok(billed.length >= 1);
  // The same time can't go on a second invoice; nothing is left to bill.
  await assert.rejects(createDoc(db, ws, userId, { kind: "invoice", projectId, input: { lines } }), /already on another invoice/);
  assert.equal((await invoiceLines(db, ws, projectId, project, { time: true, items: false })).length, 0);
  // Deleting the draft frees it again.
  await deleteDraft(db, ws, inv.id);
  assert.ok((await invoiceLines(db, ws, projectId, project, { time: true, items: false })).length >= 1);
});

test("enquiries: the public form finds the studio by its link and holds back bursts", async () => {
  const { db, ws } = await setup();
  const token = await enquiryToken(db, ws);
  assert.equal(token, await enquiryToken(db, ws), "the link stays the same");
  assert.equal((await enquiryStudio(db, token))?.workspaceId, ws);
  const fresh = await enquiryToken(db, ws, true);
  assert.equal(await enquiryStudio(db, token), null, "a new link retires the old one");
  assert.ok(await enquiryStudio(db, fresh));
  const e = { name: "Sam", email: "sam@example.com", phone: "", company: "", budget: "", message: "Kitchen" };
  for (let i = 0; i < 3; i++) await addLead(db, ws, e, "form");
  await assert.rejects(addLead(db, ws, e, "form"), /already have your message/);
  await assert.rejects(addLead(db, ws, { ...e, website: "spam.example" }, "form"));
  assert.equal((await listLeads(db, ws)).length, 3);
});

test("overview and the autopilot's money agenda", async () => {
  const { db, ws, userId, projectId } = await setup();
  await addEntry(db, ws, userId, { projectId, phaseKey: "discovery", day: "2026-10-05", minutes: 600 });
  const project = (await getProject(db, ws, "harbour-house"))!;
  const facts = await moneyFacts(db, ws, { projectId, slug: "harbour-house", name: project.name, client: project.client }, "2026-10-13");
  assert.equal(facts.hasProposal, false);
  assert.equal(facts.unbilledMinutes, 600);
  assert.equal(facts.unbilledCents, 850_000);
  const agenda = autopilotAgenda(project, DEFAULT_LEVELS, { money: facts, today: "2026-10-13" });
  const money = agenda.filter((a) => a.kind === "money").map((a) => a.text).join("\n");
  assert.match(money, /draft_proposal/);
  assert.match(money, /draft_invoice/);
  assert.equal(autopilotAgenda(project, { ...DEFAULT_LEVELS, money: "off" }, { money: facts, today: "2026-10-13" }).filter((a) => a.kind === "money").length, 0);

  const inv = await createDoc(db, ws, userId, { kind: "invoice", projectId, input: { lines: [line("Fee", 1, 500_000)], issueDate: "2026-09-01", dueDate: "2026-09-15" } });
  await markSent(db, ws, inv.id, ORIGIN);
  const overview = await businessOverview(db, ws, "2026-10-13");
  assert.equal(overview.totals.overdueCents, 500_000);
  assert.equal(overview.projects[0].unbilledCents, 850_000);
  const later = await moneyFacts(db, ws, { projectId, slug: "harbour-house", name: project.name, client: project.client }, "2026-10-13");
  assert.equal(later.overdue[0].number, "INV-0001");
  assert.match(autopilotAgenda(project, DEFAULT_LEVELS, { money: later, today: "2026-10-13" }).map((a) => a.text).join("\n"), /overdue/);
});

test("the autopilot drafts an invoice, never sends it, and asks her to check it", async () => {
  const { db, ws, userId, projectId } = await setup();
  await saveProviderKey(db, "openrouter", "sk-or-test-key-1234", "auth0|admin");
  await saveRoleModel(db, "orchestrator", { provider: "openrouter", model: "top/model", inputUsdPerMTok: 5, outputUsdPerMTok: 25, zarPerUsd: 18 }, "auth0|admin");
  await addEntry(db, ws, userId, { projectId, phaseKey: "discovery", day: "2026-10-05", minutes: 600 });
  const requests: ChatRequest[] = [];
  const steps: Partial<ChatResult>[] = [
    { toolCalls: [{ id: "1", name: "draft_invoice", input: { includeTime: true } }] },
    { text: "Drafted the invoice for your 10 hours." },
  ];
  const chat: ChatFn = async (_p, _k, req) => {
    requests.push(req);
    return { text: "", toolCalls: [], inputTokens: 100, outputTokens: 10, ...steps[Math.min(requests.length - 1, steps.length - 1)] };
  };
  const out = await runAutopilot({ db, workspaceId: ws, projectId, slug: "harbour-house", userId, trigger: "manual", chat });
  assert.equal(out.status, "done");
  assert.ok(requests[0].tools?.some((t) => t.name === "draft_invoice"));
  const [doc] = await db.query<{ status: string; ai_drafted: boolean; id: string }>("SELECT id, status, ai_drafted FROM business_docs WHERE kind = 'invoice'");
  assert.equal(doc.status, "draft");
  assert.equal(doc.ai_drafted, true);
  const asks = await projectAsks(db, projectId, "open");
  const check = asks.find((a) => a.kind === "document");
  assert.equal(check?.link, `/business/docs/${doc.id}`);

  // With money on "Ask me" the drafting tools are not offered at all.
  await saveAutopilot(db, ws, projectId, userId, { levels: { ...DEFAULT_LEVELS, money: "ask" } });
  requests.length = 0;
  await runAutopilot({ db, workspaceId: ws, projectId, slug: "harbour-house", userId, trigger: "manual", chat });
  if (requests.length) assert.ok(!requests[0].tools?.some((t) => t.name === "draft_invoice"));
});

test("business tables are backed up", () => {
  for (const t of ["business_settings", "leads", "business_docs", "time_entries"]) assert.ok((BACKUP_TABLES as readonly string[]).includes(t), t);
  assert.ok(BACKUP_TABLES.indexOf("leads") < BACKUP_TABLES.indexOf("business_docs"));
  assert.ok(BACKUP_TABLES.indexOf("business_docs") < BACKUP_TABLES.indexOf("time_entries"));
});

test("only the owner's assistant sees or drafts money", async () => {
  const { db, ws, projectId, userId } = await setup();
  const { runTool } = await import("../src/lib/ai/tools/registry");
  const project = (await getProject(db, ws, "harbour-house"))!;
  const ctx = (who: string) => ({ db, run: { workspaceId: ws, projectId, userId: who }, project, readFile: async () => null }) as never;
  const member = await syncUser(db, { sub: "auth0|member", email: "member@example.com", email_verified: true, name: "Member" });
  await db.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING", [ws, member.id]);
  const refused = await runTool(ctx(member.id), "read_project_money", {});
  assert.equal(refused.isError, true);
  assert.match(String(refused.content), /owner/);
  assert.equal((await runTool(ctx(userId), "read_project_money", {})).isError, undefined);
});

test("overdue invoices are chased once a week, not every run", async () => {
  const { db, ws, userId, projectId } = await setup();
  const { markReminded } = await import("../src/lib/business/store");
  const inv = await createDoc(db, ws, userId, { kind: "invoice", projectId, input: { lines: [line("Fee", 1, 500_000)], issueDate: "2026-09-01", dueDate: "2026-09-15" } });
  await markSent(db, ws, inv.id, ORIGIN);
  const p = { projectId, slug: "harbour-house", name: "Harbour House", client: "Harbour Holdings" };
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await moneyFacts(db, ws, p, today)).overdue.length, 1);
  await markReminded(db, ws, [inv.id]);
  assert.equal((await moneyFacts(db, ws, p, today)).overdue.length, 0);
  const nextWeek = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
  assert.equal((await moneyFacts(db, ws, p, nextWeek)).overdue.length, 1);
});

test("an accepted proposal puts the first invoice on the autopilot's agenda", async () => {
  const { db, ws, userId, projectId } = await setup();
  const doc = await createDoc(db, ws, userId, { kind: "proposal", projectId, input: { title: "Design fees", lines: [line("Deposit", 1, 1_000_000)] } });
  const token = (await markSent(db, ws, doc.id, ORIGIN)).link!.split("/d/")[1];
  assert.equal((await publicDoc(db, token))?.workspaceId, ws);
  await respondToProposal(db, token, { accept: true, name: "Thandi \"Boss\" Mokoena", from: "x" });
  const project = (await getProject(db, ws, "harbour-house"))!;
  const p = { projectId, slug: "harbour-house", name: project.name, client: project.client };
  const facts = await moneyFacts(db, ws, p);
  assert.equal(facts.acceptedNotInvoiced?.by, "Thandi Boss Mokoena");
  assert.match(autopilotAgenda(project, DEFAULT_LEVELS, { money: facts }).map((a) => a.text).join("\n"), /accepted "Design fees": draft the first invoice/);
  await createDoc(db, ws, userId, { kind: "invoice", projectId, input: { lines: [line("Deposit", 1, 1_000_000)] } });
  assert.equal((await moneyFacts(db, ws, p)).acceptedNotInvoiced, null);
});

test("logged time can be corrected until it is billed", async () => {
  const { db, ws, userId, projectId } = await setup();
  const { updateEntry } = await import("../src/lib/business/store");
  const e = await addEntry(db, ws, userId, { projectId, day: "2026-10-05", minutes: 60 });
  const changed = await updateEntry(db, ws, e.id, { minutes: 150, billable: false, phaseKey: "concept" });
  assert.equal(changed.minutes, 150);
  assert.equal(changed.billable, false);
  assert.equal(changed.phaseKey, "concept");
  assert.equal(Date.parse(changed.endedAt!) - Date.parse(changed.startedAt), 150 * 60_000);
  await startTimer(db, ws, userId, { projectId });
  const running = (await runningTimer(db, ws, userId))!;
  await assert.rejects(updateEntry(db, ws, running.id, { minutes: 30 }), /Stop the timer/);
});
