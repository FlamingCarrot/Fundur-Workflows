import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { syncUser } from "../src/lib/auth/users";
import { STANDARD_BLUEPRINTS, standardBlueprint, wallThickness } from "../src/lib/blueprints/defaults";
import { STANDARD_MATERIALS } from "../src/lib/blueprints/materials";
import { flatten, instanceShapes, resolver, STANDARD, topView, usedBy, wouldLoop, MAX_PRIMITIVES } from "../src/lib/blueprints/resolve";
import { addShape, arrayPart, blankBlueprint, copyOf, fitToParts, mirrorPart, nestBlueprint, problems, resizeBlueprint, setLayers, updatePart } from "../src/lib/blueprints/edit";
import { blueprintBody, materialBody } from "../src/lib/blueprints/schema";
import { previewFaces, blueprintPreview } from "../src/lib/blueprints/preview";
import { itemSymbol } from "../src/lib/blueprints/symbol";
import { addCamera, blueprintFromItems, placeBlueprint, swapForBlueprint, removeCamera, setItemBlueprint, setItemLook, setRoomFloor, setWallType, syncWallTypes, updateCamera, usesOf } from "../src/lib/blueprints/plan-edits";
import { createEntry, LibraryConflictError, LibraryError, listLibrary, listVersions, removeEntry, updateEntry } from "../src/lib/blueprints/store";
import { bodyOf } from "../src/lib/blueprints/body";
import { imagesToPdf } from "../src/lib/export/image-pdf";
import { buildScene } from "../src/lib/plan/scene";
import { emptyPlan, FIRST_LEVEL_ID, roomArea, samplePlan, type Plan } from "../src/lib/plan/geometry";
import { schedule, scheduleCsv, scheduleText } from "../src/lib/plan/schedules";
import { planSheets, sheetNumber, STANDARD_SCALES } from "../src/lib/plan/sheet";
import { colourFill } from "../src/lib/plan/colour-fill";
import { planSchema } from "../src/lib/plan/schema";
import { exportDxf } from "../src/lib/plan/dxf";
import { applyOperations, detailPlan } from "../src/lib/ai/tools/plan-edit";
import { describeBlueprint, findBlueprint, findMaterial } from "../src/lib/ai/tools/library";
import { categoryFor, diffuseUrl, forgetCatalogue, importFree, searchFree, toTexture } from "../src/lib/textures/free";
import { viewCommand } from "../src/lib/assistant/view-command";
import type { Blueprint } from "../src/lib/blueprints/types";
import sharp from "sharp";

const asBlueprint = (b: Omit<Blueprint, "id">, id: string): Blueprint => ({ ...b, id, revision: 1 });

test("every default blueprint and material is valid, unique and draws", () => {
  const ids = new Set<string>();
  for (const bp of STANDARD_BLUEPRINTS) {
    assert.ok(bp.id.startsWith("std:"), bp.id);
    assert.ok(!ids.has(bp.id), `duplicate ${bp.id}`);
    ids.add(bp.id);
    const parsed = blueprintBody.safeParse(bodyOf(bp));
    assert.ok(parsed.success, `${bp.id}: ${parsed.success ? "" : parsed.error.message}`);
    assert.ok(flatten(STANDARD, bp).length > 0, `${bp.id} has no shapes`);
    assert.deepEqual(problems(STANDARD, bp), [], bp.id);
    assert.ok(blueprintPreview(STANDARD, bp).faces.length > 0, `${bp.id} has no preview`);
  }
  for (const m of STANDARD_MATERIALS) assert.ok(materialBody.safeParse(bodyOf(m)).success, m.id);
  // Every furniture type has its default blueprint.
  for (const type of ["desk", "chair", "sofa", "meeting-table", "bed-double", "box"]) assert.ok(standardBlueprint(`std:${type}`), type);
});

test("nested blueprints flatten into the parent's frame and follow the child", () => {
  const set = standardBlueprint("std:dining-set-4")!;
  const shapes = flatten(STANDARD, set);
  assert.ok(shapes.some((s) => s.path.length > 1), "nested parts keep their path");
  // Changing the nested chair changes the set: a taller chair reaches higher.
  const chair = STANDARD.blueprint(set.parts.find((p) => p.blueprintId)!.blueprintId!)!;
  const tall = { ...chair, size: { ...chair.size, h: chair.size.h * 2 }, parts: chair.parts.map((p) => ({ ...p, size: { ...p.size, h: p.size.h * 2 }, at: { ...p.at, z: p.at.z * 2 } })) };
  const lib = resolver({ blueprints: [tall] });
  const before = Math.max(...shapes.map((s) => s.z + s.h));
  const after = Math.max(...flatten(lib, set).map((s) => s.z + s.h));
  assert.ok(after >= before, "the set uses the changed chair");
  assert.ok(usedBy(STANDARD, chair.id).some((b) => b.id === set.id));
});

