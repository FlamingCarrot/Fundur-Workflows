import { z } from "zod";
import { runReviewed } from "../review";
import { registerTaskType } from "../routing";
import { registerTool } from "./registry";

/**
 * Routine text work: tidying rough notes into a clean list, table or
 * paragraph. It is the kind of task the worker model does (P4-13), and its
 * output goes through the review gate before the assistant uses it (P4-14).
 */

registerTaskType({
  key: "formatting",
  label: "Formatting text",
  description: "Turning rough text into a clean list, table, paragraph or email.",
  defaultTier: "worker",
});

registerTool({
  name: "format_text",
  module: "ai_chat",
  label: "Formatting",
  taskType: "formatting",
  description:
    "Hands routine formatting to a cheaper model: turns rough text into a tidy bullet list, a table, a short paragraph or an email, keeping every fact. Use it for longer pieces instead of formatting them yourself.",
  input: z.object({
    text: z.string().min(1).max(40_000),
    format: z.enum(["bullet list", "numbered list", "table", "paragraph", "email"]),
    instructions: z.string().max(1_000).optional(),
  }),
  async run(ctx, input) {
    const result = await runReviewed(
      ctx.db,
      { ...ctx.run, task: "formatting" },
      {
        system: [
          `Rewrite the text as a ${input.format}${input.format === "table" ? " in Markdown" : ""}.`,
          "Keep every fact, figure, name and unit exactly; add nothing; drop only repetition. Answer with the result alone.",
          input.instructions ? `Also: ${input.instructions}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        prompt: input.text,
        maxTokens: 4_000,
      },
      ctx.fetchImpl
    );
    if (result.passed) return { content: result.text };
    return {
      content: `${result.text}\n\n(This did not pass review after ${result.attempts} tries: ${result.feedback})`,
      flag: `Formatting did not pass review after ${result.attempts} tries: ${result.feedback ?? "no reason given"}`,
    };
  },
});
