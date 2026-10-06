import type { Plan } from "./geometry";

/** One line of the corrections log: what changed, who changed it and when. */
export interface Correction {
  id: string;
  summary: string;
  at: string;
  by: string;
}

export interface PlanVersionSummary {
  id: string;
  label: string;
  createdAt: string;
  createdBy?: string;
}

/** Everything the editor loads for a project's plan. */
export interface PlanState {
  /** Null until a plan is drawn or imported. */
  plan: Plan | null;
  /** Goes up by one with every save; 0 before the first. */
  revision: number;
  updatedAt?: string;
  updatedBy?: string;
  versions: PlanVersionSummary[];
  corrections: Correction[];
}
