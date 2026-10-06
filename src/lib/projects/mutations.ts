import { z } from "zod";

/**
 * Every change the app makes to a project, as the browser sends it to the
 * server. Each one names a single edit rather than carrying the whole project,
 * so two people changing different things never overwrite each other.
 */

const swatch = z.enum(["clay", "sage", "oak", "slate", "blush", "ochre"]);
const key = z.string().min(1).max(100);
const isoDate = z.string().datetime({ offset: true });

export const documentInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(0),
  phaseKey: key,
  uploadedAt: isoDate,
  clientVisible: z.boolean(),
});

export const projectMutation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setCheck"), itemId: key, done: z.boolean() }),
  z.object({ type: z.literal("setWaitingOn"), waitingOn: z.enum(["me", "client"]) }),
  // A project finishes by completing its last phase, never by setting its status.
  z.object({ type: z.literal("setStatus"), status: z.enum(["active", "on_hold"]) }),
  z.object({
    type: z.literal("updateBrief"),
    patch: z.record(key, z.string().max(20_000)),
    fromAi: z.boolean(),
  }),
  z.object({ type: z.literal("addDocuments"), documents: z.array(documentInput).min(1).max(50) }),
  z.object({ type: z.literal("setClientVisible"), documentId: z.string().uuid(), clientVisible: z.boolean() }),
  z.object({ type: z.literal("completePhase"), phaseKey: key }),
]);

export type ProjectMutation = z.infer<typeof projectMutation>;

export const newProjectInput = z.object({
  /** The slug the browser picked; the server keeps it unless the workspace already has it. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  name: z.string().trim().min(1).max(255),
  client: z.string().trim().min(1).max(255),
  workflowId: key,
  startDate: isoDate,
  swatch,
});

export type NewProjectRequest = z.infer<typeof newProjectInput>;
