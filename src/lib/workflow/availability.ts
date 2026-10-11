import { getRegisteredModule, parseModuleRef } from "@/lib/modules/registry";
import type { Viewer } from "@/lib/studio/viewer";
import type { WorkflowDefinition } from "./schema";

export function workflowAvailability(workflow: WorkflowDefinition, viewer: Viewer) {
  const aiEnabled = viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" && viewer.workspaceRole !== "client";
  const modules = [...new Set(workflow.phases.flatMap(p => p.modules))].map(ref => {
    const { key, variant } = parseModuleRef(ref);
    const registered = getRegisteredModule(ref);
    const name = (variant && workflow.labels[variant]) || registered?.name || key;
    let reason: string | null = null;
    if (!registered || registered.status !== "available") reason = "This tool is not available yet.";
    else if (key === "ai_chat" && !aiEnabled) reason = "AI assistance is not enabled for your account.";
    else if (key === "floor_plan_editor" && viewer.features?.floor_plan === false) reason = "Plan editing is not enabled for your account.";
    else if (key === "layout_generator" && (viewer.features?.layout === false || viewer.features?.floor_plan === false)) reason = "Layout generation needs both plan editing and layout access.";
    else if (["canvas_board", "item_register", "regulatory_checklist", "link_importer", "message_drafter", "template_export"].includes(key) && viewer.features?.design === false) reason = "Design tools are not enabled for your account.";
    else if (["sharing", "comments"].includes(key) && (viewer.features?.sharing === false || viewer.workspaceRole === "collaborator" || viewer.workspaceRole === "client")) reason = "Publishing client links is not available to your account.";
    return { ref, name, available: reason === null, reason };
  });
  return { modules, unavailable: modules.filter(m => !m.available), aiEnabled, aiActions: workflow.phases.reduce((count, p) => count + p.ai_actions.length, 0) };
}
