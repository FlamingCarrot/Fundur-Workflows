export type SwatchKey = "clay" | "sage" | "oak" | "slate" | "blush" | "ochre";

export type ProjectStatus = "active" | "on_hold" | "complete";
export type WaitingOn = "me" | "client";

/** Values of the workflow's brief form, keyed by the field keys in its definition. */
export type Brief = Record<string, string>;

export type BriefField = string;

export interface ProjectDocument {
  id: string;
  name: string;
  sizeBytes: number;
  phaseKey: string;
  uploadedAt: string;
  clientVisible: boolean;
  /** True when the file itself is in storage and can be downloaded; false when only its name was recorded. */
  stored?: boolean;
  /** The current version number of a stored file. */
  version?: number;
  /** Where the browser uploaded the file; sent once when the document is added. */
  storageKey?: string;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  swatch: SwatchKey;
  workflowId: string;
  /** The workflow version the project started on; it stays on it when the workflow changes. */
  workflowVersion: number;
  status: ProjectStatus;
  waitingOn: WaitingOn;
  startDate: string;
  currentPhase: string;
  completedPhases: string[];
  /** Checklist item id -> done. Ids come from the workflow definition. */
  checks: Record<string, boolean>;
  brief: Brief;
  /** Fields still holding an untouched AI draft. */
  briefAiFields: BriefField[];
  documents: ProjectDocument[];
  /** All AI spend on the project, in rand. On the server it is the sum of the AI call log. */
  aiSpendZar: number;
  /** The part of it spent drafting the brief, when logged. */
  briefCostZar?: number;
  lastActivity: string;
}

export interface IssueReport {
  id: string;
  moduleKey: string;
  note: string;
  path: string;
  createdAt: string;
}
