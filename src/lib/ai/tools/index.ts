/**
 * Every module's assistant tools. A module adds its tools in its own file and
 * is listed here once; the assistant then offers them with no prompt edits.
 */
import "./project";
import "./brief";
import "./plan";
import "./documents";
import "./text";
import "./layout";
import "./plan-edit";

export { getTool, listTools, registerTool, runTool, toolSpecs } from "./registry";
export type { AiTool, PlanEdit, ProposalDraft, ToolContext, ToolOutcome } from "./registry";
