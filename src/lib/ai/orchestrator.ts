import type { Db } from "@/lib/db";
import type { Project } from "@/lib/studio/types";
import { getForm, getPhase, label } from "@/lib/workflow";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { getPlanState } from "@/lib/plan/store";
import { AiBudgetError, type BudgetAlert } from "./budget";
import type { ChatFn, ChatMessage, ToolCall, ToolResult } from "./chat-stream";
import {
  addMessage,
  createProposal,
  finishMessage,
  listMessages,
  type ChatAttachment,
  type ChatEvent,
  type ProposalView,
} from "./chat-store";
import { ProviderError, ProviderKeyError, ProviderRefusalError } from "./providers";
import { AiNotConfiguredError, runChat } from "./runs";
import { asDocument, classifyFile, readStoredText, UNTRUSTED_NOTE } from "./tools/documents";
import { moduleAccess } from "@/lib/billing/plans";
import { planForUser } from "@/lib/billing/store";
import { listTools, runTool, toolSpecs, type AiTool, type ProposalDraft, type ToolContext } from "./tools";
import { describeProject } from "./tools/project";
import { summarisePlan } from "./tools/plan";

/**
 * The orchestrator (P4-10): the top model, talking with the designer about one
 * project. It is given the project, its brief and its plan up front, may call
 * any registered tool (several at once; they run in parallel), and streams its
 * words as it writes them. Files dropped into the chat are read and filed by
 * worker models in parallel before it answers (P4-11).
 */

/** Model turns allowed for one reply, so a confused model cannot loop forever. */
export const MAX_STEPS = 6;
/** Earlier messages sent along with each turn. */
const HISTORY = 30;

export type StreamEvent =
  | { type: "start"; userMessageId: string; messageId: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; name: string; label: string; status: "running" | "done" | "failed"; note?: string }
  | { type: "proposal"; proposal: ProposalView }
  | { type: "flag"; text: string }
  | { type: "alert"; alert: BudgetAlert }
  | { type: "done"; messageId: string; costZar: number }
  | { type: "error"; error: string; code?: string };

export interface TurnInput {
  text: string;
  attachments: ChatAttachment[];
  /** The phase or task she asked from, when the chat was opened on one. */
  phaseKey?: string;
  taskId?: string;
}

export interface TurnDeps {
  db: Db;
  workspaceId: string;
  /** The project's database id. */
  projectId: string;
  userId: string;
  project: Project;
  readFile: ToolContext["readFile"];
  chat?: ChatFn;
  fetchImpl?: typeof fetch;
}

export function systemPrompt(
  project: Project,
  planSummary: string | null,
  today = new Date(),
  available: AiTool[] = listTools()
): string {
  const fields = getForm(project, "brief")?.fields ?? [];
  const brief = fields.length
    ? fields.map((f) => `- ${f.label}: ${project.brief[f.key]?.trim() || "(empty)"}`).join("\n")
    : "(this workflow has no brief)";
  const tools = available
    .map((t) => `- ${t.name} (${MODULE_REGISTRY[t.module]?.name ?? t.module}): ${t.description}`)
    .join("\n");
  const phase = getPhase(project, project.currentPhase);
  return [
    `You are Fundur's assistant, working with an interior designer on one project. Today is ${today.toISOString().slice(0, 10)}.`,
    "Answer from the project below and from your tools. Be brief and plain: short paragraphs or a short list, no headings. Money is in rand (R) and sizes are metric.",
    "You cannot change the project yourself. Tools that propose or draft a change prepare it, and the designer confirms it with a button; say what you prepared and that it is waiting for them, never that it is done.",
    "Hand routine formatting of longer text to format_text rather than doing it yourself. Call several tools at once when they do not depend on each other.",
    "If a tool says its work did not pass review, tell the designer plainly that it needs checking.",
    UNTRUSTED_NOTE,
    "",
    "Your tools:",
    tools,
    "",
    `<project currentPhase="${phase?.name ?? project.currentPhase}">`,
    describeProject(project),
    "</project>",
    "",
    `<brief name="${label(project, "brief", "Brief")}">`,
    brief,
    "</brief>",
    "",
    "<plan>",
    planSummary ?? "No floor plan has been drawn or imported yet.",
    "</plan>",
  ].join("\n");
}

