import { z } from "zod";
import { regulationId, regulationSchema } from "@/lib/regulations/model";

/**
 * Every change the app makes to a project, as the browser sends it to the
 * server. Each one names a single edit rather than carrying the whole project,
 * so two people changing different things never overwrite each other.
 */

const swatch = z.enum(["clay", "sage", "oak", "slate", "blush", "ochre"]);
const key = z.string().min(1).max(100);
const isoDate = z.string().datetime({ offset: true });
const storageKey = z.string().min(1).max(600);
/** A day, as YYYY-MM-DD: a task is due on a day, not at a time. */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const documentInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(0),
  phaseKey: key,
  uploadedAt: isoDate,
  clientVisible: z.boolean(),
  /** Where the file was uploaded in object storage; absent when only the name is recorded. */
  storageKey: storageKey.optional(),
  /** What kind of document it is, when the assistant filed it. */
  kind: z.string().min(1).max(100).optional(),
});

export const projectMutation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setCheck"), itemId: key, done: z.boolean(), expectedRegulation: regulationSchema.optional() }),
  z.object({ type: z.literal("setRegulation"), itemId: regulationId, regulation: regulationSchema }),
  z.object({ type: z.literal("deleteRegulation"), itemId: regulationId }),
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
  // A new upload of an existing document becomes its next version.
  z.object({
    type: z.literal("replaceDocumentFile"),
    documentId: z.string().uuid(),
    storageKey,
    name: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(0),
  }),
  z.object({ type: z.literal("restoreDocumentVersion"), documentId: z.string().uuid(), version: z.number().int().min(1) }),
  z.object({ type: z.literal("restoreBrief"), snapshotId: z.string().uuid() }),
  // Tasks: a step's date or output, and tasks of their own.
  z.object({
    type: z.literal("addTask"),
    id: z.string().uuid(),
    phaseKey: key,
    title: z.string().trim().min(1).max(500),
    due: day.optional(),
  }),
  z.object({
    type: z.literal("updateTask"),
    taskId: z.string().uuid(),
    title: z.string().trim().min(1).max(500).optional(),
    // null clears the date; leaving it out keeps it.
    due: day.nullable().optional(),
    done: z.boolean().optional(),
    outputDocumentId: z.string().uuid().nullable().optional(),
  }),
  z.object({ type: z.literal("deleteTask"), taskId: z.string().uuid() }),
  // A phase moved on the timeline; null puts it back on the workflow's own plan.
  z.object({ type: z.literal("setPhaseStart"), phaseKey: key, start: day.nullable() }),
  // A workflow step: its date moved, or the document it produced.
  z.object({
    type: z.literal("setStepDue"),
    itemId: key,
    due: day.nullable(),
  }),
  z.object({
    type: z.literal("setStepOutput"),
    itemId: key,
    documentId: z.string().uuid().nullable(),
  }),
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
