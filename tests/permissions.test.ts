import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "../src/lib/auth/permissions";

test("the workspace owner cannot use admin-only features", () => {
  for (const p of ["admin:manage_models", "admin:view_tickets", "admin:manage_users", "admin:feature_flags"] as const) {
    assert.equal(hasPermission(p, { platformRole: "user", workspaceRole: "owner" }), false, p);
  }
});

test("the platform admin can use admin-only features", () => {
  assert.equal(hasPermission("admin:view_tickets", { platformRole: "admin" }), true);
  assert.equal(hasPermission("admin:manage_models", { platformRole: "admin" }), true);
});

test("a client holds no workspace permissions; share links grant what they see", () => {
  assert.equal(hasPermission("project:view", { workspaceRole: "client" }), false);
  assert.equal(hasPermission("issue:report", { workspaceRole: "client" }), false);
});

test("a user with no workspace role is refused", () => {
  assert.equal(hasPermission("project:view", { platformRole: "user" }), false);
});

test("only workspace owners can edit and publish practice workflows",()=>{for(const permission of ["workflow:edit","workflow:publish"] as const){assert(hasPermission(permission,{workspaceRole:"owner"}));assert(!hasPermission(permission,{workspaceRole:"member"}));assert(!hasPermission(permission,{workspaceRole:"collaborator"}));}});
