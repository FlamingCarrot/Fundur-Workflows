import { z } from "zod";
import { BRIEF_DRAFT_TASK } from "@/lib/projects/store";
import { getForm, getWorkflow, label, phaseWithForm } from "@/lib/workflow";
import { briefPrompt, briefSchema, MAX_NOTES_CHARS, parseBriefDraft } from "../brief";
import { runReviewed } from "../review";
import { registerTaskType } from "../routing";
import { readDocumentText } from "./documents";
import { registerTool } from "./registry";

/**
 * The brief as the assistant reads it, and brief drafting (P1-13) as a tool:
 * it drafts from notes or stored documents and proposes the filled fields,
 * which she confirms like the draft screen's "use these".
 */

registerTaskType({
  key: BRIEF_DRAFT_TASK,
  label: "Drafting the brief",
  description: "Filling the brief's fields from meeting notes.",
  defaultTier: "top",
});

registerTool({
  name: "read_brief",
  module: "structured_form",
  label: "Reading the brief",
  description: "Reads the project's brief: every field with its current value, and which fields still hold an unreviewed AI draft.",
  input: z.object({}),
  async run(ctx) {
    const fields = getForm(ctx.project, "brief")?.fields ?? [];
    if (!fields.length) return { content: "This workflow has no brief." };
    const name = label(ctx.project, "brief", "Brief");
    return {
      content: [
        `${name}:`,
        ...fields.map((f) => {
          const value = ctx.project.brief[f.key]?.trim();
          const draft = ctx.project.briefAiFields.includes(f.key) ? " (AI draft, not yet reviewed)" : "";
          return `- ${f.label} [${f.key}]: ${value ? value + draft : "(empty)"}`;
        }),
      ].join("\n"),
    };
  },
});

registerTool({
  name: "draft_brief",
  module: "structured_form",
  label: "Drafting the brief",
  taskType: BRIEF_DRAFT_TASK,
  description:
    "Drafts the brief's fields from meeting notes: pasted text, stored project documents (by id from read_project), or both. Proposes the filled fields; the designer confirms before the brief changes.",
  input: z.object({
    notes: z.string().max(MAX_NOTES_CHARS).optional().describe("Notes text, when the designer pasted or typed them"),
    documentIds: z.array(z.string().uuid()).max(10).optional(),
  }),
  async run(ctx, input) {
    const fields = getForm(ctx.project, "brief")?.fields ?? [];
    if (!fields.length) return { content: "This workflow has no brief." };
    const sources: { name: string; text: string }[] = [];
    for (const id of input.documentIds ?? []) {
      const doc = ctx.project.documents.find((d) => d.id === id);
      if (!doc) return { content: `There is no document with id ${id}.` };
      const text = await readDocumentText(ctx, doc);
      if (text.error !== undefined) return { content: text.error };
      sources.push({ name: doc.name, text: text.text });
    }
    if (input.notes?.trim()) sources.push({ name: "Notes from the chat", text: input.notes.trim() });
    if (!sources.length) return { content: "Give me notes or a document to draft from." };
    const action = phaseWithForm(ctx.project, "brief")?.ai_actions.find((a) => a.outputType === "structured_brief");
    const req = briefPrompt({
      workflowName: getWorkflow(ctx.project).name,
      formLabel: label(ctx.project, "brief", "Brief"),
      actionDescription: action?.description,
      fields,
      existing: ctx.project.brief,
      sources,
    });
    const result = await runReviewed(
      ctx.db,
      { ...ctx.run, task: BRIEF_DRAFT_TASK, phaseKey: phaseWithForm(ctx.project, "brief")?.key ?? ctx.run.phaseKey },
      { ...req, schema: briefSchema(fields), maxTokens: 16_000 },
      ctx.fetchImpl
    );
    let draft: Record<string, string>;
    try {
      draft = parseBriefDraft(result.text, fields);
    } catch (err) {
      return { content: (err as Error).message };
    }
    const patch = Object.fromEntries(
      Object.entries(draft).filter(([k, v]) => v && v !== (ctx.project.brief[k] ?? "").trim())
    );
    const filled = fields.filter((f) => patch[f.key]);
    if (!filled.length) return { content: "The notes did not add anything new to the brief." };
    return {
      content: `Drafted ${filled.length} field(s): ${filled.map((f) => `${f.label}: ${patch[f.key]}`).join("; ")}. The designer will review them.`,
      proposals: [
        {
          summary: `Fill ${filled.length} brief field${filled.length === 1 ? "" : "s"}: ${filled.map((f) => f.label).join(", ")}`,
          mutation: { type: "updateBrief", patch, fromAi: true },
        },
      ],
      ...(result.passed ? {} : { flag: `The brief draft did not pass review: ${result.feedback ?? "no reason given"}` }),
    };
  },
});