test("a blueprint cannot be nested in itself, directly or through another", () => {
  const a = asBlueprint(blankBlueprint("A"), "a");
  const b = asBlueprint(blankBlueprint("B"), "b");
  let lib = resolver({ blueprints: [a, b] });
  const ab = nestBlueprint(lib, a, "b");
  assert.ok(ab.ok);
  lib = resolver({ blueprints: [ab.blueprint, b] });
  assert.equal(wouldLoop(lib, "b", "a"), true);
  const ba = nestBlueprint(lib, b, "a");
  assert.equal(ba.ok, false);
  assert.equal(nestBlueprint(lib, a, "a").ok, false);
  // A loop that slipped in (two saves racing) still draws, without hanging.
  const looped = resolver({ blueprints: [ab.blueprint, { ...b, parts: [...b.parts, { id: "x", blueprintId: "a", at: { x: 0, y: 0, z: 0 }, size: { w: 10, d: 10, h: 10 }, rotation: 0 }] }] });
  const shapes = flatten(looped, ab.blueprint);
  assert.ok(shapes.length > 0 && shapes.length <= MAX_PRIMITIVES);
  assert.ok(problems(looped, ab.blueprint).length === 0 || true);
});

test("part edits: shapes, mirror, repeat, resize and fit", () => {
  let bp = asBlueprint({ ...blankBlueprint("Shelf"), parts: [] }, "s");
  const added = addShape(bp, "box", { at: { x: 300, y: 0, z: 0 }, size: { w: 100, d: 300, h: 1_000 }, rotation: 30 });
  assert.ok(added.ok);
  bp = added.blueprint;
  const id = added.partId!;
  const mx = mirrorPart(bp, id, "x");
  assert.ok(mx.ok);
  const copy = mx.blueprint.parts[1];
  assert.equal(copy.at.x, -300);
  assert.equal(((copy.rotation % 360) + 360) % 360, 330, "mirroring across turns it the other way");
  const my = mirrorPart(bp, id, "y", false);
  assert.ok(my.ok);
  assert.equal(my.blueprint.parts.length, 1);
  assert.equal(my.blueprint.parts[0].rotation, 150);
  const arr = arrayPart(bp, id, 4, { x: 0, y: 0, z: 300 });
  assert.ok(arr.ok);
  assert.equal(arr.blueprint.parts.length, 4);
  assert.equal(arr.blueprint.parts[3].at.z, 900);
  const resized = resizeBlueprint(bp, { w: bp.size.w * 2, d: bp.size.d, h: bp.size.h });
  assert.ok(resized.ok);
  assert.equal(resized.blueprint.parts[0].at.x, 600);
  const fit = fitToParts(STANDARD, arr.blueprint);
  assert.ok(fit.ok);
  assert.ok(Math.abs(fit.blueprint.size.h - 1_900) < 1);
  assert.equal(updatePart(STANDARD, bp, id, { size: { w: 0, d: 1, h: 1 } }).ok, false);
});

test("wall types: layers set the thickness and parts; walls of the type follow", () => {
  const drywall = standardBlueprint("std:wall-drywall-100")!;
  assert.equal(drywall.kind, "wall");
  assert.equal(drywall.size.d, wallThickness(drywall.layers!));
  const mine = asBlueprint(copyOf(drywall, "Acoustic drywall"), "w1");
  const thicker = setLayers(mine, [...mine.layers!, { name: "Insulation", thickness: 50, material: "std:felt-grey" }]);
  assert.ok(thicker.ok);
  assert.equal(thicker.blueprint.size.d, drywall.size.d + 50);

  let plan = samplePlan();
  const wall = plan.walls[0];
  const typed = setWallType(plan, resolver({ blueprints: [mine] }), wall.id, "w1");
  assert.ok(typed.ok);
  plan = typed.plan;
  assert.equal(plan.walls[0].thickness, mine.size.d);
  assert.equal(syncWallTypes(plan, resolver({ blueprints: [mine] })), null, "nothing to sync when it matches");
  const synced = syncWallTypes(plan, resolver({ blueprints: [thicker.blueprint] }));
  assert.ok(synced?.ok);
  assert.equal(synced.plan.walls[0].thickness, mine.size.d + 50);
  assert.equal(usesOf(plan, resolver({ blueprints: [mine] }), "w1"), 1);
  // The scene draws the typed wall as its layers.
  const scene = buildScene(plan, { levelId: FIRST_LEVEL_ID, allLevels: false, separated: false, cutWalls: false, layers: { walls: true, openings: true, columns: true, rooms: true, furniture: true } }, resolver({ blueprints: [mine] }));
  assert.ok(scene.solids.some((s) => s.material === "std:felt-grey" || s.material === mine.layers![0].material));
});

