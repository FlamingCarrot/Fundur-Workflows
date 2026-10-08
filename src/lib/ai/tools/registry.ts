import { z } from "zod";
import type { FeatureState } from "@/lib/workspaces/store";
import type { Db } from "@/lib/db";
import type { ProjectMutation } from "@/lib/projects/mutations";
import type { Project } from "@/lib/studio/types";
import type { ToolSpec } from "../chat-stream";
import type { RunContext } from "../runs";

/**
 * The capability registry (P4-12). Every module registers what the assistant
 * may do with it as tools: a description, an input schema and a function. The
 * assistant is offered whatever is registered, and its instructions list the
 * tools from here, so a new feature reaches it without editing any prompt.
 *
 * Tools only read, or propose a change. A proposal is one of the same project
 * changes a person makes (ProjectMutation); nothing is applied until the
 * designer confirms it, and then it is saved, versioned and undoable like any
 * edit of hers.
 */

export interface ToolContext {
  db: Db;
  /** Who and what the work is for; tools pass it on to runAi and runReviewed. */
  run: Omit<RunContext, "task" | "role" | "attempt" | "tier">;
  project: Project;
  /** Reads a stored file of this project; null when it is missing. */
  readFile: (storageKey: string) => Promise<Uint8Array | null>;
  fetchImpl?: typeof fetch;
  features?: FeatureState;
}

export interface ProposalDraft {
  /** What the change does, in the designer's words, e.g. "Add task: Call the landlord". */
  summary: string;
  mutation: ProjectMutation;
}

export interface ToolOutcome {
  /** What the model reads back. */
  content: string;
  proposals?: ProposalDraft[];
  /** Set when the work failed review at the cap: shown to the designer as unchecked. */
  flag?: string;
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

export function enabledTools(features?: FeatureState): AiTool[] {
  return listTools().filter(t => !features || !(t.module === "floor_plan_editor" && !features.floor_plan) && !(t.module === "layout_generator" && (!features.layout || !features.floor_plan)) && !(["sharing", "comments"].includes(t.module) && !features.sharing) && !(["canvas_board", "item_register", "regulatory_checklist", "message_drafter"].includes(t.module) && !features.design));
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
export async function runTool(ctx: ToolContext, name: string, rawInput: unknown): Promise<ToolOutcome & { isError?: boolean }> {
  const tool = getTool(name);
  if (!tool || !enabledTools(ctx.features).includes(tool)) return { content: `There is no tool called ${name}.`, isError: true };
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { content: `The input did not fit: ${z.prettifyError(parsed.error)}`, isError: true };
  }
  return tool.run(ctx, parsed.data);
}
