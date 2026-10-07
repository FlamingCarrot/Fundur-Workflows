import { z } from "zod";

/**
 * View settings are small: which tab, filter, sort or zoom a screen was left
 * on. The limits keep a misbehaving page from filling the table.
 */

export const MAX_SETTINGS_PER_PERSON = 500;
export const MAX_VALUE_BYTES = 4_000;

export const settingKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.:-]+$/, "A setting name has letters, digits and . : - _ only");

export const settingsInput = z.object({
  settings: z
    .record(settingKey, z.unknown())
    .refine((s) => Object.keys(s).length <= 50, "Save at most 50 settings at once")
    .refine(
      (s) => Object.values(s).every((v) => v !== undefined && JSON.stringify(v).length <= MAX_VALUE_BYTES),
      "A setting is too large"
    ),
});

export type ViewSettings = Record<string, unknown>;
