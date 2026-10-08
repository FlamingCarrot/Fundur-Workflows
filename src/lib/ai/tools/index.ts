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
import "./sharing";
import "./design";
import "./regulations";
import "./sourcing";
import "./templates";
import "./supplier-import";

export { getTool, listTools, enabledTools, registerTool, runTool, toolSpecs } from "./registry";
export type { AiTool, ProposalDraft, ToolContext, ToolOutcome } from "./registry";
