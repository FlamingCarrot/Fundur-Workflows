import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { isPublicPage } from "../src/lib/site/public-pages";
import { COMPANY } from "../src/lib/site/company";

const SITE = path.join(__dirname, "..", "src", "app", "(site)");

test("public site pages are open; the app is not", () => {
  for (const p of ["/welcome", "/features", "/pricing", "/about", "/legal", "/legal/privacy", "/legal/terms"]) {
    assert.equal(isPublicPage(p), true, p);
  }
  for (const p of ["/", "/projects", "/settings", "/legalese", "/api/projects", "/welcome-back", "/aboutx"]) {
    assert.equal(isPublicPage(p), false, p);
  }
});

test("every public page and legal link has a page behind it", () => {
  const pages = ["welcome", "features", "pricing", "about", "legal"];
  const legal = ["terms", "privacy", "cookies", "acceptable-use", "ai", "paia", "company"];
  for (const p of pages) assert.ok(existsSync(path.join(SITE, p, "page.tsx")), p);
  for (const p of legal) assert.ok(existsSync(path.join(SITE, "legal", p, "page.tsx")), p);
});

test("business facts are never invented: unknown ones stay empty for a placeholder", () => {
  assert.equal(COMPANY.tradingName, "Fundur");
  for (const value of Object.values(COMPANY)) {
    if (value !== null) assert.ok(value.trim().length > 0);
  }
});
