import { DEFAULT_SUBSCRIPTION, resolvePlan, summarize, type PlanSummary } from "@/lib/billing/plans";

/** Who is using the app, as the screens show them. */
export interface Viewer {
  name: string;
  email: string | null;
  /** The platform Admin: sees settings and the issue queue. */
  isAdmin: boolean;
  /** False on the open demo, where nobody is signed in. */
  signedIn: boolean;
  /** The studio the person works in. */
  workspace: string;
  /** The plan the workspace is on and what it allows. */
  plan: PlanSummary;
}

/** Everything, for the open demo and anywhere no plan applies. */
export const UNLIMITED_PLAN: PlanSummary = summarize(resolvePlan(DEFAULT_SUBSCRIPTION, { demo: true }));

/** The person shown on the open demo, which has no sign-in. */
export const DEMO_VIEWER: Viewer = {
  name: "Andre Swanepoel",
  email: null,
  isAdmin: false,
  signedIn: false,
  workspace: "Swanepoel Interiors",
  plan: UNLIMITED_PLAN,
};

export function firstName(viewer: Viewer): string {
  return viewer.name.split(/\s+/)[0] || viewer.name;
}
