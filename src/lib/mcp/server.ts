import { NextResponse } from "next/server";
import type { Db } from "@/lib/db";
import "@/lib/ai/tools";
import { enabledTools, getTool, runTool, toolSpecs, type AiTool, type ProposalDraft, type ToolContext, type ToolOutcome } from "@/lib/ai/tools";
import { applyAction, canApplyDirectly, undoFor } from "@/lib/ai/actions";
import { addMessage, createProposal, logToolCall, type ChatEvent, type ProposalView } from "@/lib/ai/chat-store";
import { boardEditSummary } from "@/lib/ai/tools/board";
import { summarisePlan } from "@/lib/ai/tools/plan";
import { studioSystemPrompt, systemPrompt } from "@/lib/ai/orchestrator";
import { memoryPrompt } from "@/lib/ai/memory";
import { actOnProposal, ProposalActionError, type ProposalVerb } from "@/lib/ai/proposal-actions";
import { AiBudgetError } from "@/lib/ai/budget";
import { AiNotConfiguredError } from "@/lib/ai/runs";
import { ProviderError, ProviderKeyError, ProviderRefusalError } from "@/lib/ai/providers";
import type { ChatFn } from "@/lib/ai/chat-stream";
import { hasPermission } from "@/lib/auth/permissions";
import { moduleAccess } from "@/lib/billing/plans";
import { planForUser } from "@/lib/billing/store";
import { PlanLimitError } from "@/lib/billing/guard";
import { getPlanState } from "@/lib/plan/store";
import { getProject, listProjects, MutationError, projectDbId } from "@/lib/projects/store";
import type { Project } from "@/lib/studio/types";
import { getForm, getPhase, getWorkflow } from "@/lib/workflow";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { features, memberships, projectSlugs } from "@/lib/workspaces/store";
import { checkProject, type WorkspaceContext } from "@/lib/server/workspace-context";
import { isInProject, readFileBytes } from "@/lib/storage/blob";
import type { TokenOwner } from "./tokens";

/**
 * Fundur's MCP server (Model Context Protocol, Streamable HTTP): outside AI
 * apps (Claude, ChatGPT, Cursor, agents) get everything Fundur's own assistant
 * has, acting as the person who connected them.
 *
 * - Tools are the assistant's tool registry, read on every request, so a tool
 *   a module adds is offered here at once. Project tools take a `project`.
 * - Calls run with exactly her rights: her workspace role, the project's team
 *   access, the features switched on for her and her plan's modules.
 * - Changes go through the same path as the in-app assistant's: small
 *   reversible ones apply with an Undo, the rest wait for her to confirm. They
 *   are collected on one message per app, project and day in the project's
 *   chat, so she sees them there with their buttons, and any AI the tools
 *   call is logged and costed against that message like a reply's.
 * - The assistant's instructions are prompts; projects, briefs and plans are
 *   resources.
 */

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "fundur-workflows", title: "Fundur Workflows", version: "1.0.0" };

export interface McpSession {
  db: Db;
  ws: WorkspaceContext;
  owner: TokenOwner;
  /** The app's address, e.g. https://app.fundur.co, for links back into it. */
  origin: string;
  /** Test stand-ins. */
  chat?: ChatFn;
  fetchImpl?: typeof fetch;
  readFile?: ToolContext["readFile"];
}

