import { z } from "zod";
export const conceptInputSchema = z
  .object({
    requestId: z.uuid(),
    boardKey: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
    levelId: z.string().max(100).nullable(),
    referenceDocumentId: z.uuid().nullable(),
    direction: z.string().trim().min(1).max(2000),
    count: z.number().int().min(1).max(3),
  })
  .strict();
export type ConceptInput = z.infer<typeof conceptInputSchema>;
export interface ConceptResult {
  documentId: string;
  title: string;
  direction: string;
  costZar: number;
  estimatedCost: boolean;
  model: string;
  provider: string;
  alternative: number;
}
export interface ConceptGeneration {
  id: string;
  input: ConceptInput;
  results: ConceptResult[];
  status: "running" | "complete" | "partial" | "failed";
  error: string | null;
  createdAt: string;
  costZar: number;
}
export interface ConceptHistory {
  generations: ConceptGeneration[];
  estimatedZarPerImage: number | null;
  configured: boolean;
  levels: { id: string; name: string }[];
  hasPlan: boolean;
}
