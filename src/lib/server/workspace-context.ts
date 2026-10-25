import { cache } from "react";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth0, isAuth0Configured } from "@/lib/auth/auth0";
import { ensureWorkspace } from "@/lib/auth/workspace";
import { syncUser, type AppUser } from "@/lib/auth/users";
import {
  hasPermission,
  type Permission,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import { getDb, isNeonConfigured, type Db } from "@/lib/db";
import { DEMO_VIEWER, UNLIMITED_PLAN, type Viewer } from "@/lib/studio/viewer";
import {
  memberships,
  features,
  canAccessProject,
  projectSlugs,
  type FeatureKey,
  type FeatureState,
} from "@/lib/workspaces/store";
import { summarize } from "@/lib/billing/plans";
import { memberAccess } from "@/lib/team/store";
import { canUseTool, isWritePermission, type ProjectAccess } from "@/lib/team/access";
import { planFor } from "@/lib/billing/store";

export const WORKSPACE_COOKIE = "fundur-workspace";
export function usesServerPersistence(): boolean {
  return isNeonConfigured() && isAuth0Configured();
}
export interface WorkspaceContext {
  db: Db;
  workspaceId: string;
  user: AppUser;
  workspaceRole: WorkspaceRole;
  features: FeatureState;
}
export async function requireWorkspace(): Promise<
  WorkspaceContext | NextResponse
> {
  const db = getDb();
  if (!db || !auth0 || !usesServerPersistence())
    return NextResponse.json(
      { error: "Projects are not stored on the server in this deployment" },
      { status: 404 },
    );
  const session = await auth0.getSession();
  if (!session)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const user = await syncUser(db, session.user);
  if (user.status !== "active")
    return NextResponse.json(
      {
        error:
          user.status === "disabled"
            ? "Your account has been deactivated. Contact your workspace administrator."
            : "Your account is waiting for the Admin to let you in",
        code: `account_${user.status}`,
      },
      { status: 403 },
    );
  await ensureWorkspace(db, session.user);
  const choices = await memberships(db, user.id);
  const requested = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const selected = choices.find((w) => w.id === requested) ?? choices[0];
  if (!selected)
    return NextResponse.json(
      { error: "Workspace access is unavailable" },
      { status: 403 },
    );
  return {
    db,
    workspaceId: selected.id,
    user,
    workspaceRole: selected.role,
    features: await features(db, selected.id, user.id),
  };
}
export function requirePermission(
  ctx: WorkspaceContext,
  permission: Permission,
): NextResponse | null {
  // Platform administration never grants access to unassigned studio projects.
  if (!hasPermission(permission, { workspaceRole: ctx.workspaceRole }))
    return NextResponse.json(
      { error: "You do not have permission to do this" },
      { status: 403 },
    );
  return null;
}
export function requireFeature(
  ctx: WorkspaceContext,
  key: FeatureKey,
): NextResponse | null {
  return ctx.features[key]
    ? null
    : NextResponse.json(
        { error: "This feature is not enabled for your account" },
        { status: 403 },
      );
}
export async function requireProjectAccess(
  ctx: WorkspaceContext,
  slug: string,
  permission: Permission = "project:view",
): Promise<NextResponse | null> {
  const denied = requirePermission(ctx, permission);
  if (denied) return denied;
  if (
    !(await canAccessProject(
      ctx.db,
      ctx.workspaceId,
      ctx.user.id,
      ctx.workspaceRole,
      slug,
    ))
  )
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return null;
}
export async function requireProject(
  slug: string,
  permission: Permission = "project:view",
  feature?: FeatureKey,
  /** The project section the request belongs to, e.g. "plan"; refused when hidden from this person. */
  tool?: string,
): Promise<ProjectContext | NextResponse> {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return checkProject(ctx, slug, permission, feature, tool);
}
/** requireProject's checks for someone already known, e.g. by an access token (src/lib/mcp). */
export async function checkProject(
  ctx: WorkspaceContext,
  slug: string,
  permission: Permission = "project:view",
  feature?: FeatureKey,
  tool?: string,
): Promise<ProjectContext | NextResponse> {
  const denied = await requireProjectAccess(ctx, slug, permission);
  if (denied) return denied;
  if (feature) {
    const disabled = requireFeature(ctx, feature);
    if (disabled) return disabled;
  }
  // What the owner let this teammate do on this project (src/lib/team/access.ts).
  const projectAccess = await memberAccess(ctx.db, ctx.workspaceId, slug, ctx.user.id, ctx.workspaceRole);
  if (projectAccess?.level === "view" && isWritePermission(permission))
    return NextResponse.json({ error: "You can view this project but not change it" }, { status: 403 });
  if (tool && !canUseTool(projectAccess ?? undefined, tool))
    return NextResponse.json({ error: "That part of the project is not shared with you" }, { status: 403 });
  return { ...ctx, projectAccess };
}
export interface ProjectContext extends WorkspaceContext {
  /** Null when the person has full access to the project. */
  projectAccess: ProjectAccess | null;
}
export async function accessibleProjectSlugs(ctx: WorkspaceContext) {
  return projectSlugs(ctx.db, ctx.workspaceId, ctx.user.id, ctx.workspaceRole);
}
export async function refreshWorkspaceContext(
  ctx: WorkspaceContext,
): Promise<WorkspaceContext | NextResponse> {
  const [user] = await ctx.db.query<{ active: boolean; platform_role: string }>(
    "SELECT active,platform_role FROM users WHERE id=$1",
    [ctx.user.id],
  );
  const choices = await memberships(ctx.db, ctx.user.id);
  const current = choices.find((w) => w.id === ctx.workspaceId);
  if (!user?.active || !current)
    return NextResponse.json({ error: "Access ended" }, { status: 403 });
  return {
    ...ctx,
    workspaceRole: current.role,
    user: {
      ...ctx.user,
      active: user.active,
      platformRole: user.platform_role === "admin" ? "admin" : "user",
    },
    features: await features(ctx.db, ctx.workspaceId, ctx.user.id),
  };
}
export async function requireAdmin(): Promise<WorkspaceContext | NextResponse> {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return ctx.user.platformRole === "admin"
    ? ctx
    : NextResponse.json(
        { error: "Only the platform Admin can do this" },
        { status: 403 },
      );
}
/**
 * The signed-in person for the page shell. Cached per request, since the
 * layout and the page both ask. Someone switched off or still waiting gets a
 * viewer that says so, and the layout shows them why instead of the app.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  if (!auth0) return DEMO_VIEWER;
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const user = session.user;
  const name = user.name || user.nickname || user.email || "You";
  const base = { name, email: user.email ?? null, signedIn: true, isAdmin: false, canAdmin: false, access: "active" as const };
  const db = getDb();
  if (!db) return { ...base, workspace: "", plan: UNLIMITED_PLAN };
  const appUser = await syncUser(db, user);
  if (appUser.status !== "active") return { ...base, access: appUser.status, workspace: "", plan: UNLIMITED_PLAN };
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) redirect("/access-denied");
  const choices = await memberships(db, user.sub);
  const canAdmin = ctx.user.platformRole === "admin";
  const plan = await planFor(db, ctx.workspaceId, { admin: canAdmin });
  return {
    ...base,
    userId: ctx.user.id,
    canAdmin,
    // In basic view the Admin sees only what everyone else sees.
    isAdmin: canAdmin && appUser.viewMode === "admin",
    workspace: choices.find((w) => w.id === ctx.workspaceId)?.name ?? "",
    workspaceId: ctx.workspaceId,
    workspaceRole: ctx.workspaceRole,
    features: ctx.features,
    workspaces: choices.map((w) => ({ id: w.id, name: w.name })),
    plan: summarize(plan),
  };
});
