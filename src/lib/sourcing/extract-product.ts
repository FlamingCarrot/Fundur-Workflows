import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import {
  productImportSchema,
  type ProductImport,
  type ImportField,
} from "./import-schema";
type Node = DefaultTreeAdapterMap["node"];
type RecordValue = Record<string, unknown>;
const object = (v: unknown): v is RecordValue =>
  !!v && typeof v === "object" && !Array.isArray(v);
function visit(root: Node, fn: (n: Node) => void) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    fn(n);
    if ("childNodes" in n)
      for (let i = n.childNodes.length - 1; i >= 0; i--)
        stack.push(n.childNodes[i]);
  }
}
function text(root: Node) {
  const out: string[] = [];
  visit(root, (n) => {
    if (n.nodeName === "#text" && "value" in n) out.push(n.value);
  });
  return out.join(" ");
}
function clean(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return text(parseFragment(String(value)))
    .replace(/\s+/g, " ")
    .trim();
}
function typeIs(value: unknown, type: string) {
  const types = Array.isArray(value) ? value : [value];
  return types.some(
    (t) => typeof t === "string" && t.split(/[\/#]/).pop() === type,
  );
}
function labelled(value: unknown) {
  return clean(object(value) ? value.name : value);
}
function measurement(value: unknown) {
  if (!object(value)) return clean(value);
  const unit = clean(value.unitText) || clean(value.unitCode),
    amount = clean(value.value);
  return amount
    ? unit
      ? `${amount} ${unit}`
      : `${amount} (unit not stated)`
    : "";
}
const limits: Record<ImportField, number> = {
  name: 200,
  dimensions: 500,
  specification: 5000,
  supplier: 200,
  unitPriceCents: 1_000_000_000_000,
};
/** Only explicit page facts; no script execution, inferred measurements, invented prices or AI instructions. */
export function extractProducts(
  html: string,
  sourceUrl: string,
  currency: string,
  now = new Date().toISOString(),
): ProductImport {
  if (Buffer.byteLength(html, "utf8") > 1024 * 1024)
    throw new Error("This page is too large to read automatically.");
  const root = parse(html),
    structured: { product: RecordValue; path: string }[] = [],
    meta = new Map<string, string>(),
    warnings = new Set<string>();
  let title = "";
  visit(root, (n) => {
    if (!("tagName" in n)) return;
    const attribute = (name: string) =>
      n.attrs.find((a) => a.name === name)?.value ?? "";
    if (n.tagName === "title") title = clean(text(n));
    if (n.tagName === "meta") {
      const key = (attribute("property") || attribute("name")).toLowerCase();
      if (key && !meta.has(key)) meta.set(key, attribute("content"));
    }
    if (
      n.tagName !== "script" ||
      attribute("type").split(";")[0].trim().toLowerCase() !==
        "application/ld+json"
    )
      return;
    const raw =
      "childNodes" in n
        ? n.childNodes
            .filter((c) => c.nodeName === "#text" && "value" in c)
            .map((c) => ("value" in c ? c.value : ""))
            .join("")
        : "";
    if (raw.length > 200_000) {
      warnings.add(
        "A large structured-data block was omitted. Review the source for further details.",
      );
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      warnings.add("A structured-data block could not be read.");
      return;
    }
    const stack: { value: unknown; path: string; depth: number }[] = [
      { value: json, path: "JSON-LD", depth: 0 },
    ];
    let count = 0;
    while (stack.length && count++ < 4000) {
      const { value, path, depth } = stack.pop()!;
      if (depth > 12) continue;
      if (Array.isArray(value)) {
        for (let i = Math.min(value.length, 200) - 1; i >= 0; i--)
          stack.push({
            value: value[i],
            path: `${path}[${i}]`,
            depth: depth + 1,
          });
      } else if (object(value)) {
        if (typeIs(value["@type"], "Product"))
          structured.push({ product: value, path: path.slice(0, 150) });
        for (const [key, child] of Object.entries(value)) {
          if (object(child) || Array.isArray(child))
            stack.push({
              value: child,
              path: `${path}.${key}`.slice(0, 150),
              depth: depth + 1,
            });
        }
      }
    }
    if (stack.length)
      warnings.add("Only the first structured product records were read.");
  });
  const products: ProductImport["products"] = [],
    seen = new Set<string>();
  for (const { product: p, path } of structured) {
    const identity = JSON.stringify(p);
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (products.length >= 20) {
      warnings.add(
        "Only the first 20 products are shown. Paste a specific product link for more.",
      );
      break;
    }
    const fields: ProductImport["products"][number]["fields"] = [];
    const add = (
      field: ImportField,
      value: string | number,
      selector: string,
      excerpt = String(value),
    ) => {
      if (value === "" || value == null) return;
      if (typeof value === "string" && value.length > limits[field]) {
        warnings.add(
          `The ${field} text exceeds its field limit. Copy it from the page manually.`,
        );
        return;
      }
      fields.push({
        field,
        value,
        selector: selector.slice(0, 200),
        excerpt: excerpt.slice(0, 5000),
      });
    };
    const name = clean(p.name);
    add("name", name, `${path}.name`);
    const dimensions =
      [
        ["Width", p.width],
        ["Depth", p.depth],
        ["Height", p.height],
      ]
        .map(([label, value]) => {
          const measured = measurement(value);
          return measured ? `${label}: ${measured}` : "";
        })
        .filter(Boolean)
        .join(" · ") || clean(p.size);
    add("dimensions", dimensions, `${path}.width/depth/height/size`);
    const specification = [
      clean(p.description),
      p.sku ? `SKU: ${clean(p.sku)}` : "",
      p.model ? `Model: ${labelled(p.model)}` : "",
      p.brand ? `Brand: ${labelled(p.brand)}` : "",
      p.material
        ? `Material: ${Array.isArray(p.material) ? p.material.map(clean).join(", ") : clean(p.material)}`
        : "",
      p.color ? `Colour: ${clean(p.color)}` : "",
    ];
    const properties = Array.isArray(p.additionalProperty)
      ? p.additionalProperty
      : object(p.additionalProperty)
        ? [p.additionalProperty]
        : [];
    for (const property of properties.slice(0, 30)) {
      if (!object(property)) continue;
      const label = clean(property.name),
        value = measurement(property);
      if (label && value) specification.push(`${label}: ${value}`);
    }
    add(
      "specification",
      specification.filter(Boolean).join("\n"),
      `${path}.description/sku/brand/material/additionalProperty`,
    );
    const offers = (Array.isArray(p.offers) ? p.offers : [p.offers])
      .filter(object)
      .filter((o) => !typeIs(o["@type"], "AggregateOffer"));
    const suppliers = [
      ...new Set(offers.map((o) => labelled(o.seller)).filter(Boolean)),
    ];
    if (suppliers.length === 1)
      add("supplier", suppliers[0], `${path}.offers.seller.name`);
    const amounts = new Set<number>();
    for (const offer of offers) {
      const value = String(offer.price ?? "").trim(),
        unit = clean(offer.priceCurrency).toUpperCase();
      if (!value) continue;
      if (unit !== currency) {
        warnings.add(
          "Prices in other or unspecified currencies were omitted. The project currency stays unchanged.",
        );
        continue;
      }
      if (!/^\d+(\.\d{1,2})?$/.test(value)) {
        warnings.add(
          "An ambiguous or fractional-cent price was omitted. Enter its quoted amount manually.",
        );
        continue;
      }
      const [whole, fraction = ""] = value.split("."),
        cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      if (
        Number.isSafeInteger(cents) &&
        cents >= 0 &&
        cents <= limits.unitPriceCents
      )
        amounts.add(cents);
    }
    if (amounts.size === 1) {
      const amount = [...amounts][0];
      add(
        "unitPriceCents",
        amount,
        `${path}.offers.price/priceCurrency`,
        `${(amount / 100).toFixed(2)} ${currency}`,
      );
      warnings.add(
        "Listed prices are page facts, not a supplier quotation. Confirm quantity, tax, delivery and availability.",
      );
    } else if (amounts.size > 1)
      warnings.add(
        "Multiple prices were found for a product; no price was chosen.",
      );
    if (fields.length)
      products.push({
        key: `product-${products.length + 1}`,
        label: [
          name || `Product ${products.length + 1}`,
          p.sku ? `SKU ${clean(p.sku)}` : "",
          clean(p.color),
          clean(p.size),
        ]
          .filter(Boolean)
          .join(" · ")
          .slice(0, 250),
        fields,
      });
  }
  if (!products.length) {
    const name = clean(meta.get("og:title")) || title,
      description =
        clean(meta.get("og:description")) || clean(meta.get("description")),
      supplier = clean(meta.get("og:site_name"));
    const fields: ProductImport["products"][number]["fields"] = [];
    for (const [field, value, selector] of [
      ["name", name, "page title"],
      ["specification", description, "page description"],
      ["supplier", supplier, "og:site_name"],
    ] as const) {
      if (value && value.length <= limits[field])
        fields.push({ field, value, selector, excerpt: value });
    }
    if (fields.length)
      products.push({
        key: "page-metadata",
        label: (name || "Page metadata").slice(0, 250),
        fields,
      });
    warnings.add(
      "Only general page metadata was found. Verify that it describes the selected product; dimensions and prices were not inferred.",
    );
  }
  if (products.length > 1)
    warnings.add(
      "Multiple products were found. Choose the exact product or variant before applying fields.",
    );
  return productImportSchema.parse({
    sourceUrl,
    fetchedAt: now,
    products,
    warnings: [...warnings].slice(0, 25),
  });
}
