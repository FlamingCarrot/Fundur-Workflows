import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/lib/db";
import { runMigrations } from "../src/lib/db/migrator";
import { ensureWorkspace } from "../src/lib/auth/workspace";
import {
  createProject,
  applyMutation,
  getProject,
  projectDbId,
  MutationError,
} from "../src/lib/projects/store";
import { newProject, completePhase } from "../src/lib/studio/transitions";
import { phaseProgress } from "../src/lib/studio/selectors";
import { projectTasks } from "../src/lib/studio/tasks";
import {
  projectRegulations,
  starterRegulations,
} from "../src/lib/regulations/model";
import { projectMutation } from "../src/lib/projects/mutations";
import {
  precheckFacts,
  draftRegulationFlags,
} from "../src/lib/regulations/precheck";
import { precheckSchema } from "../src/lib/regulations/precheck-schema";
import { emptyDesign, newItem } from "../src/lib/design/model";
import { samplePlan } from "../src/lib/plan/geometry";
import { saveProviderKey, saveRoleModel } from "../src/lib/ai/settings";
import { saveTaskRoute } from "../src/lib/ai/routing";
import { projectAiCosts } from "../src/lib/ai/costs";
import { enabledTools, runTool } from "../src/lib/ai/tools";
import { features } from "../src/lib/workspaces/store";
import {
  takeBackup,
  restoreBackup,
  checkRestore,
} from "../src/lib/backup/backup";
const input = {
  id: "regulated-office",
  name: "Office",
  client: "Client",
  workflowId: "interior-design-corporate",
  swatch: "sage" as const,
  startDate: "2026-10-08T00:00:00.000Z",
};
process.env.AUTH0_SECRET = "regulation-test-secret-key-derivation-0123456789";
const regulation = {
  title: "Verify clear escape route",
  category: "fire_egress" as const,
  notes: "Ask the fire consultant to review the drawing.",
};
function dbFor(pg: PGlite): Db {
  return { query: async (s, p) => (await pg.query(s, p)).rows as never };
}
async function migrate(pg: PGlite) {
  return runMigrations({
    exec: (s) => pg.exec(s),
    query: (s, p) => pg.query<Record<string, unknown>>(s, p),
  });
}

test("designer requirements join essential phase steps and tasks; legacy completed phases stay historical", () => {
  const p = {
    ...newProject(input),
    currentPhase: "documentation",
    checks: { "doc-01": true, "doc-02": true },
  };
  assert.equal(phaseProgress(p, "documentation").essentialTotal, 4);
  assert.equal(phaseProgress(p, "documentation").ready, false);
  assert.equal(completePhase(p, "documentation"), p);
  assert.equal(
    projectTasks(p).filter((t) => t.id.startsWith("reg-")).length,
    2,
  );
  const checked = {
    ...p,
    checks: { ...p.checks, "reg-fire-egress": true, "reg-accessibility": true },
  };
  assert.equal(
    completePhase(checked, "documentation").currentPhase,
    "sourcing",
  );
  const legacy = {
    ...p,
    regulations: undefined,
    completedPhases: ["documentation"],
  };
  assert.deepEqual(projectRegulations(legacy), {});
  assert.deepEqual(
    projectRegulations({ ...legacy, completedPhases: [] }),
    starterRegulations(),
  );
  assert.equal(
    projectMutation.safeParse({
      type: "setRegulation",
      itemId: "__proto__",
      regulation,
    }).success,
    false,
  );
  assert.equal(
    precheckSchema.safeParse({ flags: [{ ...regulation, done: true }] })
      .success,
    false,
    "AI cannot return verification state",
  );
});

test("pre-check facts are bounded, omit private procurement and underlays, and expose missing evidence honestly", () => {
  const p = newProject(input),
    plan = samplePlan(),
    data = emptyDesign();
  p.brief.special = "X".repeat(20_000);
  data.items = [
    {
      ...newItem(crypto.randomUUID()),
      name: "Chair",
      supplier: "SECRET SUPPLIER",
      notes: "SECRET SNAG",
      unitPriceCents: 987654,
      dimensions: "Not supplied",
    },
  ];
  plan.notes.push({
    id: "private",
    levelId: plan.levels[0].id,
    at: { x: 0, y: 0 },
    text: "SECRET PLAN NOTE",
  });
  const facts = precheckFacts(p, data, plan),
    text = JSON.stringify(facts);
  assert.equal(facts.brief.special.length, 1000);
  assert.equal(text.includes("SECRET"), false);
  assert.equal(text.includes("987654"), false);
  assert.match(facts.drawing!.limitation, /have not been calculated/);
  assert.equal(precheckFacts(p, data, null).drawing, null);
});

