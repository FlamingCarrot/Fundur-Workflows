import { NextResponse } from "next/server";
import { auth0, isAuth0Configured } from "@/lib/auth/auth0";
import { ensureWorkspace } from "@/lib/auth/workspace";
import { syncUser, type AppUser } from "@/lib/auth/users";
import { getDb, isNeonConfigured, type Db } from "@/lib/db";
import { DEMO_VIEWER, UNLIMITED_PLAN, type Viewer } from "@/lib/studio/viewer";
import { summarize } from "@/lib/billing/plans";
import { planFor } from "@/lib/billing/store";

/**
 * Projects live in the database once both the database and sign-in are set
 * up. Without sign-in there is no workspace to keep them in, so the app keeps
 * running on demo data in the browser rather than sharing one open database.
 */
export function usesServerPersistence(): boolean {
  return isNeonConfigured() && isAuth0Configured();
}

export interface WorkspaceContext {
  db: Db;
  workspaceId: string;
  user: AppUser;
}

/** The database and the signed-in person's workspace, or the response to send instead. */
export async function requireWorkspace(): Promise<WorkspaceContext | NextResponse> {
  const db = getDb();
  if (!db || !auth0 || !usesServerPersistence()) {
    return NextResponse.json({ error: "Projects are not stored on the server in this deployment" }, { status: 404 });
  }
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const user = await syncUser(db, session.user);
  const workspaceId = await ensureWorkspace(db, session.user);
  return { db, workspaceId, user };
}

/** As requireWorkspace, but only for the platform Admin; anyone else gets a 403. */
export async function requireAdmin(): Promise<WorkspaceContext | NextResponse> {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.user.platformRole !== "admin") {
    return NextResponse.json({ error: "Only the platform Admin can do this" }, { status: 403 });
  }
  return ctx;
}

/** The signed-in person for the page shell, recorded on the way; the demo viewer when sign-in is off. */
export async function getViewer(): Promise<Viewer> {
  if (!auth0) return DEMO_VIEWER;
  const session = await auth0.getSession();
  if (!session) return { ...DEMO_VIEWER, name: "Signed out", workspace: "" };
  const { user } = session;
  const name = user.name || user.nickname || user.email || "You";
  const db = getDb();
  if (!db) return { name, email: user.email ?? null, isAdmin: false, signedIn: true, workspace: "", plan: UNLIMITED_PLAN };
  const { platformRole } = await syncUser(db, user);
  const workspaceId = await ensureWorkspace(db, user);
  const [[workspace], plan] = await Promise.all([
    db.query<{ name: string }>("SELECT name FROM workspaces WHERE id = $1", [workspaceId]),
    planFor(db, workspaceId, { admin: platformRole === "admin" }),
  ]);
  return {
    name,
    email: user.email ?? null,
    isAdmin: platformRole === "admin",
    signedIn: true,
    workspace: workspace?.name ?? "",
    plan: summarize(plan),
  };
}
