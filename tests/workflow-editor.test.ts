import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import { getWorkflow } from "../src/lib/workflow";
import { publishErrors, moveEntry } from "../src/lib/workflow/editor-model";
import {
  createDraft,
  saveDraft,
  publishDraft,
  listDrafts,
  listPublishedWorkflows,
  publishedWorkflow,
  WorkflowEditError,
  getDraft,
} from "../src/lib/workflow/store";
import {
  createProject,
  getProject,
  applyMutation,
  projectDbId,
} from "../src/lib/projects/store";
import { projectMutation } from "../src/lib/projects/mutations";
import { takeBackup, restoreBackup } from "../src/lib/backup/backup";
import { emptyDesign } from "../src/lib/design/model";
import { captureSetup } from "../src/lib/templates/model";
import { saveTemplate } from "../src/lib/templates/store";
import { collectProjectArchive } from "../src/lib/export/project";
test("workflow publication reports unavailable modules, duplicates and unsafe keys; ordering preserves entries", () => {
  const base = getWorkflow("interior-design-corporate");
  assert.deepEqual(publishErrors(base).errors, []);
  const bad = structuredClone(base);
  bad.phases[0].key = "constructor";
  bad.phases[0].modules.push("model_picker");
  bad.phases[0].checklist[0].id = "__proto__";
  assert(publishErrors(bad).errors.some((e) => e.includes("unavailable")));
  assert(publishErrors(bad).errors.some((e) => e.includes("simple key")));
  assert(publishErrors(bad).errors.some((e) => e.includes("valid key")));
  assert.deepEqual(moveEntry(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
  assert.deepEqual(moveEntry(["a"], 0, -1), ["a"]);
});
test("draft revisions, scoped publication and frozen projects survive later versions, forms, templates and restore", async () => {
  const pg = new PGlite();
  try {
    await runMigrations({
      exec: (s) => pg.exec(s),
      query: (s, p) => pg.query(s, p),
    });
    const db: Db = {
      query: async (s, p) => (await pg.query(s, p)).rows as never,
    };
    const user = "auth0|workflow-owner",
      ws = await ensureWorkspace(db, {
        sub: user,
        email: "workflow@example.com",
        name: "Designer",
      }),
      other = await ensureWorkspace(db, {
        sub: "auth0|other-workflow",
        email: "otherworkflow@example.com",
        name: "Other",
      });
    let draft = await createDraft(
      db,
      ws,
      user,
      getWorkflow("interior-design-corporate"),
    );
    const custom = structuredClone(draft.definition);
    custom.name = "Practice fit-out";
    custom.forms.push({
      key: "research",
      fields: [
        { key: "goals", label: "Project goals" },
        { key: "findings", label: "Site findings" },
      ],
    });
    custom.phases[0].modules.push("structured_form:research");
    custom.labels.research = "Project research";
    draft = await saveDraft(db, ws, user, draft.id, draft.revision, custom);
    const request = {
      id: "first-project",
      name: "First",
      client: "Client",
      swatch: "sage" as const,
      startDate: "2026-10-08T00:00:00Z",
      workflowId: draft.id,
    };
    await assert.rejects(createProject(db, ws, request), /published/);
    await assert.rejects(
      saveDraft(db, ws, user, draft.id, 1, custom),
      (e) => e instanceof WorkflowEditError && e.status === 409,
    );
    const publishing = await Promise.allSettled([
      publishDraft(db, ws, user, draft.id, draft.revision),
      publishDraft(db, ws, user, draft.id, draft.revision),
    ]);
    assert.equal(publishing.filter((p) => p.status === "fulfilled").length, 1);
    draft = (await getDraft(db, ws, draft.id))!;
    assert.equal(draft.publishedVersion, 1);
    assert.equal(draft.definition.version, 2);
    const first = await createProject(db, ws, request);
    assert.equal(getWorkflow(first).name, "Practice fit-out");
    assert.equal(first.workflowDefinition!.version, 1);
    await assert.rejects(createProject(db, other, request), /published/);
    assert.deepEqual(await listDrafts(db, other), []);
    assert.equal(await publishedWorkflow(db, other, draft.id), null);
    assert(
      !(await listPublishedWorkflows(db, other)).some((w) => w.id === draft.id),
    );
    const change = structuredClone(draft.definition);
    change.name = "Practice fit-out refined";
    change.phases[0].name = "New discovery wording";
    draft = await saveDraft(db, ws, user, draft.id, draft.revision, change);
    await publishDraft(db, ws, user, draft.id, draft.revision);
    const second = await createProject(db, ws, {
      ...request,
      id: "second-project",
    });
    assert.equal(second.workflowVersion, 2);
    const pinned=await createProject(db,ws,{...request,id:"explicit-original",workflowVersion:1});
    assert.equal(pinned.workflowVersion,1);
    assert.equal(getWorkflow(pinned).name,"Practice fit-out");
    assert.equal(getWorkflow(second).phases[0].name, "New discovery wording");
    const original = (await getProject(db, ws, first.id))!;
    assert.equal(original.workflowVersion, 1);
    assert.equal(getWorkflow(original).phases[0].name, "Discovery & Brief");
    assert.equal(getWorkflow(original).name, "Practice fit-out");
    await Promise.all([
      applyMutation(db, ws, first.id, {
        type: "setFormValues",
        formKey: "research",
        patch: { goals: "More daylight" },
      }),
      applyMutation(db, ws, first.id, {
        type: "setFormValues",
        formKey: "research",
        patch: { findings: "Existing services recorded" },
      }),
    ]);
    await applyMutation(db, ws, first.id, {
      type: "setFormValues",
      formKey: "notes:space_planning",
      patch: { notes: "Site measurement decision" },
    });
    const filled = (await getProject(db, ws, first.id))!;
    assert.deepEqual(filled.formValues!.research, {
      goals: "More daylight",
      findings: "Existing services recorded",
    });
    await assert.rejects(
      applyMutation(db, ws, first.id, {
        type: "setFormValues",
        formKey: "research",
        patch: { unknown: "NO" },
      }),
      /unknown/,
    );
    await assert.rejects(
      applyMutation(db, ws, first.id, {
        type: "setFormValues",
        formKey: "brief",
        patch: { clientName: "NO" },
      }),
      /form/,
    );
    assert(
      !projectMutation.safeParse({
        type: "setFormValues",
        formKey: "research",
        patch: { goals: 4 },
      }).success,
    );
    assert.equal(await getProject(db, other, first.id), null);
    for (const step of getWorkflow(filled).phases[0].checklist.filter(
      (c) => c.essential,
    ))
      await applyMutation(db, ws, first.id, {
        type: "setCheck",
        itemId: step.id,
        done: true,
      });
    await applyMutation(db, ws, first.id, {
      type: "completePhase",
      phaseKey: filled.currentPhase,
    });
    const pid = (await projectDbId(db, ws, first.id))!;
    const [snapshot] = await db.query<{
      form_values: Record<string, Record<string, string>>;
    }>("SELECT form_values FROM project_snapshots WHERE project_id=$1", [pid]);
    assert.deepEqual(
      snapshot.form_values.research,
      filled.formValues!.research,
    );
    const template = await saveTemplate(db, ws, user, {
      name: "Practice custom setup",
      data: captureSetup(filled, emptyDesign(), []),
    });
    const templated = await createProject(db, ws, {
      ...request,
      id: "from-template",
      templateId: template.id,
    });
    assert.equal(templated.workflowVersion, 1);
    assert.equal(getWorkflow(templated).name, "Practice fit-out");
    const archive = await collectProjectArchive(db, ws, first.id);
    assert.deepEqual(
      (archive.data.project as { formValues: unknown }).formValues,
      filled.formValues,
    );
    assert.equal((archive.data.workflow as { version: number }).version, 1);
    const backup = await takeBackup(db);
    assert.equal(backup.tables.workflow_drafts.length, 1);
    assert.equal(backup.tables.workflow_versions.length, 2);
    await restoreBackup(db, backup);
    assert.equal(getWorkflow((await getProject(db, ws, first.id))!).version, 1);
    assert.deepEqual(
      (await getProject(db, ws, first.id))!.formValues,
      filled.formValues,
    );
    draft = (await getDraft(db, ws, draft.id))!;
    const invalid = structuredClone(draft.definition);
    invalid.phases[0].modules.push("model_picker");
    draft = await saveDraft(db, ws, user, draft.id, draft.revision, invalid);
    await assert.rejects(
      publishDraft(db, ws, user, draft.id, draft.revision),
      /unavailable/,
    );
    assert.equal((await publishedWorkflow(db, ws, draft.id))!.version, 2);
  } finally {
    await pg.close();
  }
});
