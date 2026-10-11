import type { DesignData, DesignItem, BoardCard } from "./schema";

export const STATUS_LABELS = {
  needs_sourcing: "Needs sourcing",
  quote_requested: "Quote requested",
  ordered: "Ordered",
  delivered: "Delivered",
};
export const emptyDesign = (): DesignData => ({
  version: 1,
  boards: [],
  items: [],
  currency: "ZAR",
  budgetCents: null,
  installOrder: [],
});
export function newItem(id: string): DesignItem {
  return {
    id,
    name: "",
    category: "",
    tags: [],
    documentId: null,
    sourceCardId: null,
    specification: "",
    dimensions: "",
    quantity: 1,
    unitPriceCents: null,
    status: "needs_sourcing",
    supplier: "",
    supplierUrl: null,
    deliveryDate: null,
    installDone: false,
    notes: "",
    snagDocumentIds: [],
  };
}
export function itemFromCard(card: BoardCard, id: string): DesignItem {
  return {
    ...newItem(id),
    name: card.title.trim() || "Untitled selection",
    tags: card.tags,
    documentId: card.documentId,
    sourceCardId: card.id,
    specification: card.body,
  };
}
export function addSelection(
  data: DesignData,
  card: BoardCard,
  id: string,
): DesignData {
  if (data.items.some((i) => i.sourceCardId === card.id)) return data;
  return { ...data, items: [...data.items, itemFromCard(card, id)] };
}
export function lineTotal(item: DesignItem): number | null {
  return item.unitPriceCents == null
    ? null
    : Number(
        (BigInt(item.unitPriceCents) *
          BigInt(Math.round(item.quantity * 1000)) +
          BigInt(500)) /
          BigInt(1000),
      );
}
export function procurementTotals(data: DesignData) {
  return {
    totalCents: data.items.reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0),
    unpriced: data.items.filter((i) => i.unitPriceCents == null).length,
    delivered: data.items.filter((i) => i.status === "delivered").length,
    total: data.items.length,
  };
}
export function installationItems(data: DesignData): DesignItem[] {
  const order = new Map(data.installOrder.map((id, n) => [id, n]));
  return [...data.items].sort(
    (a, b) =>
      (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999") ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
export function generateInstallOrder(data: DesignData): string[] {
  return [...data.items]
    .sort(
      (a, b) =>
        (a.deliveryDate ?? "9999").localeCompare(b.deliveryDate ?? "9999") ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .map((i) => i.id);
}
/** Parse a typed amount without silent rounding or losing the distinction between blank and zero. */
export function parseMoney(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(v))
    throw new Error(
      "Enter a non-negative amount with up to two decimal places",
    );
  const [whole, frac = ""] = v.split(".");
  const result = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (result > 1_000_000_000_000) throw new Error("That amount is too large");
  return result;
}
export function money(value: number | null, currency = "ZAR"): string {
  return value == null
    ? "Not priced"
    : new Intl.NumberFormat("en-ZA", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value / 100);
}
