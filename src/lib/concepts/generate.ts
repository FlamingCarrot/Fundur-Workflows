import { randomUUID } from "node:crypto";
import { put, del } from "@vercel/blob";
import type { Db } from "@/lib/db";
import { readRoleModels } from "@/lib/ai/settings";
import {
  runImageCall,
  AiNotConfiguredError,
  type RunContext,
} from "@/lib/ai/runs";
import { readBudget, AiBudgetError } from "@/lib/ai/budget";
import { ProviderError, ProviderKeyError } from "@/lib/ai/providers";
import type { ModelChoice } from "@/lib/ai/routing";
import { projectPrefix } from "@/lib/storage/blob";
import { applyMutation } from "@/lib/projects/store";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";
import { generateImage, type ImageCompletion } from "./provider";
import { appendConcept, beginConcept, finishConcept } from "./store";
import type { ConceptInput } from "./schema";
export const ALTERNATIVES = [
  "Warm natural materials and soft daylight",
  "Refined contemporary contrast and clean lines",
  "Expressive colour, tactile finishes and layered lighting",
];
export async function imageChoices(db: Db): Promise<ModelChoice[]> {
  const roles = await readRoleModels(db);
  return (["image", "image_fallback"] as const).flatMap((role) => {
    const m = roles[role];
    return m?.provider === "openrouter" &&
      m.imageUsdPerImage &&
      m.imageUsdPerImage > 0
      ? [{ ...m, role }]
      : [];
  });
}
export function conceptPrompt(
  project: Pick<Project, "brief" | "briefAiFields">,
  direction: string,
  alternative: number,
  levelName: string,
) {
  return JSON.stringify({
    task: "Produce one interior perspective concept render, guided by the floor plan or supplied image. Retain major spatial relationships; this is a conceptual interpretation requiring designer review, never construction documentation.",
    designDirection: direction,
    alternative: ALTERNATIVES[alternative - 1],
    floor: levelName,
    brief: Object.fromEntries(
      Object.entries(project.brief).filter(
        ([key]) => !project.briefAiFields.includes(key),
      ),
    ),
  });
}
export async function generateConcepts(
  db: Db,
  ctx: RunContext,
  project: Project,
  input: ConceptInput,
  reference: string,
  source: unknown,
  deps: {
    call?: typeof generateImage;
    saveImage?: (
      bytes: Uint8Array,
      alternative: number,
    ) => Promise<{ documentId: string }>;
  } = {},
) {
  if (!ctx.projectId) throw new Error("Choose a project.");
  const choices = await imageChoices(db);
  if (!choices.length)
    throw new AiNotConfiguredError(
      "Ask the administrator to choose an image model and estimated image price in AI settings.",
    );
  const estimate =
    Math.max(...choices.map((c) => c.imageUsdPerImage! * c.zarPerUsd)) *
    input.count;
  const budget = await readBudget(db, ctx.workspaceId, ctx.projectId);
  if (
    budget.pauseAtLimit &&
    budget.budgetZar != null &&
    budget.spentZar + estimate > budget.budgetZar
  )
    throw new AiBudgetError(
      "The estimated image cost exceeds the remaining AI budget. Request fewer alternatives or raise the budget.",
    );
  if (
    !(await beginConcept(
      db,
      ctx.workspaceId,
      ctx.projectId,
      ctx.userId,
      input,
      source,
    ))
  )
    return;
  const startedAt = Date.now();
  try {
    for (let alternative = 1; alternative <= input.count; alternative++) {
      const run = await runImageCall<ImageCompletion>(
        db,
        {
          ...ctx,
          task: "concept_visual",
          taskId: input.requestId,
          attempt: alternative,
          role: "worker",
        },
        choices,
        async (choice, key) => {
          if (Date.now() - startedAt > 180_000)
            throw new Error("Generation time limit reached");
          const available = await readBudget(
            db,
            ctx.workspaceId,
            ctx.projectId!,
          );
          if (
            available.pauseAtLimit &&
            available.budgetZar != null &&
            available.spentZar + choice.imageUsdPerImage! * choice.zarPerUsd >
              available.budgetZar
          )
            throw new AiBudgetError(
              "The remaining AI budget is below this image estimate. Saved alternatives are available.",
            );
          return (deps.call ?? generateImage)(
            key,
            choice.model,
            conceptPrompt(
              project,
              input.direction,
              alternative,
              (source as { levelName?: string }).levelName ?? "Reference image",
            ),
            reference,
            choice.imageUsdPerImage!,
          );
        },
      );
      let documentId: string;
      if (deps.saveImage)
        ({ documentId } = await deps.saveImage(run.bytes, alternative));
      else {
        const phase = getWorkflow(project).phases.find((p) =>
          p.modules.includes(`canvas_board:${input.boardKey}`),
        );
        if (!phase) throw new Error("Choose a project board.");
        documentId = randomUUID();
        const path = `${projectPrefix(ctx.workspaceId, ctx.projectId)}concepts/${documentId}.png`;
        await put(path, Buffer.from(run.bytes), {
          access: "private",
          contentType: "image/png",
          addRandomSuffix: false,
        });
        try {
          await applyMutation(db, ctx.workspaceId, project.id, {
            type: "addDocuments",
            documents: [
              {
                id: documentId,
                name: `Concept ${alternative} — ${input.requestId.slice(0, 8)}.png`,
                sizeBytes: run.bytes.length,
                phaseKey: phase.key,
                uploadedAt: new Date().toISOString(),
                clientVisible: false,
                storageKey: path,
              },
            ],
          });
        } catch (e) {
          await del(path).catch(() => {});
          throw e;
        }
      }
      await appendConcept(db, ctx.workspaceId, ctx.projectId, input.requestId, {
        documentId,
        title: `Concept ${alternative}`,
        direction: ALTERNATIVES[alternative - 1],
        costZar: run.costZar,
        estimatedCost: run.estimatedCost,
        model: run.model,
        provider: run.provider,
        alternative,
      });
    }
    await finishConcept(db, ctx.workspaceId, ctx.projectId, input.requestId);
  } catch (e) {
    const error =
      e instanceof AiBudgetError
        ? e.message
        : e instanceof AiNotConfiguredError
          ? e.message
          : e instanceof ProviderKeyError
            ? "The image provider did not accept its saved key. Ask the administrator to check it."
            : e instanceof ProviderError
              ? "The image provider could not finish this request. Saved alternatives remain available."
              : "This request could not finish. Saved alternatives remain available in this history and Documents. Provider costs may already have been incurred.";
    await finishConcept(
      db,
      ctx.workspaceId,
      ctx.projectId,
      input.requestId,
      error,
    );
  }
}
