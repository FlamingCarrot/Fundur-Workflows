import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import type { Db } from "../src/lib/db";
import {
  emptyPlan,
  normalizePlan,
  LIMITS,
  type Plan,
} from "../src/lib/plan/geometry";
import {
  editFurniture,
  makeAssembly,
  placeAssembly,
  assemblyInput,
} from "../src/lib/plan/groups";
import { planSchema } from "../src/lib/plan/schema";
import { publicPlan } from "../src/lib/design/public-plan";
import { buildScene } from "../src/lib/plan/scene";
import {
  canUseAssemblies,
  createAssembly,
  listAssemblies,
  removeAssembly,
} from "../src/lib/plan/assembly-store";
import {
  takeBackup,
  restoreBackup,
  checkRestore,
} from "../src/lib/backup/backup";

function plan(): Plan {
  const p = emptyPlan();
  p.items = [
    {
      id: "a",
      levelId: p.levels[0].id,
      type: "armchair",
      at: { x: 1_000, y: 2_000 },
      width: 800,
      depth: 850,
      rotation: 0,
      label: "A",
    },
    {
      id: "b",
      levelId: p.levels[0].id,
      type: "sofa",
      at: { x: 3_000, y: 2_000 },
      width: 2_000,
      depth: 900,
      rotation: 90,
    },
  ];
  return p;
}
test("group transforms are atomic, preserve relative spacing and identity, and survive schema/normalisation", () => {
  const original = plan();
  const group = editFurniture(original, ["a", "b"], "group", {
    name: "Reception",
  });
  assert.ok(group.ok);
  assert.equal(group.plan.items[0].groupId, group.plan.items[1].groupId);
  const moved = editFurniture(group.plan, ["a", "b"], "move", {
    delta: { x: 150, y: -400 },
  });
  assert.ok(moved.ok);
  assert.deepEqual(
    moved.plan.items.map((i) => i.at),
    [
      { x: 1_150, y: 1_600 },
      { x: 3_150, y: 1_600 },
    ],
  );
  const turned = editFurniture(moved.plan, ["a", "b"], "rotate");
  assert.ok(turned.ok);
  assert.deepEqual(
    turned.plan.items.map((i) => i.at),
    [
      { x: 2_150, y: 600 },
      { x: 2_150, y: 2_600 },
    ],
  );
  assert.deepEqual(
    turned.plan.items.map((i) => i.rotation),
    [90, 180],
  );
  const parsed = planSchema.parse(turned.plan);
  assert.deepEqual(normalizePlan(parsed).items, turned.plan.items);
  assert.deepEqual(
    original.items.map((i) => i.at),
    [
      { x: 1_000, y: 2_000 },
      { x: 3_000, y: 2_000 },
    ],
  );
  assert.equal(editFurniture(original, ["a", "missing"], "delete").ok, false);
  assert.equal(
    editFurniture(original, ["a", "b"], "move", {
      delta: { x: LIMITS.maxCoord, y: 0 },
    }).ok,
    false,
  );
  const crossFloor = structuredClone(original);
  crossFloor.items[1].levelId = "other";
  assert.equal(editFurniture(crossFloor, ["a", "b"], "group").ok, false);
});
test("copies get new item and group identities; deleting and ungrouping are independent", () => {
  const grouped = editFurniture(plan(), ["a", "b"], "group", {
    name: "Seating",
  });
  assert.ok(grouped.ok);
  const copied = editFurniture(grouped.plan, ["a", "b"], "duplicate");
  assert.ok(copied.ok);
  assert.equal(new Set(copied.plan.items.map((i) => i.id)).size, 4);
  assert.equal(copied.plan.items[2].groupId, copied.plan.items[3].groupId);
  assert.notEqual(copied.plan.items[2].groupId, copied.plan.items[0].groupId);
  const ungrouped = editFurniture(copied.plan, ["a", "b"], "ungroup");
  assert.ok(ungrouped.ok);
  assert.equal(ungrouped.plan.items[0].groupId, undefined);
  assert.ok(ungrouped.plan.items[2].groupId);
  const removed = editFurniture(ungrouped.plan, ["a", "b"], "delete");
  assert.ok(removed.ok);
  assert.equal(removed.plan.items.length, 2);
});
test("saved arrangements strip project ids and flags and place on another floor with fresh identities", () => {
  const p = plan();
  p.items[0].hidden = true;
  p.items[0].color = "#cc8844";
  p.items[0].groupName = "Private working name";
  const assembly = makeAssembly(p, ["a", "b"], "Reception seating");
  assert.deepEqual(
    assembly.items.map((i) => i.at),
    [
      { x: -1_000, y: 0 },
      { x: 1_000, y: 0 },
    ],
  );
  assert.ok(
    assembly.items.every(
      (i) =>
        !("id" in i) &&
        !("levelId" in i) &&
        !("hidden" in i) &&
        !("groupName" in i),
    ),
  );
  const other = emptyPlan();
  const result = placeAssembly(other, assembly, other.levels[0].id, {
    x: 5_000,
    y: 4_000,
  });
  assert.ok(result.ok);
  assert.deepEqual(
    result.plan.items.map((i) => i.at),
    [
      { x: 4_000, y: 4_000 },
      { x: 6_000, y: 4_000 },
    ],
  );
  assert.ok(
    result.plan.items.every((i) => i.id !== "a" && i.id !== "b" && !i.hidden),
  );
  assert.ok(planSchema.safeParse(result.plan).success);
  assert.equal(
    assemblyInput.safeParse({
      ...assembly,
      items: [{ ...assembly.items[0], color: "url(https://example.com)" }],
    }).success,
    false,
  );
});
test("working-view flags and group names stay private; colours and visibility affect 3D", () => {
  const p = plan();
  p.items[0].color = "#cc8844";
  p.items[1].hidden = true;
  p.items[0].groupName = "Private";
  p.items[0].groupId = "group";
  const scene = buildScene(p, {
    levelId: p.levels[0].id,
    allLevels: false,
    separated: false,
    cutWalls: false,
    layers: {
      walls: true,
      openings: true,
      columns: true,
      rooms: true,
      furniture: true,
    },
  });
  assert.ok(
    scene.solids.every((s) => s.target.id === "a" && s.color === "#cc8844"),
  );
  const shared = publicPlan(p);
  assert.equal(
    shared.items.length,
    2,
    "working visibility is not a publication control",
  );
  assert.ok(
    shared.items.every(
      (i) => !("groupName" in i) && !("groupId" in i) && !("hidden" in i),
    ),
  );
});
test("practice library scopes records, denies restricted roles and survives backup/restore", async () => {
  assert.equal(canUseAssemblies("owner"), true);
  assert.equal(canUseAssemblies("member"), true);
  assert.equal(canUseAssemblies("collaborator"), false);
  assert.equal(canUseAssemblies("client"), false);
  const pg = new PGlite();
  await runMigrations({
    exec: (sql) => pg.exec(sql),
    query: (text, params) => pg.query(text, params),
  });
  const db: Db = {
    query: async (text, params) => (await pg.query(text, params)).rows as never,
  };
  const who = {
    sub: "auth0|library-owner",
    name: "Designer",
    email: "design@example.com",
  };
  const user = await syncUser(db, who),
    workspace = await ensureWorkspace(db, who);
  const other = await ensureWorkspace(db, {
    sub: "auth0|library-other",
    name: "Other",
    email: "other@example.com",
  });
  const saved = await createAssembly(
    db,
    workspace,
    user.id,
    makeAssembly(plan(), ["a", "b"], "Reception"),
  );
  assert.equal((await listAssemblies(db, workspace))[0].id, saved.id);
  assert.deepEqual(await listAssemblies(db, other), []);
  assert.equal(await removeAssembly(db, other, saved.id), false);
  const backup = await takeBackup(db);
  assert.equal(backup.tables.furniture_assemblies.length, 1);
  await removeAssembly(db, workspace, saved.id);
  assert.deepEqual(await listAssemblies(db, workspace), []);
  await restoreBackup(db, backup);
  assert.deepEqual(await checkRestore(db, backup), []);
  assert.deepEqual(await listAssemblies(db, workspace), [saved]);
  await pg.close();
});
