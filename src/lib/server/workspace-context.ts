import { cache } from "react";
import { NextResponse } from "next/server";
import { auth0, isAuth0Configured } from "@/lib/auth/auth0";
import { ensureWorkspace } from "@/lib/auth/workspace";
import { syncUser, type AppUser } from "@/lib/auth/users";
import { getDb, isNeonConfigured, type Db } from "@/lib/db";
import { DEMO_VIEWER, type Viewer } from "@/lib/studio/viewer";

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
  if (user.status !== "active") {
    const error = user.status === "disabled" ? "Your account is switched off" : "Your account is waiting for the Admin to let you in";
    return NextResponse.json({ error, code: `account_${user.status}` }, { status: 403 });
  }
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

/**
 * The signed-in person for the page shell, recorded on the way; the demo viewer
 * when sign-in is off. Cached per request, since the layout and the page both ask.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!auth0) return DEMO_VIEWER;
  const session = await auth0.getSession();
  if (!session) return { ...DEMO_VIEWER, name: "Signed out", workspace: "" };
  const { user } = session;
  const name = user.name || user.nickname || user.email || "You";
  const base = { name, email: user.email ?? null, signedIn: true, isAdmin: false, canAdmin: false, access: "active" as const };
  const db = getDb();
  if (!db) return { ...base, workspace: "" };
  const appUser = await syncUser(db, user);
  if (appUser.status !== "active") return { ...base, access: appUser.status, workspace: "" };
  const workspaceId = await ensureWorkspace(db, user);
  const [workspace] = await db.query<{ name: string }>("SELECT name FROM workspaces WHERE id = $1", [workspaceId]);
  const canAdmin = appUser.platformRole === "admin";
  return {
    ...base,
    canAdmin,
    // In basic view the Admin sees only what everyone else sees.
    isAdmin: canAdmin && appUser.viewMode === "admin",
    workspace: workspace?.name ?? "",
  };
});
