import { z } from "zod";
export const flagSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    category: z.enum(["fire_egress", "accessibility", "other"]),
    notes: z.string().trim().min(1).max(3_000),
  })
  .strict();
export const precheckSchema = z
  .object({ flags: z.array(flagSchema).max(30) })
  .strict();
export type RegulationFlag = z.infer<typeof flagSchema>;
export interface PrecheckResult {
  flags: RegulationFlag[];
  costZar: number;
  model: string;
  reviewNote?: string;
}
