import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicTokenRoute } from "../src/lib/auth/public-routes";

test("token readers and frozen-copy decisions can reach their token authorization handlers without a studio session", () => {
  const token = "a".repeat(43);
  for (const path of [`/share/${token}`, `/invite/${token}`, `/api/shared/${token}`, `/api/shared/${token}/file`, `/api/shared/${token}/comments`, `/api/shared/${token}/approval`, "/access-denied"])
    assert.equal(isPublicTokenRoute(path), true, path);
});

test("the token route exemption does not grant access to studio APIs or arbitrary shared subroutes", () => {
  const token = "a".repeat(43);
  for (const path of ["/projects", "/api/projects", "/api/admin/workspace", `/api/projects/${token}/shares`, `/api/shared/${token}/export`, `/api/shared/${token}/approval/extra`, "/api/shared/short/approval", `/api/shared/${token}a/approval`, `/api/shared/${token}/../projects`, "/share/", "/share/token/extra", "/invite/token/accept"])
    assert.equal(isPublicTokenRoute(path), false, path);
});
