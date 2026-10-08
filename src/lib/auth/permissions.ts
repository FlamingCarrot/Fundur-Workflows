export type PlatformRole = "admin" | "user";
export type WorkspaceRole = "owner" | "member" | "collaborator" | "client";

export type Permission =
  | "project:create"
  | "project:edit"
  | "project:archive"
  | "project:view"
  | "project:export"
  | "issue:report"
  | "phase:work"
  | "document:upload"
  | "document:share"
  | "ai:use"
  | "ai:view_cost"
  | "workflow:edit"
  | "workflow:publish"
  | "admin:manage_models"
  | "admin:view_tickets"
  | "admin:manage_users"
  | "admin:feature_flags";

const ROLE_PERMISSIONS: Record<WorkspaceRole, Permission[]> = {
  owner: [
    "workflow:edit",
    "workflow:publish",
    "project:create",
    "project:edit",
    "project:archive",
    "project:view",
    "phase:work",
    "document:upload",
    "document:share",
    "ai:use",
    "ai:view_cost",
    "project:export",
    "issue:report",
  ],
  member: [
    "project:view",
    "project:edit",
    "phase:work",
    "document:upload",
    "document:share",
    "ai:use",
    "ai:view_cost",
    "project:export",
    "issue:report",
  ],
  collaborator: [
    "project:view",
    "project:edit",
    "phase:work",
    "document:upload",
    "issue:report",
  ],
  // Clients hold a share link, not a membership: they see only what a link
  // includes, which the share link itself grants, never the workspace.
  client: [],
};

const PLATFORM_ADMIN_PERMISSIONS: Permission[] = [
  ...ROLE_PERMISSIONS.owner,
  "workflow:edit",
  "workflow:publish",
  "admin:manage_models",
  "admin:view_tickets",
  "admin:manage_users",
  "admin:feature_flags",
];

export function hasPermission(
  permission: Permission,
  user: { platformRole?: PlatformRole; workspaceRole?: WorkspaceRole }
): boolean {
  if (user.platformRole === "admin") {
    return PLATFORM_ADMIN_PERMISSIONS.includes(permission);
  }
  if (!user.workspaceRole) {
    return false;
  }
  return ROLE_PERMISSIONS[user.workspaceRole]?.includes(permission) ?? false;
}
