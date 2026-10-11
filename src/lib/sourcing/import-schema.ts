import { z } from "zod";
export const IMPORT_FIELDS = [
  "name",
  "dimensions",
  "specification",
  "supplier",
  "unitPriceCents",
] as const;
export const importField = z.enum(IMPORT_FIELDS);
export const publicLink = z
  .string()
  .max(2000)
  .url()
  .refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443")
    );
  }, "Use a public HTTPS product link without a login");
export const supplierEvidenceSchema = z
  .object({
    field: importField,
    value: z.string().max(5000),
    sourceUrl: publicLink,
    fetchedAt: z.iso.datetime(),
    selector: z.string().max(200),
    excerpt: z.string().max(5000),
  })
  .strict();
export const productFieldSchema = z
  .object({
    field: importField,
    value: z.union([
      z.string().max(5000),
      z.number().int().nonnegative().max(1_000_000_000_000),
    ]),
    selector: z.string().max(200),
    excerpt: z.string().max(5000),
  })
  .strict();
export const productImportSchema = z
  .object({
    sourceUrl: publicLink,
    fetchedAt: z.iso.datetime(),
    products: z
      .array(
        z
          .object({
            key: z.string().max(100),
            label: z.string().max(250),
            fields: z.array(productFieldSchema).max(5),
          })
          .strict(),
      )
      .max(20),
    warnings: z.array(z.string().max(500)).max(25),
  })
  .strict();
export type ProductImport = z.infer<typeof productImportSchema>;
export type ImportField = z.infer<typeof importField>;
export type SupplierEvidence = z.infer<typeof supplierEvidenceSchema>;
