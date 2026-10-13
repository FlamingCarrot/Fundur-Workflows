import { z } from "zod";
import { createAsk } from "@/lib/autopilot/store";
import { stepPhase } from "@/lib/autopilot/model";
import { getPhase } from "@/lib/workflow";
import { registerTool } from "./registry";

/**
 * The autopilot's own tools: asking the designer for what it needs (in her
 * inbox), drafting a client update for her to send, and saying when it is
 * worth looking at the project again. Only the autopilot is offered them.
 */

registerTool({
  name: "ask_user",
  module: "checklist",
  label: "Asking you",
  autopilotOnly: true,
  description:
    "Puts one question in the designer's inbox when you need something only she can give: a fact, a decision between options, a file, or her sign-off. Short title (a question), optional detail, options for a choice, and the step or phase it is for. Her answer comes back on your next run. Don't ask what the project already says, and ask each thing once.",
  input: z.object({
    kind: z.enum(["question", "choice", "file", "approval"]).describe("question: free answer; choice: pick one of options; file: she uploads something; approval: yes or no"),
    title: z.string().trim().min(3).max(200).describe("The question as she reads it, e.g. 'What is the budget for furniture?'"),
    detail: z.string().trim().max(1500).optional().describe("Why you need it, or what you will do with it"),
    options: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
    stepId: z.string().max(100).optional().describe("The workflow step it is for, by id"),
    phaseKey: z.string().max(100).optional(),
    urgent: z.boolean().optional().describe("True only when work is blocked or a date is at risk"),
  }),
  async run(ctx, input) {
    if (!ctx.autopilot || !ctx.run.projectId) return { content: "Only the autopilot asks through the inbox; in the chat, ask her directly.", isError: true };
    if (input.kind === "choice" && (input.options?.length ?? 0) < 2) return { content: "A choice needs at least two options.", isError: true };
    const phaseKey = input.phaseKey && getPhase(ctx.project, input.phaseKey) ? input.phaseKey : input.stepId ? stepPhase(ctx.project, input.stepId) : undefined;
    const ask = await createAsk(ctx.db, ctx.run.workspaceId, ctx.run.projectId, ctx.autopilot.runId, {
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      options: input.kind === "approval" ? ["Yes", "No"] : input.options,
      phaseKey: phaseKey ?? ctx.project.currentPhase,
      stepItemId: input.stepId && stepPhase(ctx.project, input.stepId) ? input.stepId : undefined,
      urgent: input.urgent,
    });
    if (!ask) return { content: "That question is already waiting for her; don't ask it again." };
    ctx.autopilot.asked++;
    return { content: `Asked. It is in her inbox; her answer comes back on a later run.` };
  },
});

registerTool({
  name: "draft_client_update",
  module: "checklist",
  label: "Drafting a client update",
  autopilotOnly: true,
  description:
    "Drafts a short update for the client (as an email she can copy and send) and puts it in her inbox for approval. Write it yourself from saved facts: what was done since the last update, what comes next, and anything you need from the client. Warm, plain, no jargon, signed off by her studio. Never promise dates or prices the project does not hold.",
  input: z.object({
    subject: z.string().trim().min(3).max(150),
    body: z.string().trim().min(20).max(4000),
    reason: z.string().trim().max(300).optional().describe("Why now, e.g. 'weekly update' or 'nudge: waiting on the floor plan for 5 days'"),
  }),
  async run(ctx, input) {
    if (!ctx.autopilot || !ctx.run.projectId) return { content: "Only the autopilot drafts client updates this way.", isError: true };
    const ask = await createAsk(ctx.db, ctx.run.workspaceId, ctx.run.projectId, ctx.autopilot.runId, {
      kind: "message",
      title: `Send to ${ctx.project.client}: ${input.subject}`,
      detail: input.reason ?? "",
      draft: `Subject: ${input.subject}\n\n${input.body}`,
      phaseKey: ctx.project.currentPhase,
    });
    if (!ask) return { content: "An update with that subject is already waiting for her." };
    ctx.autopilot.asked++;
    return { content: "Drafted. It waits in her inbox for her to check and send." };
  },
});

registerTool({
  name: "set_next_check",
  module: "checklist",
  label: "Planning the next check",
  autopilotOnly: true,
  description:
    "Says when the autopilot should look at this project again (between 1 hour and 14 days from now) and why, e.g. 'waiting on the client's floor plan'. Without it, it looks again on its usual schedule, or as soon as she answers a question.",
  input: z.object({
    inHours: z.number().min(1).max(14 * 24),
    reason: z.string().trim().min(3).max(200),
  }),
  async run(ctx, input) {
    if (!ctx.autopilot) return { content: "Only the autopilot plans its checks.", isError: true };
    ctx.autopilot.nextCheck = { at: new Date(Date.now() + input.inHours * 3_600_000), reason: input.reason };
    return { content: `I'll look again in ${input.inHours < 48 ? `${Math.round(input.inHours)} hours` : `${Math.round(input.inHours / 24)} days`}.` };
  },
});
