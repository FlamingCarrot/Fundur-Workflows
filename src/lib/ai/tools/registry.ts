import type { DesignBoard } from "@/lib/design/schema";
import { z } from "zod";
import type { FeatureState } from "@/lib/workspaces/store";
import type { Db } from "@/lib/db";
import type { Plan } from "@/lib/plan/geometry";
import type { Project } from "@/lib/studio/types";
import type { AssistantAction } from "../actions";
import type { AssistantContext } from "../context";
import type { ToolSpec } from "../chat-stream";
import type { RunContext } from "../runs";
import type { BlueprintViewCommand, ViewCommand } from "@/lib/assistant/view-command";
import type { ChatCard } from "../chat-items";
import type { ChatScratchpad } from "../chat-store";

/**
 * The capability registry (P4-12). Every module registers what the assistant
 * may do with it as tools: a description, an input schema and a function. The
 * assistant is offered whatever is registered, and its instructions list the
 * tools from here, so a new feature reaches it without editing any prompt.
 *
 * Tools read, or hand back changes as data (an AssistantAction): the same
 * changes a person makes. Small changes that can be taken back are applied at
 * once with an Undo; the rest wait for the designer to confirm. Either way they
 * are saved, versioned and undoable like any edit of hers. Plan tools save
 * their edits themselves and say what they changed, so the open editor can
 * draw them as they land.
 */

export interface ToolContext {
  db: Db;
  /** Who and what the work is for; tools pass it on to runAi and runReviewed. */
  run: Omit<RunContext, "task" | "role" | "attempt" | "tier">;
  project: Project;
  /** Reads a stored file of this project; null when it is missing. */
  readFile: (storageKey: string) => Promise<Uint8Array | null>;
  fetchImpl?: typeof fetch;
  /** Where she asked from: the page, and what she has selected on it. */
  context?: AssistantContext;
  /** False when she asked to confirm every change. */
  autoApply?: boolean;
  features?: FeatureState;
  /** Whether the workspace's plan includes a module; tools of modules it doesn't are refused. */
  allowsModule?: (moduleKey: string) => boolean;
  /** Set when the project's autopilot is running, not a person chatting. */
  autopilot?: AutopilotToolState;
}

/** What the autopilot's own tools record during a run. */
export interface AutopilotToolState {
  runId: string;
  /** Questions it asked her on this run. */
  asked: number;
  /** When it said to look again, and why. */
  nextCheck: { at: Date; reason: string } | null;
}

export interface ProposalDraft {
  /** What the change does, in the designer's words, e.g. "Add task: Call the landlord". */
  summary: string;
  mutation: AssistantAction;
  /** Always ask first, even when the change could be undone. */
  confirm?: boolean;
}

/** A plan edit a tool saved: what it changed, the plan before and after, and the revision it made. */
/** A mood board the assistant drew on: the board before and after, and a line per change. */
export interface BoardEdit {
  key: string;
  before: DesignBoard | null;
  board: DesignBoard;
  revision: number;
  changes: string[];
}
export interface PlanEdit {
  before: Plan | null;
  plan: Plan;
  revision: number;
  changes: string[];
}

export interface ToolOutcome {
  /** What the model reads back. */
  content: string;
  proposals?: ProposalDraft[];
  /** Set when the work failed review at the cap: shown to the designer as unchecked. */
  flag?: string;
  planEdit?: PlanEdit;
  boardEdit?: BoardEdit;
  /** Changes the open plan editor's view (3D views, sections, renders). */
  view?: ViewCommand;
  /** Selection, handles and view for the open blueprint editor. */
  blueprintView?: BlueprintViewCommand;
  /** The design library changed; open screens reload it. */
  libraryChanged?: boolean;
  /** A blueprint it saved in the library, which the chat offers to open. */
  blueprintMade?: { id: string; name: string; projectId?: string };
  /** Smart chat items the reply shows: links, images, files, documents, research. */
  cards?: ChatCard[];
  /** High-level plan scratchpad formulated or updated by the AI. */
  scratchpad?: ChatScratchpad;
  isError?: boolean;
}

export interface AiTool<I = Record<string, unknown>> {
  name: string;
  /** The module that owns it (a MODULE_REGISTRY key). */
  module: string;
  /** What the chat shows while it runs, e.g. "Reading the plan". */
  label: string;
  /** What the model reads to decide when to use it. */
  description: string;
  input: z.ZodType<I>;
  /** The AI task type it runs, when it calls a model itself. */
  taskType?: string;
  /** Only offered to the autopilot, never in the chat. */
  autopilotOnly?: boolean;
  /** Works without a project (the design library, her projects list), so the assistant offers it anywhere. Such a tool never reads `ctx.project`. */
  anywhere?: boolean;
  /** Works an editor open in her browser (its view, what is selected) rather than saved work; apps connected over MCP are told so. */
  browser?: boolean;
  run(ctx: ToolContext, input: I): Promise<ToolOutcome>;
}

const tools = new Map<string, AiTool>();

export function registerTool<I>(tool: AiTool<I>): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) throw new Error(`Bad tool name '${tool.name}'`);
  tools.set(tool.name, tool as unknown as AiTool);
}

export function listTools(): AiTool[] {
  return [...tools.values()];
}

export function getTool(name: string): AiTool | undefined {
  return tools.get(name);
}

export function enabledTools(features?: FeatureState, autopilot = false): AiTool[] {
  return listTools().filter(t => (autopilot || !t.autopilotOnly)).filter(t => !features || !(["floor_plan_editor", "game_asset_studio"].includes(t.module) && !features.floor_plan) && !(t.module === "layout_generator" && (!features.layout || !features.floor_plan)) && !(["sharing", "comments"].includes(t.module) && !features.sharing) && !(["canvas_board", "item_register", "regulatory_checklist", "message_drafter", "template_export", "link_importer"].includes(t.module) && !features.design));
}

/** The tools as the model is offered them. */
export function toolSpecs(list: AiTool[] = listTools()): ToolSpec[] {
  return list.map((t) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>;
    void _drop;
    return { name: t.name, description: t.description, inputSchema: plainer(schema) as Record<string, unknown> };
  });
}

/**
 * Every provider reads "anyOf"; some (Gemini) do not read "oneOf" and then let
 * the model send each choice as a string. A choice of tagged objects means the
 * same either way, so "oneOf" is offered as "anyOf".
 */
function plainer(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(plainer);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k === "oneOf" ? "anyOf" : k] = plainer(v);
  return out;
}

/** Models sometimes send an object or a list written out as JSON text; it is read as what it says. */
function unstringified(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try {
        return unstringified(JSON.parse(t), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => unstringified(v, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unstringified(v, depth + 1)]));
  return value;
}

/** Runs a tool the model asked for. Bad input comes back to the model as an error it can correct. */
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  const tool = getTool(name);
  if (!tool || !enabledTools(ctx.features, !!ctx.autopilot).includes(tool)) return { content: `There is no tool called ${name}.`, isError: true };
  if (ctx.allowsModule && !ctx.allowsModule(tool.module)) {
    return { content: `${name} is not included in this workspace's plan.`, isError: true };
  }
  let parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const retry = tool.input.safeParse(unstringified(rawInput ?? {}));
    if (retry.success) parsed = retry;
  }
  if (!parsed.success) {
    return { content: `The input did not fit: ${z.prettifyError(parsed.error)}`, isError: true };
  }
  return tool.run(ctx, parsed.data);
}
