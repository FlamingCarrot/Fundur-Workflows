import type { FormField } from "@/lib/workflow/schema";

/**
 * The prompt that turns meeting notes into a draft of a workflow's brief form,
 * and the reading of the answer. Field names, labels and hints all come from
 * the workflow definition, so the same code drafts any workflow's brief.
 */

export interface BriefPromptInput {
  workflowName: string;
  /** What the workflow calls the form, e.g. "Design Brief". */
  formLabel: string;
  /** The workflow's description of the drafting action, when it has one. */
  actionDescription?: string;
  fields: FormField[];
  /** Values already in the brief, so the draft can stay consistent with them. */
  existing: Record<string, string>;
  /** Each source with its name: uploaded files and pasted text. */
  sources: { name: string; text: string }[];
}

/** The longest notes sent in one draft, in characters (well inside every model's context). */
export const MAX_NOTES_CHARS = 400_000;

export function briefSchema(fields: FormField[]): Record<string, unknown> {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((f) => [f.key, { type: "string" }])),
    required: fields.map((f) => f.key),
    additionalProperties: false,
  };
}

export function briefPrompt(input: BriefPromptInput): { system: string; prompt: string } {
  const fieldLines = input.fields
    .map((f) => {
      const extra = [f.hint, f.placeholder && `for example: ${f.placeholder}`].filter(Boolean).join("; ");
      return `- "${f.key}": ${f.label}${extra ? ` (${extra})` : ""}`;
    })
    .join("\n");
  const existing = input.fields
    .filter((f) => input.existing[f.key]?.trim())
    .map((f) => `- ${f.label}: ${input.existing[f.key]}`)
    .join("\n");

  const system = [
    `You draft the ${input.formLabel} for a "${input.workflowName}" project from the designer's raw meeting notes.`,
    input.actionDescription ? `Task: ${input.actionDescription}` : "",
    "The designer reviews every field before it is used, so accuracy matters more than completeness.",
    "Rules:",
    "- Use only what the notes say. Do not invent figures, names, sizes or budgets.",
    "- When the notes do not cover a field, return an empty string for it.",
    "- Keep the designer's own wording and units (for example R and m²). Write each field as short, plain text, not Markdown.",
    "- Where notes disagree, prefer the most recent or most specific statement and mention the other in a few words.",
    "Answer with a single JSON object with exactly these keys, each a string:",
    fieldLines,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    existing ? `Already in the ${input.formLabel} (for context; fill a field again only if the notes say something about it):\n${existing}\n` : "",
    ...input.sources.map((s) => `<notes source="${s.name.replace(/"/g, "'")}">\n${s.text.trim()}\n</notes>`),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, prompt };
}

/** The draft as field values, from the model's answer. Unknown keys are dropped; blanks stay blank. */
export function parseBriefDraft(text: string, fields: FormField[]): Record<string, string> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not answer with a draft");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The model's draft could not be read");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("The model did not answer with a draft");
  const obj = parsed as Record<string, unknown>;
  return Object.fromEntries(
    fields.map((f) => {
      const v = obj[f.key];
      return [f.key, typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""];
    })
  );
}