function friendlyError(err: unknown): { error: string; code?: string } | null {
  if (err instanceof AiNotConfiguredError) return { error: "No AI model is set up yet. The Admin picks one in Settings.", code: "not_configured" };
  if (err instanceof AiBudgetError) return { error: err.message, code: "budget" };
  if (err instanceof ProviderKeyError) return { error: "The AI key no longer works. The Admin needs to enter it again in Settings." };
  if (err instanceof ProviderRefusalError) return { error: err.message };
  if (err instanceof ProviderError) return { error: "The AI provider had a problem. Try again in a moment." };
  return null;
}

/**
 * One reply: saves her message, files any attachments, runs the model and its
 * tools until it answers, and saves the reply with what it did. Every event is
 * passed to `emit` as it happens, for streaming to the browser.
 */
export async function runTurn(deps: TurnDeps, input: TurnInput, emit: (e: StreamEvent) => void): Promise<void> {
  const { db, workspaceId, projectId, userId, project } = deps;
  const history = await listMessages(db, workspaceId, projectId, HISTORY);
  const userMessageId = await addMessage(db, workspaceId, projectId, {
    userId,
    role: "user",
    content: input.text,
    attachments: input.attachments,
  });
  const messageId = await addMessage(db, workspaceId, projectId, { userId, role: "assistant", content: "" });
  emit({ type: "start", userMessageId, messageId });

  const events: ChatEvent[] = [];
  let reply = "";
  // Tools of modules the workspace's plan leaves out are neither offered nor run.
  const { limits } = await planForUser(db, workspaceId, userId);
  const allowsModule = (key: string) => moduleAccess(limits, key, project.workflowId) !== "none";
  const available = listTools().filter((t) => allowsModule(t.module));
  const toolCtx: ToolContext = {
    db,
    run: {
      workspaceId,
      projectId,
      userId,
      phaseKey: input.phaseKey,
      taskId: input.taskId,
      chatMessageId: messageId,
      onAlert: (alert) => emit({ type: "alert", alert }),
    },
    project,
    readFile: deps.readFile,
    fetchImpl: deps.fetchImpl,
    allowsModule,
  };
  const propose = async (drafts: ProposalDraft[] = []) => {
    for (const d of drafts) emit({ type: "proposal", proposal: await createProposal(db, workspaceId, projectId, messageId, d) });
  };
  const flag = (text: string) => {
    events.push({ type: "flag", text });
    emit({ type: "flag", text });
  };

  try {
    // Files first: each is read and filed by a worker, all at once.
    const filed = await Promise.all(
      input.attachments.map(async (a, i) => {
        const id = `file-${i}`;
        emit({ type: "tool", id, name: "file_document", label: `Filing ${a.name}`, status: "running" });
        const read = await readStoredText(deps.readFile, a.storageKey, a.name).catch(() => ({ text: undefined, error: "unreadable" }));
        const filing = await classifyFile(toolCtx, { name: a.name, contentType: a.contentType, text: read.text }, input.text);
        const phase = getPhase(project, filing.phaseKey);
        await propose([
          {
            summary: `File ${a.name} in ${phase?.name ?? filing.phaseKey} as ${filing.kind.toLowerCase()}`,
            mutation: {
              type: "addDocuments",
              documents: [
                {
                  id: crypto.randomUUID(),
                  name: a.name,
                  sizeBytes: a.sizeBytes,
                  phaseKey: filing.phaseKey,
                  uploadedAt: new Date().toISOString(),
                  clientVisible: false,
                  storageKey: a.storageKey,
                  kind: filing.kind,
                },
              ],
            },
          },
        ]);
        const note = `${phase?.name ?? filing.phaseKey}, ${filing.kind}`;
        events.push({ type: "tool", name: "file_document", label: `Filed ${a.name}`, ok: true, note });
        emit({ type: "tool", id, name: "file_document", label: `Filing ${a.name}`, status: "done", note });
        return { a, filing, text: read.text };
      })
    );

    const plan = await getPlanState(db, workspaceId, project.id);
    const system = systemPrompt(project, plan?.plan ? summarisePlan(plan.plan) : null, new Date(), available);
    const userContent = [
      input.text,
      ...filed.map(({ a, filing, text }) =>
        [
          `[Attached ${a.name}. Proposed filing: ${filing.phaseKey}, ${filing.kind}${filing.reason ? ` (${filing.reason})` : ""}; waiting for the designer to confirm.]`,
          text ? asDocument(a.name, text.slice(0, 20_000)) : "",
        ]
          .filter(Boolean)
          .join("\n")
      ),
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: ChatMessage[] = [
      ...history.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: "user", content: userContent || "(files attached)" },
    ];
    const specs = toolSpecs(available);

    for (let step = 0; step < MAX_STEPS; step++) {
      let stepText = "";
      // Words from separate model turns are kept apart by a blank line.
      const separator = reply ? "\n\n" : "";
      const turn = await runChat(
        db,
        { ...toolCtx.run, task: "chat", role: "orchestrator", attempt: step + 1 },
        { system, messages, tools: specs, maxTokens: 4_000 },
        (delta) => {
          emit({ type: "text", delta: stepText ? delta : separator + delta });
          stepText += delta;
        },
        { chat: deps.chat, fetchImpl: deps.fetchImpl }
      );
      if (stepText) reply += separator + stepText;
      if (!turn.toolCalls.length) break;

      messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
      const results = await Promise.all(turn.toolCalls.map((call) => runOneTool(toolCtx, call, events, emit, propose, flag)));
      messages.push({ role: "tool", results });
      if (step === MAX_STEPS - 1) {
        const note = "I stopped there: this needed more steps than I take for one reply. Ask me to carry on.";
        const text = (reply ? "\n\n" : "") + note;
        reply += text;
        emit({ type: "text", delta: text });
      }
    }
  } catch (err) {
    const friendly = friendlyError(err);
    if (!friendly) {
      events.push({ type: "error", text: "Something went wrong answering this." });
      await finishMessage(db, messageId, reply, events);
      throw err;
    }
    events.push({ type: "error", text: friendly.error });
    emit({ type: "error", ...friendly });
  }
  await finishMessage(db, messageId, reply, events);
  const [cost] = await db.query<{ total: string | number }>(
    "SELECT COALESCE(SUM(cost_zar), 0) AS total FROM ai_runs WHERE chat_message_id = $1",
    [messageId]
  );
  emit({ type: "done", messageId, costZar: Number(cost?.total ?? 0) });
}

