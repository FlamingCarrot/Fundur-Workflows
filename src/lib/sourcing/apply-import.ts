import type { DesignItem } from "@/lib/design/schema";
import { designItemSchema } from "@/lib/design/schema";
import {
  productImportSchema,
  type ProductImport,
  type ImportField,
} from "./import-schema";
export function applySupplierImport(
  item: DesignItem,
  raw: ProductImport,
  productKey: string,
  chosen: ImportField[],
): DesignItem {
  const imported = productImportSchema.parse(raw),
    product = imported.products.find((p) => p.key === productKey);
  if (!product) throw new Error("Choose a product from this page.");
  if (!chosen.length) throw new Error("Choose at least one field to apply.");
  const fields = product.fields.filter((f) => chosen.includes(f.field));
  if (fields.length !== new Set(chosen).size)
    throw new Error("Choose only fields found for this product.");
  const patch = Object.fromEntries(fields.map((f) => [f.field, f.value])),
    evidence = fields.map((f) => ({
      field: f.field,
      value: String(f.value),
      sourceUrl: imported.sourceUrl,
      fetchedAt: imported.fetchedAt,
      selector: f.selector,
      excerpt: f.excerpt,
    }));
  return designItemSchema.parse({
    ...item,
    ...patch,
    supplierUrl: imported.sourceUrl,
    supplierEvidence: [
      ...(item.supplierEvidence ?? []).filter((e) => !chosen.includes(e.field)),
      ...evidence,
    ],
  });
}
export function currentSupplierEvidence(item: DesignItem) {
  return (item.supplierEvidence ?? []).filter(
    (e) => String(item[e.field]) === e.value,
  );
}