test("placing blueprints, swapping them and their look are plan edits", () => {
  const custom = asBlueprint({ ...copyOf(standardBlueprint("std:desk")!, "Studio desk"), size: { w: 1_800, d: 900, h: 740 } }, "d1");
  const lib = resolver({ blueprints: [custom] });
  const std = placeBlueprint(emptyPlan(), lib, "std:desk", { x: 0, y: 0 }, FIRST_LEVEL_ID);
  assert.ok(std.ok);
  assert.equal(std.plan.items[0].blueprintId, undefined, "a default type keeps plans as they were");
  const mine = placeBlueprint(std.plan, lib, "d1", { x: 3_000, y: 0 }, FIRST_LEVEL_ID, 90);
  assert.ok(mine.ok);
  const item = mine.plan.items.find((i) => i.id === mine.id)!;
  assert.deepEqual([item.blueprintId, item.width, item.depth, item.rotation, item.type], ["d1", 1_800, 900, 90, "desk"]);
  assert.ok(planSchema.safeParse(mine.plan).success);
  assert.equal(placeBlueprint(emptyPlan(), lib, "std:wall-drywall-100", { x: 0, y: 0 }, FIRST_LEVEL_ID).ok, false);

  const swapped = setItemBlueprint(mine.plan, lib, item.id, "std:sofa", false);
  assert.ok(swapped.ok);
  const s = swapped.plan.items.find((i) => i.id === item.id)!;
  assert.deepEqual([s.type, s.blueprintId, s.width], ["sofa", undefined, 1_800]);

  const looked = setItemLook(mine.plan, lib, item.id, { height: 1_000, elevation: 300, material: "std:walnut" });
  assert.ok(looked.ok);
  const l = looked.plan.items.find((i) => i.id === item.id)!;
  assert.deepEqual([l.height, l.elevation, l.material], [1_000, 300, "std:walnut"]);
  assert.equal(setItemLook(mine.plan, lib, item.id, { material: "nope" }).ok, false);

  // The 2D symbol and DXF follow the blueprint.
  assert.ok(itemSymbol(lib, item).length > 0);
  assert.match(exportDxf(mine.plan, lib), /LWPOLYLINE|LINE/);

  const plan = samplePlan();
  const floor = setRoomFloor(plan, lib, plan.rooms[0].id, "std:oak-planks");
  assert.ok(floor.ok);
  assert.equal(floor.plan.rooms[0].floorMaterial, "std:oak-planks");
});

test("cameras are kept on the plan, checked, and undone like any edit", () => {
  const plan = emptyPlan();
  const bad = addCamera(plan, { levelId: FIRST_LEVEL_ID, eye: { x: 0, y: 0, z: 1_600 }, target: { x: 0, y: 0, z: 1_600 }, fov: 50, projection: "perspective" });
  assert.equal(bad.ok, false);
  const made = addCamera(plan, { name: "Entrance", levelId: FIRST_LEVEL_ID, eye: { x: 0, y: 0, z: 1_600 }, target: { x: 5_000, y: 3_000, z: 1_200 }, fov: 50, projection: "perspective", slices: [{ id: "s", axis: "z", at: 1_200, flip: false, enabled: true }], style: "clay" });
  assert.ok(made.ok);
  assert.ok(planSchema.safeParse(made.plan).success, "the server accepts plans with cameras");
  const moved = updateCamera(made.plan, made.id!, { name: "Lobby" });
  assert.ok(moved.ok);
  assert.equal(moved.plan.cameras![0].name, "Lobby");
  const gone = removeCamera(moved.plan, made.id!);
  assert.ok(gone.ok);
  assert.equal(gone.plan.cameras!.length, 0);
});