async function runOneTool(
  ctx: ToolContext,
  call: ToolCall,
  events: ChatEvent[],
  emit: (e: StreamEvent) => void,
  propose: (drafts?: ProposalDraft[]) => Promise<void>,
  flag: (text: string) => void
): Promise<ToolResult> {
  const label = listTools().find((t) => t.name === call.name)?.label ?? call.name;
  emit({ type: "tool", id: call.id, name: call.name, label, status: "running" });
  try {
    const out = await runTool(ctx, call.name, call.input);
    await propose(out.proposals);
    if (out.flag) flag(out.flag);
    events.push({ type: "tool", name: call.name, label, ok: !out.isError });
    emit({ type: "tool", id: call.id, name: call.name, label, status: out.isError ? "failed" : "done" });
    return { id: call.id, name: call.name, content: out.content, isError: out.isError };
  } catch (err) {
    // Budget and setup problems end the reply; anything else goes back to the model to work around.
    if (err instanceof AiBudgetError || err instanceof AiNotConfiguredError) throw err;
    const message = friendlyError(err)?.error ?? "The tool failed.";
    events.push({ type: "tool", name: call.name, label, ok: false, note: message });
    emit({ type: "tool", id: call.id, name: call.name, label, status: "failed", note: message });
    if (!(err instanceof ProviderError) && !(err instanceof ProviderKeyError)) console.error(`Tool ${call.name} failed`, err);
    return { id: call.id, name: call.name, content: `The tool failed: ${message}`, isError: true };
  }
}

