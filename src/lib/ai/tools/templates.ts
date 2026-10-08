import { z } from "zod";
import { registerTool } from "./registry";
import { listTemplates } from "@/lib/templates/store";
registerTool({
  name: "read_practice_project_setups",
  module: "template_export",
  label: "Reading reusable project setups",
  description:
    "List this practice’s reusable project setup names, pinned workflows and selection/requirement counts. Help the designer choose a setup when creating a project. Does not create projects, copy client data or expose source specifications.",
  input: z.object({}).strict(),
  async run(ctx) {
    return {
      content: JSON.stringify(await listTemplates(ctx.db, ctx.run.workspaceId)),
    };
  },
});
