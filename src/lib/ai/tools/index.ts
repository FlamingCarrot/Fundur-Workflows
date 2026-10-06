/**
 * Every module's assistant tools. A module adds its tools in its own file and
 * is listed here once; the assistant then offers them with no prompt edits.
 * Layout generation joins here when src/lib/layout exposes it.
 */
import "./project";
import "./brief";
import "./plan";
import "./documents";
import "./text";

export { getTool, listTools, registerTool, runTool, toolSpecs } from "./registry";
export type { AiTool, ProposalDraft, ToolContext, ToolOutcome } from "./registry";