/** Who a token acts for, checked afresh on every request: a person switched off or removed from the workspace loses access at once. */
export async function sessionFor(db: Db, owner: TokenOwner, origin: string): Promise<McpSession | { error: string }> {
  const [user] = await db.query<{ id: string; email: string | null; name: string | null; platform_role: string; status: string; active: boolean; view_mode: string }>(
    "SELECT id, email, name, platform_role, status, active, view_mode FROM users WHERE id = $1",
    [owner.userId]
  );
  if (!user || user.active === false) return { error: "This account has been deactivated." };
  if (user.status === "waiting") return { error: "This account is waiting for the Admin to let it in." };
  const workspace = (await memberships(db, user.id)).find((w) => w.id === owner.workspaceId);
  if (!workspace) return { error: "This token's workspace is no longer yours." };
  return {
    db,
    owner,
    origin,
    ws: {
      db,
      workspaceId: workspace.id,
      workspaceRole: workspace.role,
      features: await features(db, workspace.id, user.id),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        platformRole: user.platform_role === "admin" ? "admin" : "user",
        status: "active",
        active: true,
        viewMode: user.view_mode === "basic" ? "basic" : "admin",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// JSON-RPC

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}
export type RpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

class RpcError extends Error {
  constructor(
    public code: number,
    message: string
  ) {
    super(message);
  }
}

const isRequest = (m: unknown): m is RpcRequest =>
  !!m && typeof m === "object" && (m as RpcRequest).jsonrpc === "2.0" && typeof (m as RpcRequest).method === "string";

/** One message in, its answer out; null for notifications and for responses the client sent us. */
export async function handleMessage(session: McpSession, message: unknown): Promise<RpcResponse | null> {
  if (!isRequest(message)) {
    // A response to something we asked (we never ask), or junk.
    if (message && typeof message === "object" && ("result" in message || "error" in message)) return null;
    return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } };
  }
  const notification = message.id === undefined || message.id === null;
  try {
    const result = await dispatch(session, message.method, message.params ?? {});
    return notification ? null : { jsonrpc: "2.0", id: message.id!, result };
  } catch (err) {
    if (notification) return null;
    if (err instanceof RpcError) return { jsonrpc: "2.0", id: message.id!, error: { code: err.code, message: err.message } };
    console.error("MCP request failed", message.method, err);
    return { jsonrpc: "2.0", id: message.id!, error: { code: -32603, message: "Something went wrong on Fundur's side." } };
  }
}

async function dispatch(session: McpSession, method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: SERVER_INFO,
        instructions: serverInstructions(session),
      };
    }
    case "ping":
      return {};
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/roots/list_changed":
      return {};
    case "tools/list":
      return { tools: (await offeredTools(session)).map(({ spec }) => spec) };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, unknown>) : {};
      return callTool(session, name, args);
    }
    case "prompts/list":
      return { prompts: PROMPTS.map(({ name, title, description, arguments: a }) => ({ name, title, description, arguments: a })) };
    case "prompts/get": {
      const prompt = PROMPTS.find((p) => p.name === params.name);
      if (!prompt) throw new RpcError(-32602, `There is no prompt called ${String(params.name)}`);
      const args = params.arguments && typeof params.arguments === "object" ? (params.arguments as Record<string, string>) : {};
      return prompt.get(session, args);
    }
    case "resources/list":
      return { resources: await listResources(session) };
    case "resources/templates/list":
      return { resourceTemplates: RESOURCE_TEMPLATES };
    case "resources/read":
      return { contents: await readResource(session, String(params.uri ?? "")) };
    case "logging/setLevel":
      return {};
    case "completion/complete":
      return { completion: { values: [], hasMore: false } };
    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

