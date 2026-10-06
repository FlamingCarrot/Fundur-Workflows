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

/**
 * What the app keeps about a task beyond the workflow definition: a date the
 * designer moved, the document a step produced, or a task they added
 * themselves. A row with stepItemId belongs to that checklist step.
 */
export interface TaskRecord {
  id: string;
  /** The checklist step this is about; absent on a task of their own. */
  stepItemId?: string;
  phaseKey: string;
  /** Only a task of their own carries a title; a step's title comes from the workflow. */
  title: string;
  /** The day it is due, as YYYY-MM-DD; absent when it has no date. */
  due?: string;
  /** Only meaningful for a task of their own; a step's done state is the checklist tick. */
  done: boolean;
  /** The document this task produced. */
  outputDocumentId?: string;
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
  /** Tasks of their own, and what was changed about the workflow's own steps. */
  tasks: TaskRecord[];
  /** Phases moved on the timeline: the phase key against the day it now starts. */
  phaseDates?: Record<string, string>;
  /** All AI spend on the project, in rand. On the server it is the sum of the AI call log. */
  aiSpendZar: number;
  /** The part of it spent drafting the brief, when logged. */
  briefCostZar?: number;
  lastActivity: string;
}

/** open and in_progress are still being looked at; the reporter closes a report that no longer applies. */
export type IssueStatus = "open" | "in_progress" | "resolved" | "closed";

export const ISSUE_STATUSES: IssueStatus[] = ["open", "in_progress", "resolved", "closed"];

export interface IssueReport {
  id: string;
  moduleKey: string;
  /** The project it was reported in, when there was one. */
  projectId?: string;
  note: string;
  path: string;
  status: IssueStatus;
  /** The Admin's reply to the reporter. */
  adminNote?: string;
  createdAt: string;
  updatedAt?: string;
}

/** Reports that still show a marker: neither resolved nor closed. */
export function isActiveIssue(issue: Pick<IssueReport, "status">): boolean {
  return issue.status === "open" || issue.status === "in_progress";
}
