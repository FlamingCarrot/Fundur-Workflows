import { z } from "zod";

/**
 * Smart chat items: the things a reply can hand her besides words, each one a
 * typed card the chat draws and she can act on. A link to open, an image, a
 * project file or PDF to preview, a document that opens in the canvas to edit,
 * export or file, and a research report with its sources. Safe to import in
 * the browser.
 */

const httpsUrl = z
  .string()
  .max(2_000)
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use a full https:// address");

export const webSource = z.object({ url: z.string().max(2_000), title: z.string().max(300) });

export const chatCard = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: httpsUrl, title: z.string().min(1).max(200), description: z.string().max(500).optional() }),
  z.object({
    kind: z.literal("image"),
    /** An https image, or a project file's address in the app. */
    url: z.string().max(2_000),
    caption: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal("file"),
    name: z.string().max(255),
    /** Where the app serves it (a project document's download). */
    url: z.string().max(2_000),
    contentType: z.string().max(120).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal("document"), id: z.string().uuid(), title: z.string().max(200), preview: z.string().max(600) }),
  z.object({
    kind: z.literal("research"),
    id: z.string().uuid(),
    title: z.string().max(200),
    summary: z.string().max(1_200),
    sources: z.array(webSource).max(30),
    /** False when no web search was available and the report comes from the model's own knowledge. */
    web: z.boolean(),
  }),
]);

export type ChatCard = z.infer<typeof chatCard>;
export type WebSourceItem = z.infer<typeof webSource>;

/** A project file's address in the app; `inline` shows images and PDFs rather than downloading them. */
export const projectFileUrl = (projectSlug: string, documentId: string, inline = false) =>
  `/api/projects/${encodeURIComponent(projectSlug)}/documents/${encodeURIComponent(documentId)}/file${inline ? "?inline=1" : ""}`;

/** Whether an image address may be shown: https, or one of the app's own project files. */
export const safeImageUrl = (url: string) => /^https:\/\//.test(url) || /^\/api\/projects\/[^/]+\/documents\/[0-9a-f-]{36}\/file(\?inline=1)?$/i.test(url);