function serverInstructions(session: McpSession): string {
  return [
    "Fundur Workflows runs a design studio's projects: briefs, phases and steps, tasks and dates, floor plans and 3D, the design library, mood boards, documents, sourcing, clients, invoices and more.",
    "Start with list_projects. Tools that work on one project take `project`, the project's id from list_projects. Read before you change things, and do whole requests in one call where a tool allows it.",
    "Changes are saved, versioned and undoable like the designer's own edits. Small reversible ones apply at once with a change id (undo_change takes it back). Deletes, completing a phase, new projects and bulk moves wait for the designer to confirm in Fundur" +
      (session.owner.canConfirm ? ", or with confirm_change once she has agreed." : "."),
    "The prompt `project_assistant` gives the instructions Fundur's own assistant works by on a project; follow them. Sizes are millimetres on plans, money is in rand.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Tools

interface ToolSpecOut {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { title: string; readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
}

const PROJECT_DESCRIPTION = "The project's id (its slug, from list_projects).";
const READ_ONLY = /^(read|list|search|inspect|measure|show)_/;

/** The argument a project tool takes its project in: `project`, unless the tool has a field of its own by that name. */
function projectKey(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, unknown>;
  return "project" in props ? "project_slug" : "project";
}

function aiDenied(ws: WorkspaceContext): string | null {
  if (!hasPermission("ai:use", { workspaceRole: ws.workspaceRole })) return "You do not have permission to use the assistant in this workspace.";
  if (!ws.features.ai) return "The assistant is not enabled for this account.";
  return null;
}

/** The registry's tools as MCP tools: offered whatever her plan and features allow, read afresh each time. */
async function offeredTools(session: McpSession): Promise<{ spec: ToolSpecOut; tool?: AiTool; native?: NativeTool }[]> {
  const { ws } = session;
  if (aiDenied(ws)) return [];
  const { limits } = await planForUser(session.db, ws.workspaceId, ws.user.id);
  const registry = enabledTools(ws.features).filter((t) => moduleAccess(limits, t.module) !== "none");
  const specs = toolSpecs(registry);
  const out: { spec: ToolSpecOut; tool?: AiTool; native?: NativeTool }[] = registry.map((tool, i) => {
    const schema = { ...specs[i].inputSchema };
    if (schema.type !== "object") Object.assign(schema, { type: "object" });
    let description = tool.description;
    if (!tool.anywhere) {
      const key = projectKey(schema);
      schema.properties = { [key]: { type: "string", description: PROJECT_DESCRIPTION }, ...((schema.properties as Record<string, unknown>) ?? {}) };
      schema.required = [key, ...(((schema.required as string[]) ?? []).filter((r) => r !== key))];
      description += ` Works on one project: pass \`${key}\`.`;
    }
    if (tool.browser) description += " It acts on the editor open in the designer's browser; with no editor open it says so and changes nothing.";
    const moduleName = MODULE_REGISTRY[tool.module]?.name;
    return {
      tool,
      spec: {
        name: tool.name,
        title: tool.label,
        description: moduleName ? `[${moduleName}] ${description}` : description,
        inputSchema: schema,
        annotations: { title: tool.label, readOnlyHint: READ_ONLY.test(tool.name) || undefined, openWorldHint: false },
      },
    };
  });
  for (const native of NATIVE_TOOLS) {
    if (native.name === "confirm_change" && !session.owner.canConfirm) continue;
    out.push({ native, spec: native.spec });
  }
  return out;
}

export interface CallResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
const text = (t: string, isError = false, structured?: Record<string, unknown>): CallResult => ({
  content: [{ type: "text", text: t }],
  ...(structured ? { structuredContent: structured } : {}),
  ...(isError ? { isError: true } : {}),
});

/** A refusal from the app's own checks, as the words it would show. */
async function refusal(res: NextResponse): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? "That is not allowed.";
}

interface ProjectScope {
  slug: string;
  project: Project;
  projectId: string;
}

/** Her project by its id, checked like the in-app assistant's chat: her rights on it, its team access, the AI feature. */
async function openProject(session: McpSession, slug: unknown): Promise<ProjectScope | string> {
  if (typeof slug !== "string" || !slug.trim()) return "Say which project: pass `project`, its id from list_projects.";
  const checked = await checkProject(session.ws, slug.trim(), "ai:use", "ai");
  if (checked instanceof NextResponse) return refusal(checked);
  const project = await getProject(session.db, session.ws.workspaceId, slug.trim());
  const projectId = project && (await projectDbId(session.db, session.ws.workspaceId, slug.trim()));
  if (!project || !projectId) return "Project not found.";
  return { slug: slug.trim(), project, projectId };
}

/**
 * The chat message that collects what this app did on a project (or in her
 * own chat) today. Changes hang off it with their Undo buttons, and the cost of
 * any AI the tools call adds up on it like a reply's.
 */
async function anchorMessage(session: McpSession, projectId: string | null): Promise<string> {
  const { db, ws, owner } = session;
  const scope = projectId ?? "studio";
  const find = async () =>
    (await db.query<{ message_id: string }>("SELECT message_id FROM mcp_chat_anchors WHERE token_id = $1 AND scope = $2 AND day = CURRENT_DATE", [owner.tokenId, scope]))[0]
      ?.message_id;
  const found = await find();
  if (found) return found;
  const messageId = await addMessage(db, ws.workspaceId, projectId, {
    userId: ws.user.id,
    role: "assistant",
    content: `Work done through ${owner.name}, an AI app connected to Fundur.`,
  });
  const made = await db.query("INSERT INTO mcp_chat_anchors (token_id, scope, day, message_id) VALUES ($1, $2, CURRENT_DATE, $3) ON CONFLICT DO NOTHING RETURNING message_id", [
    owner.tokenId,
    scope,
    messageId,
  ]);
  if (made.length) return messageId;
  // Another call made today's message first.
  await db.query("DELETE FROM ai_chat_messages WHERE id = $1", [messageId]);
  return (await find())!;
}

const appendEvents = (db: Db, messageId: string, events: ChatEvent[]) =>
  events.length ? db.query("UPDATE ai_chat_messages SET events = COALESCE(events, '[]'::jsonb) || $2::jsonb WHERE id = $1", [messageId, JSON.stringify(events)]) : Promise.resolve([]);

function friendly(err: unknown): string | null {
  if (err instanceof AiNotConfiguredError) return "No AI model is set up in Fundur yet. The Admin picks one in Settings.";
  if (err instanceof AiBudgetError) return err.message;
  if (err instanceof ProviderKeyError) return "Fundur's AI key no longer works. The Admin needs to enter it again in Settings.";
  if (err instanceof ProviderRefusalError) return err.message;
  if (err instanceof ProviderError) return "The AI provider had a problem. Try again in a moment.";
  if (err instanceof MutationError) return err.message;
  if (err instanceof PlanLimitError) return err.message;
  return null;
}

/** Runs a tool by name: the registry's, or one of the MCP server's own. */
export async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const denied = aiDenied(session.ws);
  if (denied) return text(denied, true);
  const native = NATIVE_TOOLS.find((t) => t.name === name);
  if (native) {
    if (native.name === "confirm_change" && !session.owner.canConfirm) return text("This connection may not confirm changes; she confirms them in Fundur.", true);
    return native.run(session, args);
  }
  const tool = getTool(name);
  if (!tool) return text(`There is no tool called ${name}.`, true);

  let scope: ProjectScope | null = null;
  const input = { ...args };
  if (!tool.anywhere) {
    const key = projectKey(toolSpecs([tool])[0].inputSchema);
    const opened = await openProject(session, input[key]);
    if (typeof opened === "string") return text(opened, true);
    scope = opened;
    delete input[key];
  }
  const { db, ws } = session;
  const { limits } = await planForUser(db, ws.workspaceId, ws.user.id);
  const allowsModule = (key: string) => moduleAccess(limits, key, scope?.project.workflowId) !== "none";
  const messageId = await anchorMessage(session, scope?.projectId ?? null);
  const ctx: ToolContext = {
    db,
    run: { workspaceId: ws.workspaceId, projectId: scope?.projectId ?? null, userId: ws.user.id, chatMessageId: messageId },
    // Tools that work without a project never read it.
    project: scope?.project ?? (undefined as unknown as Project),
    readFile:
      session.readFile ??
      (async (key: string) => (scope && isInProject(key, ws.workspaceId, scope.projectId) ? readFileBytes(key) : null)),
    fetchImpl: session.fetchImpl,
    autoApply: true,
    features: ws.features,
    allowsModule,
  };
  const started = Date.now();
  const events: ChatEvent[] = [];
  try {
    const out = await runTool(ctx, name, input);
    const changes = await recordOutcome(session, ctx, scope, messageId, out, events);
    const ok = !out.isError && !changes.problems.length;
    events.push({ type: "tool", name, label: tool.label, ok, note: changes.problems.join("; ") || undefined, detail: `via ${session.owner.name}`, durationMs: Date.now() - started });
    await appendEvents(db, messageId, events);
    await logToolCall(db, ws.workspaceId, scope?.projectId ?? null, messageId, { name, ok, durationMs: Date.now() - started });
    const lines = [out.content, ...changes.problems];
    if (out.flag) lines.push(`Needs checking: ${out.flag}`);
    if (changes.applied.length) lines.push("", "Applied (undo with undo_change):", ...changes.applied.map((p) => `- ${p.summary} [change ${p.id}]`));
    if (changes.waiting.length) {
      lines.push(
        "",
        `Waiting for the designer to confirm${session.owner.canConfirm ? " (or confirm_change once she agrees)" : ""} at ${session.origin}/projects/${encodeURIComponent(scope?.slug ?? "")}:`,
        ...changes.waiting.map((p) => `- ${p.summary} [change ${p.id}]`)
      );
    }
    for (const card of out.cards ?? []) lines.push("", cardLine(session, card));
    const structured =
      changes.applied.length || changes.waiting.length
        ? { changes: [...changes.applied, ...changes.waiting].map((p) => ({ id: p.id, summary: p.summary, status: p.status, undoable: p.undoable })) }
        : undefined;
    return text(lines.join("\n").trim(), !ok, structured);
  } catch (err) {
    const message = friendly(err) ?? "The tool failed.";
    if (!friendly(err)) console.error(`MCP tool ${name} failed`, err);
    events.push({ type: "tool", name, label: tool.label, ok: false, note: message, detail: `via ${session.owner.name}`, durationMs: Date.now() - started });
    await appendEvents(db, messageId, events).catch(() => {});
    await logToolCall(db, ws.workspaceId, scope?.projectId ?? null, messageId, { name, ok: false, durationMs: Date.now() - started }).catch(() => {});
    return text(message, true);
  }
}

function cardLine(session: McpSession, card: NonNullable<ToolOutcome["cards"]>[number]): string {
  const abs = (u: string) => (u.startsWith("/") ? session.origin + u : u);
  switch (card.kind) {
    case "link":
      return `Link: ${card.title} ${card.url}`;
    case "image":
      return `Image: ${abs(card.url)}${card.caption ? ` (${card.caption})` : ""}`;
    case "file":
      return `File: ${card.name} ${abs(card.url)}`;
    case "document":
      return `Document "${card.title}" (id ${card.id}), open in Fundur's assistant chat.`;
    case "research":
      return `Research "${card.title}" (id ${card.id}): ${card.summary}\nSources: ${card.sources.map((s) => s.url).join(", ")}`;
  }
}

/**
 * What a tool handed back, applied the way the in-app assistant applies it:
 * plan and board edits are already saved and get their Undo; small reversible
 * changes apply now with an Undo; the rest wait for her.
 */
async function recordOutcome(
  session: McpSession,
  ctx: ToolContext,
  scope: ProjectScope | null,
  messageId: string,
  out: ToolOutcome,
  events: ChatEvent[]
): Promise<{ applied: ProposalView[]; waiting: ProposalView[]; problems: string[] }> {
  const { db, ws } = session;
  const applied: ProposalView[] = [];
  const waiting: ProposalView[] = [];
  const problems: string[] = [];
  const projectId = scope?.projectId ?? null;
  if (out.planEdit && projectId) {
    const e = out.planEdit;
    const summary = e.changes.length === 1 ? `Plan: ${e.changes[0]}` : `Plan: ${e.changes.length} changes (${e.changes.slice(0, 2).join("; ")}${e.changes.length > 2 ? "…" : ""})`;
    applied.push(
      await createProposal(db, ws.workspaceId, projectId, messageId, { summary, mutation: { type: "planEdit", revision: e.revision, changes: e.changes.slice(0, 200) } }, { undo: { before: e.before }, userId: ws.user.id })
    );
  }
  if (out.boardEdit && projectId) {
    const e = out.boardEdit;
    applied.push(
      await createProposal(
        db,
        ws.workspaceId,
        projectId,
        messageId,
        { summary: boardEditSummary(e), mutation: { type: "boardEdit", key: e.key, revision: e.revision, changes: e.changes.slice(0, 200) } },
        { undo: { before: e.before }, userId: ws.user.id }
      )
    );
  }
  for (const card of out.cards ?? []) events.push({ type: "card", card });
  if (out.scratchpad) events.push({ type: "scratchpad", scratchpad: out.scratchpad });
  if (out.blueprintMade) events.push({ type: "blueprint", ...out.blueprintMade });
  if (out.flag) events.push({ type: "flag", text: out.flag });
  const drafts: ProposalDraft[] = out.proposals ?? [];
  if (drafts.length && !scope) {
    problems.push(...drafts.map((d) => `"${d.summary}" needs a project.`));
    return { applied, waiting, problems };
  }
  for (const d of drafts) {
    const current = (await getProject(db, ws.workspaceId, scope!.slug)) ?? ctx.project;
    if (!d.confirm && canApplyDirectly(current, d.mutation)) {
      const undo = undoFor(current, d.mutation);
      try {
        ctx.project = await applyAction(db, ws.workspaceId, current.id, d.mutation);
        applied.push(await createProposal(db, ws.workspaceId, projectId, messageId, d, { undo, userId: ws.user.id }));
      } catch (err) {
        if (!(err instanceof MutationError)) throw err;
        problems.push(`"${d.summary}" could not be applied: ${err.message}`);
      }
    } else {
      waiting.push(await createProposal(db, ws.workspaceId, projectId, messageId, d));
    }
  }
  return { applied, waiting, problems };
}

// ---------------------------------------------------------------------------
// The MCP server's own tools: the chat's Undo, Confirm and Dismiss buttons.

interface NativeTool {
  name: string;
  spec: ToolSpecOut;
  run(session: McpSession, args: Record<string, unknown>): Promise<CallResult>;
}

const changeSchema = {
  type: "object",
  properties: {
    project: { type: "string", description: PROJECT_DESCRIPTION },
    change_id: { type: "string", description: "The change's id, as a tool's result or list_changes gave it." },
  },
  required: ["project", "change_id"],
};

function changeTool(name: string, verb: ProposalVerb, title: string, description: string, destructive: boolean): NativeTool {
  return {
    name,
    spec: { name, title, description, inputSchema: changeSchema, annotations: { title, destructiveHint: destructive, idempotentHint: true, openWorldHint: false } },
    async run(session, args) {
      const scope = await openProject(session, args.project);
      if (typeof scope === "string") return text(scope, true);
      try {
        const done = await actOnProposal(session.ws, scope.slug, scope.projectId, String(args.change_id ?? ""), verb);
        const said = done.status === "applied" ? `Confirmed and applied${done.undoable ? "; undo_change takes it back" : ""}.` : done.status === "undone" ? "Undone." : "Dismissed.";
        return text(said, false, { status: done.status });
      } catch (err) {
        if (err instanceof ProposalActionError) return text(err.message, true);
        const message = friendly(err);
        if (message) return text(message, true);
        throw err;
      }
    },
  };
}

const NATIVE_TOOLS: NativeTool[] = [
  {
    name: "list_changes",
    spec: {
      name: "list_changes",
      title: "Listing changes",
      description:
        "Lists the assistant's recent changes on a project, newest first: those applied (with whether they can still be undone), those waiting for the designer to confirm, and those dismissed or undone. Includes changes made in Fundur's own chat.",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: PROJECT_DESCRIPTION },
          status: { type: "string", enum: ["pending", "applied", "dismissed", "undone"], description: "Only changes in this state." },
        },
        required: ["project"],
      },
      annotations: { title: "Listing changes", readOnlyHint: true, openWorldHint: false },
    },
    async run(session, args) {
      const scope = await openProject(session, args.project);
      if (typeof scope === "string") return text(scope, true);
      const status = ["pending", "applied", "dismissed", "undone"].includes(String(args.status)) ? String(args.status) : null;
      const rows = await session.db.query<{ id: string; summary: string; status: string; undo: unknown; created_at: Date | string }>(
        `SELECT id, summary, status, undo, created_at FROM ai_proposals
         WHERE workspace_id = $1 AND project_id = $2 AND ($3::text IS NULL OR status = $3)
         ORDER BY created_at DESC LIMIT 50`,
        [session.ws.workspaceId, scope.projectId, status]
      );
      const changes = rows.map((r) => ({ id: r.id, summary: r.summary, status: r.status, undoable: r.status === "applied" && r.undo != null, at: new Date(r.created_at).toISOString() }));
      if (!changes.length) return text("No changes.", false, { changes });
      return text(changes.map((c) => `- ${c.summary} — ${c.status}${c.undoable ? ", can undo" : ""} [change ${c.id}] ${c.at}`).join("\n"), false, { changes });
    },
  },
  changeTool("undo_change", "undo", "Undoing a change", "Takes back a change the assistant made (by this app or in Fundur), as the Undo button in the chat does.", false),
  changeTool("dismiss_change", "dismiss", "Dismissing a change", "Drops a change that is waiting for the designer to confirm, without applying it.", false),
  // The Confirm button: actOnProposal calls it "apply".
  changeTool(
    "confirm_change",
    "apply",
    "Confirming a change",
    "Applies a change that waits for the designer's confirmation (a delete, completing a phase, a new project, a bulk move), as her Confirm button does. Only once she has agreed to it.",
    true
  ),
];

