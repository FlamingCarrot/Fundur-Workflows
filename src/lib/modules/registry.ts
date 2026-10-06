export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  type: "generic" | "domain" | "platform";
  inputs: string[];
  outputs: string[];
  supportedSettings: Record<string, "string" | "number" | "boolean" | "json">;
  aiActions: string[];
}

export const MODULE_REGISTRY: Record<string, ModuleDefinition> = {
  "phase_bar": {
    key: "phase_bar",
    name: "Phase Bar & Navigation",
    description: "Header navigation showing phase progression, current position, and status gates across all workflow stages.",
    type: "generic",
    inputs: ["project_phases", "current_phase"],
    outputs: ["phase_change_event"],
    supportedSettings: { showCompletedTicks: "boolean" },
    aiActions: [],
  },
  "checklist": {
    key: "checklist",
    name: "Checklist & Quality Gate",
    description: "Essential and optional step tasks that must be satisfied to complete a phase.",
    type: "generic",
    inputs: ["phase_tasks"],
    outputs: ["task_toggle_event", "phase_advance_unlocked"],
    supportedSettings: { allowCustomTasks: "boolean" },
    aiActions: ["suggest_missing_steps"],
  },
  "documents": {
    key: "documents",
    name: "Document & Asset Store",
    description: "Direct-to-cloud upload, snapshot versioning, and client-visible flag management.",
    type: "generic",
    inputs: ["project_documents"],
    outputs: ["document_uploaded", "version_snapshot_created"],
    supportedSettings: { allowClientVisibleToggle: "boolean", maxFileSizeBytes: "number" },
    aiActions: ["extract_document_insights"],
  },
  "structured_form": {
    key: "structured_form",
    name: "Structured Data Form",
    description: "Custom schema form fields editable manually or populated by AI extractors (e.g. Design Brief).",
    type: "generic",
    inputs: ["field_definitions", "field_values"],
    outputs: ["field_update_event"],
    supportedSettings: { autosaveDebounceMs: "number" },
    aiActions: ["draft_form_from_notes"],
  },
  "floor_plan_editor": {
    key: "floor_plan_editor",
    name: "Floor Plan Canvas Editor",
    description: "Interactive canvas for pan/zoom, dimension adjustments, room labeling, and geometry validation.",
    type: "domain",
    inputs: ["geometry_data", "scale_units"],
    outputs: ["geometry_updated", "room_areas_calculated"],
    supportedSettings: { unitSystem: "string", snapToGrid: "boolean" },
    aiActions: ["parse_dwg_plan", "check_clearance_rules"],
  },
  "layout_generator": {
    key: "layout_generator",
    name: "Rules-Based Layout Engine",
    description: "Automated generation, side-by-side comparison, and scoring of spatial configurations.",
    type: "domain",
    inputs: ["geometry_data", "ruleset", "headcount_target"],
    outputs: ["generated_options", "chosen_option"],
    supportedSettings: { defaultClearanceMm: "number" },
    aiActions: ["generate_layout_options"],
  },
  "ai_chat": {
    key: "ai_chat",
    name: "Context-Aware AI Co-Pilot",
    description: "Streaming assistant with access to full project files, phase state, and module tool invocations.",
    type: "generic",
    inputs: ["chat_history", "project_context", "model_choice"],
    outputs: ["ai_message_stream", "tool_invocation"],
    supportedSettings: { modelTier: "string", costLimitUsd: "number" },
    aiActions: ["chat_orchestration"],
  },
  "item_register": {
    key: "item_register",
    name: "Item & FF&E Register",
    description: "Multi-column structured register with status workflow (needs sourcing, quote requested, ordered, delivered).",
    type: "generic",
    inputs: ["register_records"],
    outputs: ["record_status_updated", "rfq_queue_updated"],
    supportedSettings: { currency: "string" },
    aiActions: ["extract_specs_from_url", "draft_supplier_rfqs"],
  },
  "canvas_board": {
    key: "canvas_board",
    name: "Visual Canvas & Mood Board",
    description: "Free-form 2D board for curating mood boards, visual palettes, and tagged material references.",
    type: "generic",
    inputs: ["board_cards", "connectors"],
    outputs: ["board_state_updated", "tagged_items_exported"],
    supportedSettings: { gridMode: "boolean" },
    aiActions: ["generate_concept_visuals"],
  },
  "report_issue": {
    key: "report_issue",
    name: "In-App Feedback & Issue Marker",
    description: "Persistent pinned module feedback pin and admin issue queue.",
    type: "platform",
    inputs: ["module_context", "user_session"],
    outputs: ["ticket_created"],
    supportedSettings: {},
    aiActions: [],
  },
};

export function getRegisteredModule(key: string): ModuleDefinition | undefined {
  // Supports compound keys like 'structured_form:brief'
  const baseKey = key.split(":")[0];
  return MODULE_REGISTRY[baseKey];
}
