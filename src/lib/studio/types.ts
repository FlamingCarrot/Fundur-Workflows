export type SwatchKey = "clay" | "sage" | "oak" | "slate" | "blush" | "ochre";

export type ProjectStatus = "active" | "on_hold" | "complete";
export type WaitingOn = "me" | "client";

export interface Brief {
  clientName: string;
  headcount: string;
  departments: string;
  adjacencies: string;
  targetBudget: string;
  spaceRequirements: string;
  notes: string;
}

export type BriefField = keyof Brief;

export interface ProjectDocument {
  id: string;
  name: string;
  sizeBytes: number;
  phaseKey: string;
  uploadedAt: string;
  clientVisible: boolean;
}

export interface Project {
  id: string;
  name: string;
  client: string;
  swatch: SwatchKey;
  workflowId: string;
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
  aiSpendZar: number;
  lastActivity: string;
}

export interface IssueReport {
  id: string;
  moduleKey: string;
  note: string;
  path: string;
  createdAt: string;
}
