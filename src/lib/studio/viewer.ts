import type { WorkspaceRole } from "@/lib/auth/permissions";
import type { FeatureState } from "@/lib/workspaces/store";
/** Who is using the app, as the screens show them. */
export interface Viewer {
  name: string;
  userId?: string;
  email: string | null;
  /** The platform Admin: sees settings and the issue queue. */
  isAdmin: boolean;
  /** False on the open demo, where nobody is signed in. */
  signedIn: boolean;
  /** The studio the person works in. */
  workspace: string;
  workspaceId?: string;
  workspaceRole?: WorkspaceRole;
  features?: FeatureState;
  workspaces?: { id: string; name: string }[];
}

/** The person shown on the open demo, which has no sign-in. */
export const DEMO_VIEWER: Viewer = {
  name: "Andre Swanepoel",
  email: null,
  isAdmin: false,
  signedIn: false,
  workspace: "Swanepoel Interiors",
};

export function firstName(viewer: Viewer): string {
  return viewer.name.split(/\s+/)[0] || viewer.name;
}
