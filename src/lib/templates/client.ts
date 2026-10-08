import { z } from "zod";
import {
  templateInput,
  seedSetup,
  type ProjectTemplate,
  templateSummary,
  type TemplateSummary,
} from "./model";
const record = templateInput.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
async function request<T>(
  method = "GET",
  body?: unknown,
  query = "",
): Promise<T> {
  const res = await fetch("/api/project-templates" + query, {
      method,
      cache: "no-store",
      ...(body
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    }),
    data = await res.json();
  if (!res.ok)
    throw new Error(data.error || "The templates could not be reached.");
  return data;
}
export function templateLibrary(server: boolean, scope: string) {
  const key = `fundur.project-templates.v1.${scope}`,
    read = () =>
      z.array(record).parse(JSON.parse(localStorage.getItem(key) ?? "[]"));
  return {
    list: async (): Promise<TemplateSummary[]> =>
      server
        ? (await request<{ templates: TemplateSummary[] }>()).templates
        : read().map(templateSummary),
    get: async (id: string): Promise<ProjectTemplate | null> =>
      server
        ? (
            await request<{ template: ProjectTemplate }>(
              "GET",
              undefined,
              "?id=" + encodeURIComponent(id),
            )
          ).template
        : (read().find((t) => t.id === id) ?? null),
    save: async (
      input: z.infer<typeof templateInput>,
    ): Promise<ProjectTemplate> => {
      const checked = templateInput.parse(input);
      seedSetup(checked.data);
      if (server)
        return (await request<{ template: ProjectTemplate }>("POST", checked))
          .template;
      const rows = read();
      if (rows.length >= 100)
        throw new Error("The practice has 100 templates.");
      const next = {
        ...checked,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem(key, JSON.stringify([...rows, next]));
      return next;
    },
    remove: async (id: string) => {
      if (server) await request("DELETE", { id });
      else
        localStorage.setItem(
          key,
          JSON.stringify(read().filter((r) => r.id !== id)),
        );
    },
  };
}