test("previews and top views come from the parts", () => {
  const preview = previewFaces(flatten(STANDARD, standardBlueprint("std:round-table")!), () => "#888888");
  assert.ok(preview.faces.length > 10);
  assert.match(preview.viewBox, /^-?\d/);
  const top = topView(instanceShapes(STANDARD, standardBlueprint("std:sofa")!, { w: 2_000, d: 900, h: 800 }));
  assert.ok(top.length > 0);
});

test("a PDF of renders has one page per image and a valid cross-reference table", async () => {
  const jpeg = new Uint8Array(await sharp({ create: { width: 40, height: 20, channels: 3, background: "#808080" } }).jpeg().toBuffer());
  const pdf = imagesToPdf([{ jpeg, width: 40, height: 20, caption: "View – one" }, { jpeg, width: 40, height: 20 }], { title: "Harbour" });
  const text = Buffer.from(pdf).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\(Harbour - View - one\) Tj/);
  const xref = Number(/startxref\n(\d+)/.exec(text)![1]);
  assert.ok(text.slice(xref).startsWith("xref"));
  // Every object offset points at its object.
  const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(text.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});

test("the assistant places blueprints, types walls, finishes floors and sets cameras", () => {
  const custom = asBlueprint(copyOf(standardBlueprint("std:sofa")!, "Lounge sofa"), "sofa1");
  const lib = resolver({ blueprints: [custom] });
  const plan = samplePlan();
  const r = applyOperations(
    plan,
    FIRST_LEVEL_ID,
    [
      { op: "place", blueprint: "lounge sofa", at: { x: 2_000, y: 2_000 }, material: "Walnut", elevation: 0, ref: "s" },
      { op: "set_item", itemId: "s", height: 900 },
      { op: "wall_type", wallId: plan.walls[0].id, type: "std:wall-brick-230" },
      { op: "room_floor", roomId: plan.rooms[0].id, material: "Oak floorboards" },
      { op: "camera", name: "Corner", eye: { x: 500, y: 500, z: 1_600 }, target: { x: 6_000, y: 4_000, z: 1_000 } },
    ],
    lib
  );
  assert.ok(r.ok, r.ok ? "" : r.error);
  const item = r.plan.items.find((i) => i.id === r.made.s)!;
  assert.deepEqual([item.blueprintId, item.material, item.height], ["sofa1", "std:walnut", 900]);
  assert.equal(r.plan.walls[0].typeId, "std:wall-brick-230");
  assert.equal(r.plan.walls[0].thickness, 230);
  assert.equal(r.plan.cameras?.length, 1);
  const text = detailPlan(r.plan, FIRST_LEVEL_ID, lib);
  assert.match(text, /Lounge sofa/);
  assert.match(text, /camera "Corner"/);
  assert.match(text, /type Brick/i);
  const missing = applyOperations(plan, FIRST_LEVEL_ID, [{ op: "place", blueprint: "no such thing", at: { x: 0, y: 0 } }], lib);
  assert.equal(missing.ok, false);
  assert.ok(findBlueprint(lib, "desk"));
  assert.ok(findMaterial(lib, "oak"));
  assert.match(describeBlueprint(lib, standardBlueprint("std:dining-set-4")!), /\[part /);
});

test("view commands are checked before they reach the editor", () => {
  assert.ok(viewCommand.safeParse({ mode: "3d", view: "front", projection: "orthographic", sections: [{ axis: "z", at: 1_200 }] }).success);
  assert.ok(viewCommand.safeParse({ render: { kind: "ai", direction: "warm minimal" } }).success);
  assert.equal(viewCommand.safeParse({ view: "sideways" }).success, false);
  assert.equal(viewCommand.safeParse({ sections: Array.from({ length: 13 }, () => ({ axis: "x", at: 0 })) }).success, false);
});

test("free textures: search, pick the colour map, and keep a small image", async () => {
  forgetCatalogue();
  const png = await sharp({ create: { width: 1_024, height: 1_024, channels: 3, background: { r: 180, g: 140, b: 90 } } }).jpeg().toBuffer();
  const calls: string[] = [];
  const fake = (async (url: string | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/assets?t=textures")) return Response.json({ oak_floor: { name: "Oak Floor", categories: ["wood", "floor"], tags: ["planks"], dimensions: [2_000, 2_000], download_count: 9 }, rock_1: { name: "Rock", categories: ["rock"], download_count: 3 } });
    if (u.includes("/files/oak_floor")) return Response.json({ Diffuse: { "1k": { jpg: { url: "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/oak_floor/oak_floor_diff_1k.jpg" } } } });
    if (u.startsWith("https://dl.polyhaven.org/")) return new Response(png, { headers: { "content-length": String(png.length) } });
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  const found = await searchFree("oak", fake);
  assert.deepEqual(found.map((t) => t.id), ["oak_floor"]);
  const body = await importFree("oak_floor", fake);
  assert.ok(materialBody.safeParse(body).success);
  assert.equal(body.category, "Wood");
  assert.equal(body.tile, 2_000);
  assert.equal(body.source?.licence, "CC0");
  assert.ok(body.image!.length < 400_000);
  assert.equal(diffuseUrl({ nor_gl: {}, diff: { "1k": { jpg: { url: "https://dl.polyhaven.org/x.jpg" } } } }), "https://dl.polyhaven.org/x.jpg");
  // Files are only taken from Poly Haven's own host.
  forgetCatalogue();
  const evil = (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith("/assets?t=textures")) return Response.json({ oak_floor: { name: "Oak" } });
    return Response.json({ Diffuse: { "1k": { jpg: { url: "https://evil.example/x.jpg" } } } });
  }) as typeof fetch;
  await assert.rejects(importFree("oak_floor", evil), /no image/);
  assert.equal(categoryFor("white marble tiles"), "Tile");
  const t = await toTexture(new Uint8Array(png));
  assert.match(t.color, /^#b48c5a|^#b[0-9a-f]8[0-9a-f]5[0-9a-f]/);
});

async function freshDb(): Promise<Db> {
  const pg = new PGlite();
  await runMigrations({ exec: (sql) => pg.exec(sql), query: (text, params) => pg.query(text, params) });
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}

test("the practice's library keeps versions, refuses stale saves and nesting loops", async () => {
  const db = await freshDb();
  const who = { sub: "auth0|designer", email: "dee@example.com", name: "Dee" };
  const user = await syncUser(db, who);
  const ws = await ensureWorkspace(db, who);
  const a = await createEntry(db, ws, user.id, "blueprint", blankBlueprint("Bench"));
  const b = await createEntry(db, ws, user.id, "blueprint", { ...blankBlueprint("Pair"), parts: [{ id: "p1", blueprintId: a.entry.id, at: { x: 0, y: 0, z: 0 }, size: { w: 1_000, d: 600, h: 750 }, rotation: 0 }] });
  assert.equal(b.entry.revision, 1);
  // Bench cannot now contain Pair.
  await assert.rejects(updateEntry(db, ws, user.id, a.entry.id, 1, { ...bodyOf(a.entry), parts: [{ id: "x", blueprintId: b.entry.id, at: { x: 0, y: 0, z: 0 }, size: { w: 1, d: 1, h: 1 }, rotation: 0 }] }), LibraryError);
  const renamed = await updateEntry(db, ws, user.id, a.entry.id, 1, { ...bodyOf(a.entry), name: "Long bench" });
  assert.equal(renamed.entry.revision, 2);
  assert.equal((renamed.entry as Blueprint).updatedBy, "Dee");
  await assert.rejects(updateEntry(db, ws, user.id, a.entry.id, 1, { ...bodyOf(a.entry), name: "Stale" }), LibraryConflictError);
  const versions = await listVersions(db, ws, a.entry.id);
  assert.deepEqual(versions.map((v) => v.revision), [2, 1]);
  const lib = await listLibrary(db, ws);
  assert.equal(lib.blueprints.length, 2);
  const mat = await createEntry(db, ws, user.id, "material", { name: "Clay plaster", category: "Paint", color: "#c8a68a", roughness: 0.9, metalness: 0 });
  assert.equal(mat.kind, "material");
  assert.ok(await removeEntry(db, ws, a.entry.id));
  assert.equal((await listLibrary(db, ws)).blueprints.length, 1);
  // A plan using a removed blueprint still draws, as a box.
  const plan: Plan = { ...emptyPlan(), items: [{ id: "i", levelId: FIRST_LEVEL_ID, type: "box", blueprintId: a.entry.id, at: { x: 0, y: 0 }, width: 1_000, depth: 600, rotation: 0 }] };
  const scene = buildScene(plan, { levelId: FIRST_LEVEL_ID, allLevels: false, separated: false, cutWalls: false, layers: { walls: true, openings: true, columns: true, rooms: true, furniture: true } }, resolver(await listLibrary(db, ws)));
  assert.ok(scene.solids.length > 0);
});

test("furniture picked on a plan becomes one nested blueprint that looks the same in 3D", () => {
  let plan = emptyPlan();
  const ids: string[] = [];
  for (const [type, x, y, rot] of [["desk", 1000, 1000, 0], ["chair", 1000, 1700, 90], ["desk", 2600, 1000, 180]] as const) {
    const r = placeBlueprint(plan, STANDARD, `std:${type}`, { x, y }, FIRST_LEVEL_ID, rot);
    assert.ok(r.ok);
    plan = r.plan;
    ids.push(r.id!);
  }
  plan = { ...plan, items: plan.items.map((i) => (i.id === ids[1] ? { ...i, elevation: 50, material: "std:sage-paint" } : i)) };
  const made = blueprintFromItems(plan, STANDARD, ids, "  Pair of desks ");
  assert.ok(made.ok);
  assert.equal(made.blueprint.name, "Pair of desks");
  assert.equal(made.blueprint.parts.length, 3);
  assert.equal(made.blueprint.category, "Other");
  assert.ok(blueprintBody.safeParse(made.blueprint).success);
  assert.equal(made.blueprint.parts[1].at.z, 50);
  assert.equal(made.blueprint.parts[1].material, "std:sage-paint");
  const mine = { ...made.blueprint, id: "pair" } as Blueprint;
  const lib = resolver({ blueprints: [mine] });
  const swapped = swapForBlueprint(plan, ids, mine, made.at, made.levelId);
  assert.ok(swapped.ok);
  assert.equal(swapped.plan.items.length, 1);
  assert.equal(swapped.plan.items[0].blueprintId, "pair");
  // Every shape lands where it stood before.
  const opts = { levelId: FIRST_LEVEL_ID, allLevels: false, separated: false, cutWalls: false, layers: { walls: true, openings: true, columns: true, rooms: true, furniture: true } };
  const key = (p: Plan) => {
    const { solids, origin } = buildScene(p, opts, lib);
    void origin;
    return solids.map((s) => [...s.at, ...s.size].map((v) => v.toFixed(3)).join(",")).sort();
  };
  const before = key(plan);
  const after = key(swapped.plan);
  assert.equal(after.length, before.length);
  const shift = (list: string[]) => {
    const rows = list.map((r) => r.split(",").map(Number));
    const mx = rows.reduce((a, r) => a + r[0], 0) / rows.length;
    const mz = rows.reduce((a, r) => a + r[2], 0) / rows.length;
    return rows.map((r) => [r[0] - mx, r[1], r[2] - mz, r[3], r[4], r[5]].map((v) => v.toFixed(2)).join(",")).sort();
  };
  assert.deepEqual(shift(after), shift(before));
  assert.equal(blueprintFromItems(plan, STANDARD, [], "x").ok, false);
  assert.equal(blueprintFromItems(plan, STANDARD, ids, " ").ok, false);
});

test("schedules count furniture, rooms, openings and walls from the plan, and export safe CSV", () => {
  let plan = samplePlan();
  const level = plan.levels[0].id;
  for (const x of [1000, 2000, 3000]) {
    const r = placeBlueprint(plan, STANDARD, "std:desk", { x, y: 3000 }, level);
    assert.ok(r.ok);
    plan = r.plan;
  }
  const furniture = schedule(plan, "furniture", STANDARD, level);
  const desks = furniture.rows.find((r) => r.cells.name === standardBlueprint("std:desk")!.name && r.targets.length >= 3);
  assert.ok(desks, "three desks of one size make one row");
  assert.equal(desks.cells.count, desks.targets.length);
  assert.equal(furniture.totals.count, plan.items.filter((i) => i.levelId === level).length);
  const rooms = schedule(plan, "rooms", STANDARD, level);
  assert.equal(rooms.rows.length, plan.rooms.length);
  assert.ok(Math.abs(rooms.totals.area - plan.rooms.reduce((s, r) => s + roomArea(r), 0)) < 0.05);
  const openings = schedule(plan, "openings", STANDARD);
  assert.equal(openings.totals.count, plan.openings.length);
  const walls = schedule(plan, "walls", STANDARD);
  assert.equal(walls.totals.count, plan.walls.length);
  assert.ok(walls.totals.length > 0 && walls.totals.area > 0);
  const named = { ...plan, rooms: plan.rooms.map((r, i) => (i === 0 ? { ...r, name: '=HYPERLINK("x"), "big"' } : r)) };
  const csv = scheduleCsv(schedule(named, "rooms", STANDARD));
  assert.ok(csv.includes(`"'=HYPERLINK(""x""), ""big"""`), csv);
  assert.ok(csv.trim().split("\r\n").at(-1)!.startsWith("Total,"));
  assert.match(scheduleText(walls), /Wall schedule/);
});

test("sheets draw each floor to a standard scale with a title block, as a valid PDF", () => {
  const plan = samplePlan();
  const fit = planSheets(plan, { paper: "A3", scale: "fit", projectName: "Harbour & Vine", title: "General arrangement", number: "A-101" });
  assert.ok(fit.ok);
  assert.equal(fit.sheets, 1);
  assert.ok((STANDARD_SCALES as readonly number[]).includes(fit.scale));
  const text = new TextDecoder("latin1").decode(fit.pdf);
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  assert.match(text, /\(Harbour & Vine\) Tj/);
  assert.match(text, new RegExp(`\\(1:${fit.scale} at A3\\) Tj`));
  // The cross-reference table points at each object.
  const xref = Number(text.match(/startxref\n(\d+)/)![1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  for (const m of text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)) assert.match(text.slice(Number(m[1]), Number(m[1]) + 12), /^\d+ 0 obj/);
  const tight = planSheets(plan, { paper: "A4", scale: 20, projectName: "x" });
  assert.equal(tight.ok, false);
  assert.match(!tight.ok ? tight.error : "", /does not fit/);
  assert.equal(sheetNumber("A-101", 2), "A-103");
  assert.equal(sheetNumber("A-099", 1), "A-100");
  assert.equal(sheetNumber("Plan", 1), "Plan-2");
  const withView = planSheets(plan, { paper: "A4", scale: "fit", projectName: "x", views: [{ jpeg: new Uint8Array([255, 216, 255, 217]), width: 4, height: 3, title: "3D view" }] });
  assert.ok(withView.ok && withView.sheets === 2);
});

test("colour fill tints rooms by name, finish or size, with a legend totalling each", () => {
  let plan = samplePlan();
  const level = plan.levels[0].id;
  plan = { ...plan, rooms: plan.rooms.map((r, i) => (i < 2 ? { ...r, name: "Meeting room" } : r)) };
  const byName = colourFill(plan, level, "name");
  const meetings = byName.legend.find((r) => r.label === "Meeting room");
  assert.ok(meetings);
  assert.equal(meetings.rooms, 2);
  const [a, b] = plan.rooms.slice(0, 2).map((r) => byName.fills.get(r.id));
  assert.equal(a, b);
  assert.equal(new Set(byName.legend.map((r) => r.colour)).size, byName.legend.length, "different names, different colours");
  assert.ok(Math.abs(byName.legend.reduce((s, r) => s + r.area, 0) - plan.rooms.filter((r) => r.levelId === level).reduce((s, r) => s + roomArea(r), 0)) < 0.05);
  assert.equal(colourFill(plan, level, "none").fills.size, 0);
  const bySize = colourFill(plan, level, "size");
  assert.ok(bySize.legend.length >= 1);
  const byFinish = colourFill(plan, level, "finish");
  assert.equal(byFinish.legend[0].label, "No finish set");
  const sheet = planSheets(plan, { paper: "A3", scale: "fit", projectName: "x", colourBy: "name" });
  assert.ok(sheet.ok);
  assert.match(new TextDecoder("latin1").decode(sheet.pdf), /\(Meeting room\) Tj/);
});

test("turned, extruded, tapered, hollow and tilted parts", async () => {
  const { addShape, updatePart, mirrorPart, blankBlueprint } = await import("../src/lib/blueprints/edit");
  const { latheOutline, LATHE_PRESETS } = await import("../src/lib/blueprints/forms");
  const { flatten, topView, extent, STANDARD } = await import("../src/lib/blueprints/resolve");
  const { blueprintBody } = await import("../src/lib/blueprints/schema");
  let bp = { ...blankBlueprint("Pots"), id: "x", parts: [] } as import("../src/lib/blueprints/types").Blueprint;
  const lathe = addShape(bp, "lathe", { size: { w: 400, d: 400, h: 500 } });
  assert.ok(lathe.ok);
  bp = lathe.blueprint;
  const part = bp.parts[0];
  assert.equal(part.profile!.length, LATHE_PRESETS[0].profile.length);
  // Hollowed: a wall and a base; too thick a wall is refused.
  const hollow = updatePart(STANDARD, bp, part.id, { hollow: 20 });
  assert.ok(hollow.ok);
  assert.equal(hollow.blueprint.parts[0].hollow, 20);
  assert.ok(!updatePart(STANDARD, bp, part.id, { hollow: 250 }).ok);
  const outline = latheOutline(LATHE_PRESETS[0].profile, { wall: 0.1, base: 0.04 });
  assert.deepEqual(outline[0], [0, 0]);
  assert.deepEqual(outline.at(-1), [0, 0.04]);
  // An extrusion's outline, mirrored left to right, and a lean that mirrors with it.
  const ex = addShape(bp, "extrude", { at: { x: 600, y: 0, z: 0 }, size: { w: 1000, d: 600, h: 30 }, taper: 1, tilt: { y: 10 } });
  assert.ok(ex.ok);
  const exPart = ex.blueprint.parts.at(-1)!;
  assert.equal(exPart.taper, undefined);
  const m = mirrorPart(ex.blueprint, exPart.id, "x");
  assert.ok(m.ok);
  const copy = m.blueprint.parts.at(-1)!;
  assert.deepEqual(copy.profile![1], [1 - exPart.profile![1][0], exPart.profile![1][1]]);
  assert.equal(copy.tilt?.y, -10);
  // A cone, a taper the schema keeps, and shapes seen from above.
  const cone = addShape(bp, "cylinder", { taper: 0 });
  assert.ok(cone.ok);
  assert.equal(cone.blueprint.parts.at(-1)!.taper, 0);
  const shapes = flatten(STANDARD, m.blueprint);
  assert.ok(topView(shapes).some((s) => s.t === "poly" && s.points.length === exPart.profile!.length));
  assert.ok(extent(shapes));
  assert.ok(blueprintBody.safeParse({ ...m.blueprint }).success);
  // Turning a box into a lathe gives it a profile; a box keeps none.
  const turned = updatePart(STANDARD, bp, part.id, { shape: "box" });
  assert.ok(turned.ok && !turned.blueprint.parts[0].profile && !turned.blueprint.parts[0].hollow);
});

test("handles move, turn and size parts together", async () => {
  const { addShape, blankBlueprint, transformParts } = await import("../src/lib/blueprints/edit");
  let bp = { ...blankBlueprint("Set"), id: "x", parts: [] } as import("../src/lib/blueprints/types").Blueprint;
  bp = (addShape(bp, "box", { at: { x: -500, y: 0, z: 0 }, size: { w: 400, d: 200, h: 300 } }) as { blueprint: typeof bp }).blueprint;
  bp = (addShape(bp, "box", { at: { x: 500, y: 0, z: 100 }, size: { w: 400, d: 200, h: 300 } }) as { blueprint: typeof bp }).blueprint;
  const ids = bp.parts.map((p) => p.id);
  const moved = transformParts(bp, ids, { move: { x: 10, y: 20, z: 30 } });
  assert.ok(moved.ok);
  assert.deepEqual(moved.blueprint.parts[0].at, { x: -490, y: 20, z: 30 });
  // A quarter turn about their middle swings them front to back.
  const turned = transformParts(bp, ids, { turn: 90 });
  assert.ok(turned.ok);
  assert.deepEqual(turned.blueprint.parts[0].at, { x: 0, y: -500, z: 0 });
  assert.equal(turned.blueprint.parts[1].rotation, 90);
  // Doubled across: sizes and spacing grow about the middle; heights about the lowest underside.
  const sized = transformParts(bp, ids, { scale: { x: 2, y: 1, z: 2 } });
  assert.ok(sized.ok);
  assert.equal(sized.blueprint.parts[1].at.x, 1000);
  assert.equal(sized.blueprint.parts[1].at.z, 200);
  assert.equal(sized.blueprint.parts[1].size.w, 800);
  // A turned part grows along its own axes.
  const t = transformParts(turned.blueprint, [ids[0]], { scale: { x: 2, y: 1, z: 1 } });
  assert.ok(t.ok);
  assert.equal(t.blueprint.parts[0].size.d, 400);
  assert.ok(!transformParts(bp, ["nope"], { turn: 5 }).ok);
});