test("regulation persistence, completion races, model review, costs and backup restore", async (t) => {
  const pg = new PGlite();
  await migrate(pg);
  const db = dbFor(pg);
  try {
    const ws = await ensureWorkspace(db, {
      sub: "designer",
      email: "designer@example.com",
    });
    const other = await ensureWorkspace(db, {
      sub: "other",
      email: "other@example.com",
    });
    let project = await createProject(db, ws, input);
    const pid = (await projectDbId(db, ws, input.id))!;
    await createProject(db, other, input);
    await t.test(
      "new requirements are scoped and changed requirements must be reviewed again",
      async () => {
        assert.deepEqual(project.regulations, starterRegulations());
        const changed = await applyMutation(db, ws, input.id, {
          type: "setRegulation",
          itemId: "reg-custom",
          regulation,
        });
        assert.equal(
          changed!.regulations!["reg-custom"].title,
          regulation.title,
        );
        assert.equal(
          (await getProject(db, other, input.id))!.regulations!["reg-custom"],
          undefined,
        );
        await applyMutation(db, ws, input.id, {
          type: "setCheck",
          itemId: "reg-custom",
          done: true,
          expectedRegulation: regulation,
        });
        await applyMutation(db, ws, input.id, {
          type: "setRegulation",
          itemId: "reg-custom",
          regulation: {
            ...regulation,
            notes: "A different drawing requires review",
          },
        });
        assert.equal(
          !!(await getProject(db, ws, input.id))!.checks["reg-custom"],
          false,
        );
        await assert.rejects(
          applyMutation(db, ws, input.id, {
            type: "setCheck",
            itemId: "reg-custom",
            done: true,
            expectedRegulation: regulation,
          }),
          MutationError,
        );
        await applyMutation(db, ws, input.id, {
          type: "deleteRegulation",
          itemId: "reg-custom",
        });
        await applyMutation(db, ws, input.id, {
          type: "deleteRegulation",
          itemId: "reg-fire-egress",
        });
        await assert.rejects(
          applyMutation(db, ws, input.id, {
            type: "deleteRegulation",
            itemId: "reg-accessibility",
          }),
          /at least one/,
        );
        await applyMutation(db, ws, input.id, {
          type: "setRegulation",
          itemId: "reg-fire-egress",
          regulation: starterRegulations()["reg-fire-egress"],
        });
      },
    );
    await t.test(
      "completion refuses open checks and a requirement added between read and write",
      async () => {
        await db.query(
          "UPDATE projects SET current_phase_key='documentation',completed_phases=ARRAY['discovery','space_planning','concept'],checks=checks||'{\"doc-01\":true,\"doc-02\":true}'::jsonb WHERE id=$1",
          [pid],
        );
        assert.equal(
          (await applyMutation(db, ws, input.id, {
            type: "completePhase",
            phaseKey: "documentation",
          }))!.currentPhase,
          "documentation",
        );
        project = (await getProject(db, ws, input.id))!;
        for (const [itemId, expectedRegulation] of Object.entries(
          project.regulations!,
        ))
          await applyMutation(db, ws, input.id, {
            type: "setCheck",
            itemId,
            done: true,
            expectedRegulation,
          });
        let injected = false;
        const race: Db = {
          query: async (s, p) => {
            if (s.includes("SET completed_phases") && !injected) {
              injected = true;
              await applyMutation(db, ws, input.id, {
                type: "setRegulation",
                itemId: "reg-racing",
                regulation,
              });
            }
            return db.query(s, p);
          },
        };
        assert.equal(
          (await applyMutation(race, ws, input.id, {
            type: "completePhase",
            phaseKey: "documentation",
          }))!.currentPhase,
          "documentation",
        );
        await applyMutation(db, ws, input.id, {
          type: "setCheck",
          itemId: "reg-racing",
          done: true,
          expectedRegulation: regulation,
        });
        assert.equal(
          (await applyMutation(db, ws, input.id, {
            type: "completePhase",
            phaseKey: "documentation",
          }))!.currentPhase,
          "sourcing",
        );
        const snapshots = await db.query<{
          regulations: unknown;
          checks: Record<string, boolean>;
        }>(
          "SELECT regulations,checks FROM project_snapshots WHERE project_id=$1 AND phase_key='documentation'",
          [pid],
        );
        assert.equal(snapshots.length, 1);
        assert.equal(snapshots[0].checks["reg-racing"], true);
        assert.deepEqual(
          snapshots[0].regulations,
          (await getProject(db, ws, input.id))!.regulations,
        );
        await assert.rejects(
          applyMutation(db, ws, input.id, {
            type: "setRegulation",
            itemId: "reg-racing",
            regulation,
          }),
          /already complete/,
        );
      },
    );
    await t.test(
      "reviewed AI flags are costed, never apply themselves, and are feature gated",
      async () => {
        await saveProviderKey(
          db,
          "openrouter",
          "sk-regulation-test-key-1234",
          "designer",
        );
        const pick = {
          provider: "openrouter" as const,
          model: "worker",
          inputUsdPerMTok: 1,
          outputUsdPerMTok: 2,
          zarPerUsd: 18,
        };
        await saveRoleModel(db, "worker", pick, "designer");
        await saveRoleModel(
          db,
          "orchestrator",
          { ...pick, model: "reviewer" },
          "designer",
        );
        await saveTaskRoute(db, "regulation_precheck", "worker", 0, "designer");
        const before = (await getProject(db, ws, input.id))!,
          ctx = {
            workspaceId: ws,
            projectId: pid,
            userId: "designer",
            phaseKey: "documentation",
          };
        let passed = true,
          invalid = false;
        const calls: string[] = [];
        const mock = (async (_url: RequestInfo | URL, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body));
          calls.push(body.model);
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      body.model === "worker"
                        ? JSON.stringify({
                            flags: [
                              {
                                ...regulation,
                                ...(invalid ? { done: true } : {}),
                              },
                            ],
                          })
                        : JSON.stringify({
                            pass: passed,
                            feedback: passed ? "" : "Ask for evidence",
                          }),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1000, completion_tokens: 100 },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }) as typeof fetch;
        const result = await draftRegulationFlags(
          db,
          ctx,
          before,
          emptyDesign(),
          null,
          mock,
        );
        assert.deepEqual(result.flags, [regulation]);
        assert.deepEqual(calls, ["worker", "reviewer"]);
        assert.ok(result.costZar > 0);
        assert.deepEqual(
          (await getProject(db, ws, input.id))!.checks,
          before.checks,
        );
        const costs = await projectAiCosts(db, ws, pid, {
          phase: (k) => k,
          task: (k) => k,
        });
        assert.equal(costs.calls, 2);
        assert.equal(costs.byTaskType[0].key, "regulation_precheck");
        passed = false;
        assert.match(
          (
            await draftRegulationFlags(
              db,
              ctx,
              before,
              emptyDesign(),
              null,
              mock,
            )
          ).reviewNote!,
          /did not pass/,
        );
        invalid = true;
        await assert.rejects(
          draftRegulationFlags(db, ctx, before, emptyDesign(), null, mock),
          /invalid flag/,
        );
        const disabled = {
          ...(await features(db, ws, "designer")),
          design: false,
        };
        assert.equal(
          enabledTools(disabled).some(
            (tool) => tool.name === "precheck_regulations",
          ),
          false,
        );
        const denied = await runTool(
          {
            db,
            run: ctx,
            project: before,
            readFile: async () => null,
            features: disabled,
            fetchImpl: mock,
          },
          "precheck_regulations",
          {},
        );
        assert.equal(denied.isError, true);
      },
    );
    await t.test(
      "backup restore retains project requirements and phase verification snapshots",
      async () => {
        const backup = await takeBackup(db),
          targetPg = new PGlite();
        try {
          await migrate(targetPg);
          const target = dbFor(targetPg);
          await restoreBackup(target, backup);
          assert.deepEqual(await checkRestore(target, backup), []);
          assert.deepEqual(
            (await getProject(target, ws, input.id))!.regulations,
            (await getProject(db, ws, input.id))!.regulations,
          );
        } finally {
          await targetPg.close();
        }
      },
    );
  } finally {
    await pg.close();
  }
});
