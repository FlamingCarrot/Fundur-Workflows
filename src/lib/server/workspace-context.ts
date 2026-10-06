import { NextResponse } from "next/server";
import { auth0, isAuth0Configured } from "@/lib/auth/auth0";
import { ensureWorkspace } from "@/lib/auth/workspace";
import { getDb, isNeonConfigured, type Db } from "@/lib/db";

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
}

/** The database and the signed-in person's workspace, or the response to send instead. */
export async function requireWorkspace(): Promise<WorkspaceContext | NextResponse> {
  const db = getDb();
  if (!db || !auth0 || !usesServerPersistence()) {
    return NextResponse.json({ error: "Projects are not stored on the server in this deployment" }, { status: 404 });
  }
  const session = await auth0.getSession();
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const { sub, email, name, picture } = session.user;
  const workspaceId = await ensureWorkspace(db, { sub, email, name, picture });
  return { db, workspaceId };
}
