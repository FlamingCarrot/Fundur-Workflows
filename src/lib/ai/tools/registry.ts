import { z } from "zod";
import type { FeatureState } from "@/lib/workspaces/store";
import type { Db } from "@/lib/db";
import type { Plan } from "@/lib/plan/geometry";
import type { Project } from "@/lib/studio/types";
import type { AssistantAction } from "../actions";
import type { AssistantContext } from "../context";
import type { ToolSpec } from "../chat-stream";
import type { RunContext } from "../runs";
import type { ViewCommand } from "@/lib/assistant/view-command";

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
  /** Changes the open plan editor's view (3D views, sections, renders). */
  view?: ViewCommand;
  /** The design library changed; open screens reload it. */
  libraryChanged?: boolean;
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
  return listTools().filter(t => (autopilot || !t.autopilotOnly)).filter(t => !features || !(t.module === "floor_plan_editor" && !features.floor_plan) && !(t.module === "layout_generator" && (!features.layout || !features.floor_plan)) && !(["sharing", "comments"].includes(t.module) && !features.sharing) && !(["canvas_board", "item_register", "regulatory_checklist", "message_drafter", "template_export", "link_importer"].includes(t.module) && !features.design));
}

/** The tools as the model is offered them. */
export function toolSpecs(list: AiTool[] = listTools()): ToolSpec[] {
  return list.map((t) => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(t.input, { io: "input" }) as Record<string, unknown>;
    void _drop;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}

/** Runs a tool the model asked for. Bad input comes back to the model as an error it can correct. */
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome> {
  const tool = getTool(name);
  if (!tool || !enabledTools(ctx.features, !!ctx.autopilot).includes(tool)) return { content: `There is no tool called ${name}.`, isError: true };
  if (ctx.allowsModule && !ctx.allowsModule(tool.module)) {
    return { content: `${name} is not included in this workspace's plan.`, isError: true };
  }
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { content: `The input did not fit: ${z.prettifyError(parsed.error)}`, isError: true };
  }
  return tool.run(ctx, parsed.data);
}