// ---------------------------------------------------------------------------
// Prompts: the instructions Fundur's own assistant works by.

interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
  get(session: McpSession, args: Record<string, string>): Promise<{ description: string; messages: { role: "user" | "assistant"; content: { type: "text"; text: string } }[] }>;
}

const asUser = (t: string) => ({ role: "user" as const, content: { type: "text" as const, text: t } });

const PROMPTS: PromptDef[] = [
  {
    name: "project_assistant",
    title: "Work on a project as Fundur's assistant",
    description: "The instructions, project summary, brief, workflow, plan and remembered notes Fundur's own assistant is given for a project, with its tool list.",
    arguments: [
      { name: "project", description: PROJECT_DESCRIPTION, required: true },
      { name: "task", description: "What to do on the project (optional).", required: false },
    ],
    async get(session, args) {
      const scope = await openProject(session, args.project);
      if (typeof scope === "string") throw new RpcError(-32602, scope);
      const { db, ws } = session;
      const plan = ws.features.floor_plan === false ? null : await getPlanState(db, ws.workspaceId, scope.slug);
      const tools = (await offeredTools(session)).flatMap(({ tool }) => (tool ? [tool] : []));
      const instructions =
        systemPrompt(scope.project, plan?.plan ? summarisePlan(plan.plan) : null, new Date(), ws.features, tools) + (await memoryPrompt(db, ws.workspaceId, scope.projectId));
      const mcpNote =
        "\n\nYou are working through Fundur's MCP server: pass this project's id as `project` to every project tool. Changes come back with change ids; undo_change takes one back.";
      return {
        description: `Fundur's assistant on ${scope.project.name}`,
        messages: [asUser(instructions + mcpNote + (args.task ? `\n\nThe task: ${args.task}` : ""))],
      };
    },
  },
  {
    name: "studio_assistant",
    title: "Work across the studio as Fundur's assistant",
    description: "The instructions Fundur's assistant works by outside one project: the design library, the planner, business and her projects.",
    arguments: [{ name: "task", description: "What to do (optional).", required: false }],
    async get(session, args) {
      const tools = (await offeredTools(session)).flatMap(({ tool }) => (tool?.anywhere ? [tool] : []));
      const instructions = studioSystemPrompt(new Date(), tools) + (await memoryPrompt(session.db, session.ws.workspaceId, null));
      return { description: "Fundur's assistant across the studio", messages: [asUser(instructions + (args.task ? `\n\nThe task: ${args.task}` : ""))] };
    },
  },
  {
    name: "next_steps",
    title: "What should happen next on a project",
    description: "Asks for the project's next steps: what is due, what waits on whom, and what to do now, using Fundur's tools.",
    arguments: [{ name: "project", description: PROJECT_DESCRIPTION, required: true }],
    async get(session, args) {
      const scope = await openProject(session, args.project);
      if (typeof scope === "string") throw new RpcError(-32602, scope);
      const phase = getPhase(scope.project, scope.project.currentPhase);
      return {
        description: `Next steps on ${scope.project.name}`,
        messages: [
          asUser(
            `On the Fundur project "${scope.project.name}" (project id ${scope.slug}), now in ${phase?.name ?? scope.project.currentPhase}: read its phase readiness, tasks and dates with Fundur's tools, then say plainly what is due, what waits on the client or on the designer, and the three most useful things to do next. Offer to do them.`
          ),
        ],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Resources: her projects, their briefs and plans.

const RESOURCE_TEMPLATES = [
  { uriTemplate: "fundur://projects/{project}", name: "project", title: "A project", description: "A project's details, phases, steps and tasks as JSON.", mimeType: "application/json" },
  { uriTemplate: "fundur://projects/{project}/brief", name: "brief", title: "A project's brief", description: "The brief as text.", mimeType: "text/markdown" },
  { uriTemplate: "fundur://projects/{project}/plan", name: "plan", title: "A project's floor plan", description: "The floor plan: a summary, then the plan as JSON (millimetres).", mimeType: "text/markdown" },
];

async function visibleProjects(session: McpSession): Promise<Project[]> {
  const { db, ws } = session;
  const all = await listProjects(db, ws.workspaceId);
  const slugs = await projectSlugs(db, ws.workspaceId, ws.user.id, ws.workspaceRole);
  return slugs ? all.filter((p) => slugs.includes(p.id)) : all;
}

async function listResources(session: McpSession) {
  if (aiDenied(session.ws)) return [];
  const projects = (await visibleProjects(session)).slice(0, 100);
  return [
    { uri: "fundur://projects", name: "projects", title: "Projects", description: "Every project she can open, with its phase and client.", mimeType: "application/json" },
    ...projects.flatMap((p) => [
      { uri: `fundur://projects/${p.id}`, name: `${p.id}`, title: p.name, description: `${p.name}${p.client ? ` for ${p.client}` : ""}`, mimeType: "application/json" },
      { uri: `fundur://projects/${p.id}/brief`, name: `${p.id}-brief`, title: `${p.name}: brief`, mimeType: "text/markdown" },
    ]),
  ];
}

async function readResource(session: McpSession, uri: string) {
  const denied = aiDenied(session.ws);
  if (denied) throw new RpcError(-32002, denied);
  if (uri === "fundur://projects") {
    const projects = await visibleProjects(session);
    const list = projects.map((p) => ({ id: p.id, name: p.name, client: p.client, phase: getPhase(p, p.currentPhase)?.name ?? p.currentPhase, workflow: getWorkflow(p).name }));
    return [{ uri, mimeType: "application/json", text: JSON.stringify(list, null, 2) }];
  }
  const m = /^fundur:\/\/projects\/([^/]+)(?:\/(brief|plan))?$/.exec(uri);
  if (!m) throw new RpcError(-32002, `Resource not found: ${uri}`);
  const scope = await openProject(session, decodeURIComponent(m[1]));
  if (typeof scope === "string") throw new RpcError(-32002, scope);
  const { project } = scope;
  if (m[2] === "brief") {
    const fields = getForm(project, "brief")?.fields ?? [];
    const body = fields.map((f) => `## ${f.label}\n\n${project.brief[f.key]?.trim() || "(empty)"}`).join("\n\n");
    return [{ uri, mimeType: "text/markdown", text: `# ${project.name}: brief\n\n${body || "This workflow has no brief."}` }];
  }
  if (m[2] === "plan") {
    if (session.ws.features.floor_plan === false) throw new RpcError(-32002, "The floor plan editor is not enabled for this account.");
    const state = await getPlanState(session.db, session.ws.workspaceId, scope.slug);
    if (!state?.plan) return [{ uri, mimeType: "text/markdown", text: "No floor plan has been drawn or imported yet." }];
    return [{ uri, mimeType: "text/markdown", text: `# ${project.name}: floor plan (revision ${state.revision})\n\n${summarisePlan(state.plan)}\n\n\`\`\`json\n${JSON.stringify(state.plan)}\n\`\`\`` }];
  }
  return [{ uri, mimeType: "application/json", text: JSON.stringify(project, null, 2) }];
}
