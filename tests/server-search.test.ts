import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import {
  createProject,
  applyMutation,
  projectDbId,
  getProject,
} from "../src/lib/projects/store";
import { searchSavedWork, searchTerms } from "../src/lib/studio/server-search";
import { flatten, search } from "../src/lib/studio/search";
import { getWorkflow } from "../src/lib/workflow";
import {
  createDraft,
  saveDraft,
  publishDraft,
} from "../src/lib/workflow/store";
const request = {
  id: "acoustic-office",
  name: "Acoustic Office",
  client: "Sample Practice",
  workflowId: "interior-design-corporate",
  startDate: "2026-10-08T00:00:00Z",
  swatch: "sage" as const,
};
test("saved search matches word prefixes, inflections, form notes, documents and checklist/manual tasks, scoped to assigned projects", async () => {
  const pg = new PGlite();
  try {
    await runMigrations({
      exec: (s) => pg.exec(s),
      query: (s, p) => pg.query(s, p),
    });
    const db: Db = {
        query: async (s, p) => (await pg.query(s, p)).rows as never,
      },
      user = "auth0|search-owner",
      ws = await ensureWorkspace(db, { sub: user }),
      other = await ensureWorkspace(db, { sub: "auth0|search-other" });
    await createProject(db, ws, request);
    await createProject(db, other, request);
    await createProject(db, ws, {
      ...request,
      id: "unassigned-office",
      name: "Acoustic Unassigned",
    });
    const id = (await projectDbId(db, ws, request.id))!;
    await applyMutation(db, ws, request.id, {
      type: "updateBrief",
      patch: {
        spaceRequirements: "Soft acoustic flooring and calm meeting rooms",
      },
      fromAi: false,
    });
    await applyMutation(db, ws, request.id, {
      type: "setFormValues",
      formKey: "notes:space_planning",
      patch: { notes: "Daylight studies confirm glazed partitions" },
    });
    await applyMutation(db, other, request.id, {
      type: "setFormValues",
      formKey: "notes:space_planning",
      patch: { notes: "Confidential foreign phrase" },
    });
    await applyMutation(db, ws, request.id, {
      type: "addTask",
      id: "52cbb2ee-cd02-4974-8f34-4d2bcf33fd72",
      phaseKey: "discovery",
      title: "Arrange acoustic survey",
    });
    await applyMutation(db, ws, request.id, {
      type: "addDocuments",
      documents: [
        {
          id: "510c46fd-9f4c-41ba-8d47-1e0d8aaf3b76",
          name: "Acoustic specification.pdf",
          sizeBytes: 10,
          phaseKey: "discovery",
          uploadedAt: new Date().toISOString(),
          clientVisible: false,
        },
      ],
    });
    const ctx = {
      workspaceId: ws,
      userId: user,
      workspaceRole: "owner" as const,
    };
    const prefix = flatten(await searchSavedWork(db, ctx, "acous"));
    assert(prefix.some((r) => r.kind === "project"));
    assert(prefix.some((r) => r.kind === "document"));
    assert(prefix.some((r) => r.kind === "task"));
    assert(prefix.some((r) => r.kind === "brief"));
    assert(prefix.every((r) => r.projectId !== "" && r.context.length));
    const inflected = flatten(await searchSavedWork(db, ctx, "floor"));
    assert(
      inflected.some(
        (r) => r.kind === "brief" && r.context.includes("flooring"),
      ),
    );
    const notes = flatten(await searchSavedWork(db, ctx, "daylight"));
    assert.equal(notes.length, 1);
    assert.equal(notes[0].kind, "form");
    assert.equal(
      notes[0].href,
      "/projects/acoustic-office/forms/notes%3Aspace_planning",
    );
    assert.match(notes[0].title, /Working notes/);
    const steps = flatten(await searchSavedWork(db, ctx, "brief"));
    assert(steps.some((r) => r.kind === "task"));
    const regulation = flatten(await searchSavedWork(db, ctx, "egress"));
    assert(regulation.some((r) => r.kind === "task"));
    assert.deepEqual(await searchSavedWork(db, ctx, "foreign"), []);
    assert.deepEqual(
      await searchSavedWork(
        db,
        { ...ctx, workspaceRole: "collaborator", userId: "auth0|assigned" },
        "acoustic",
      ),
      [],
    );
    await db.query("INSERT INTO users(id,name,email) VALUES($1,$2,$3)", [
      "auth0|assigned",
      "Assigned",
      "assigned@example.com",
    ]);
    await db.query(
      "INSERT INTO project_members(workspace_id,project_id,user_id) VALUES($1,$2,$3)",
      [ws, id, "auth0|assigned"],
    );
    const assigned = flatten(
      await searchSavedWork(
        db,
        { ...ctx, workspaceRole: "collaborator", userId: "auth0|assigned" },
        "acoustic",
      ),
    );
    assert(assigned.length);
    assert(assigned.every((r) => r.projectId === request.id));
    assert.deepEqual(
      await searchSavedWork(
        db,
        { ...ctx, workspaceRole: "client" },
        "acoustic",
      ),
      [],
    );
    assert.deepEqual(await searchSavedWork(db, ctx, "%_"), []);
    assert.deepEqual(await searchSavedWork(db, ctx, "' OR 1=1; --"), []);
    assert.deepEqual(await searchSavedWork(db, ctx, "a"), []);
    assert.equal(searchTerms("soft floor"), "'soft':* & 'floor':*");
    const local = flatten(
      search([(await getProject(db, ws, request.id))!], "daylight"),
    );
    assert.equal(local[0].href, notes[0].href);
    await db.query(
      "UPDATE projects SET workflow_definition=NULL WHERE workspace_id=$1 AND id=$2",
      [ws, id],
    );
    assert(
      flatten(await searchSavedWork(db, ctx, "brief")).some(
        (r) => r.kind === "task" && r.projectId === request.id,
      ),
    );
    const draft = await createDraft(
      db,
      ws,
      user,
      getWorkflow(request.workflowId),
    );
    const custom = structuredClone(draft.definition);
    custom.forms.push({
      key: "research",
      fields: [{ key: "findings", label: "Site findings" }],
    });
    custom.labels.research = "Site research";
    custom.phases[0].modules.push("structured_form:research");
    const saved = await saveDraft(
      db,
      ws,
      user,
      draft.id,
      draft.revision,
      custom,
    );
    await publishDraft(db, ws, user, saved.id, saved.revision);
    const tailored = await createProject(db, ws, {
      ...request,
      id: "practice-research",
      workflowId: saved.id,
    });
    await applyMutation(db, ws, tailored.id, {
      type: "setFormValues",
      formKey: "research",
      patch: { findings: "North glazing survey confirmed shaded panels" },
    });
    const forms = flatten(await searchSavedWork(db, ctx, "glaz survey"));
    assert.equal(forms.length, 1);
    assert.equal(forms[0].title, "Site findings · Site research");
    assert.equal(forms[0].href, "/projects/practice-research/forms/research");
  } finally {
    await pg.close();
  }
});
