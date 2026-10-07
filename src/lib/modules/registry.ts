/**
 * The module library. Workflow definitions may only reference modules listed
 * here; the validator rejects anything else. Names and descriptions stay
 * generic: the words a user sees come from the workflow's own labels.
 */
export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  type: "generic" | "domain" | "platform";
  /** "available" modules have a working screen; "planned" ones render a placeholder until built. */
  status: "available" | "planned";
  inputs: string[];
  outputs: string[];
  supportedSettings: Record<string, "string" | "number" | "boolean" | "json">;
  aiActions: string[];
}

export const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  "phase_bar": {
    key: "phase_bar",
    name: "Phase bar",
    description: "Phase navigation and progress for any workflow.",
    type: "generic",
    status: "available",
    inputs: ["project_phases", "current_phase"],
    outputs: ["phase_change_event"],
    supportedSettings: { showCompletedTicks: "boolean" },
    aiActions: [],
  },
  "checklist": {
    key: "checklist",
    name: "Checklist",
    description: "Essential and optional steps that must be ticked before a phase completes.",
    type: "generic",
    status: "available",
    inputs: ["phase_tasks"],
    outputs: ["task_toggle_event", "phase_advance_unlocked"],
    supportedSettings: { allowCustomTasks: "boolean" },
    aiActions: ["suggest_missing_steps"],
  },
  "documents": {
    key: "documents",
    name: "Documents",
    description: "Uploads, version snapshots and a client-visible flag per file.",
    type: "generic",
    status: "available",
    inputs: ["project_documents"],
    outputs: ["document_uploaded", "version_snapshot_created"],
    supportedSettings: { allowClientVisibleToggle: "boolean", maxFileSizeBytes: "number" },
    aiActions: ["extract_document_insights"],
  },
  "structured_form": {
    key: "structured_form",
    name: "Structured form",
    description: "Fields defined by the workflow, filled by hand or drafted by AI. Use as structured_form:<form key>.",
    type: "generic",
    status: "available",
    inputs: ["field_definitions", "field_values"],
    outputs: ["field_update_event"],
    supportedSettings: { autosaveDebounceMs: "number" },
    aiActions: ["draft_form_from_notes"],
  },
  "report_issue": {
    key: "report_issue",
    name: "Report an issue",
    description: "Feedback pinned to a module, turned into tickets in the admin queue.",
    type: "platform",
    status: "available",
    inputs: ["module_context", "user_session"],
    outputs: ["ticket_created"],
    supportedSettings: {},
    aiActions: [],
  },
  "ai_chat": {
    key: "ai_chat",
    name: "Assistant",
    description: "Chat assistant with the project as context, tools and file routing.",
    type: "generic",
    status: "available",
    inputs: ["chat_history", "project_context", "model_choice"],
    outputs: ["ai_message_stream", "tool_invocation"],
    supportedSettings: { modelTier: "string", costLimitUsd: "number" },
    aiActions: ["chat_orchestration"],
  },
  "notes": {
    key: "notes",
    name: "Notes",
    description: "Free-text notes kept with a phase and passed on through its handoff.",
    type: "generic",
    status: "planned",
    inputs: [],
    outputs: ["notes_updated"],
    supportedSettings: {},
    aiActions: [],
  },
  "tasks_calendar": {
    key: "tasks_calendar",
    name: "Tasks and calendar",
    description: "Dated tasks with day, week, month and timeline views.",
    type: "generic",
    status: "available",
    inputs: ["phase_tasks"],
    outputs: ["task_dates_changed"],
    supportedSettings: {},
    aiActions: [],
  },
  "search": {
    key: "search",
    name: "Search",
    description: "One search across projects, documents and records.",
    type: "generic",
    status: "available",
    inputs: ["query"],
    outputs: ["results"],
    supportedSettings: {},
    aiActions: [],
  },
  "floor_plan_editor": {
    key: "floor_plan_editor",
    name: "Plan editor",
    description: "Editable plan geometry with typed dimensions, room areas and a corrections log.",
    type: "domain",
    status: "available",
    inputs: ["geometry_data", "scale_units"],
    outputs: ["geometry_updated", "room_areas_calculated"],
    supportedSettings: { unitSystem: "string", snapToGrid: "boolean" },
    aiActions: ["read_plan_file", "check_clearance_rules"],
  },
  "layout_generator": {
    key: "layout_generator",
    name: "Layout generator",
    description: "Rules-based layout options with scoring and side-by-side comparison.",
    type: "domain",
    status: "available",
    inputs: ["geometry_data", "ruleset", "form_values"],
    outputs: ["generated_options", "chosen_option"],
    supportedSettings: { defaultClearanceMm: "number" },
    aiActions: ["generate_layout_options"],
  },
  "model_picker": {
    key: "model_picker",
    name: "Model picker and cost log",
    description: "Providers, keys, model choice and per-task cost. Admin only.",
    type: "platform",
    status: "planned",
    inputs: [],
    outputs: ["model_settings"],
    supportedSettings: {},
    aiActions: [],
  },
  "sharing": {
    key: "sharing",
    name: "Sharing",
    description: "Live or snapshot links to a document, white-labelled for clients.",
    type: "generic",
    status: "planned",
    inputs: ["project_documents"],
    outputs: ["share_link"],
    supportedSettings: {},
    aiActions: [],
  },
  "comments": {
    key: "comments",
    name: "Comments",
    description: "Threads on shared documents.",
    type: "generic",
    status: "planned",
    inputs: ["share_link"],
    outputs: ["comment_added"],
    supportedSettings: {},
    aiActions: [],
  },
  "item_register": {
    key: "item_register",
    name: "Item register",
    description: "Structured records with a status workflow. Use as item_register:<label key>.",
    type: "generic",
    status: "planned",
    inputs: ["register_records"],
    outputs: ["record_status_updated"],
    supportedSettings: { currency: "string" },
    aiActions: ["match_items_to_suppliers"],
  },
  "canvas_board": {
    key: "canvas_board",
    name: "Board",
    description: "Free-form board for images and notes.",
    type: "generic",
    status: "planned",
    inputs: ["board_cards"],
    outputs: ["board_state_updated", "tagged_items_exported"],
    supportedSettings: { gridMode: "boolean" },
    aiActions: ["generate_concept_visuals"],
  },
  "link_importer": {
    key: "link_importer",
    name: "Link importer",
    description: "Pulls specifications and prices from a web page into a record.",
    type: "generic",
    status: "planned",
    inputs: ["url"],
    outputs: ["record_created"],
    supportedSettings: {},
    aiActions: ["extract_specs_from_url"],
  },
  "message_drafter": {
    key: "message_drafter",
    name: "Message drafter",
    description: "Drafts emails in the user's voice from project data.",
    type: "generic",
    status: "planned",
    inputs: ["register_records", "project_context"],
    outputs: ["draft_message"],
    supportedSettings: {},
    aiActions: ["draft_message"],
  },
  "template_export": {
    key: "template_export",
    name: "Template and export",
    description: "Saves a project as a template and exports all its files.",
    type: "generic",
    status: "planned",
    inputs: ["project"],
    outputs: ["template", "export_archive"],
    supportedSettings: {},
    aiActions: [],
  },
};

/** Splits a module reference such as "structured_form:brief" into its module key and variant. */
export function parseModuleRef(ref: string): { key: string; variant?: string } {
  const [key, variant] = ref.split(":");
  return { key, variant: variant || undefined };
}

export function getRegisteredModule(ref: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY[parseModuleRef(ref).key];
}
