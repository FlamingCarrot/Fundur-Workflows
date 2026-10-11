"use client";
import { useState } from "react";
import {
  IMPORT_FIELDS,
  productImportSchema,
  type ProductImport,
  type ImportField,
} from "@/lib/sourcing/import-schema";
import { designRequest } from "@/lib/design/client";
import type { DesignItem } from "@/lib/design/schema";
import {
  applySupplierImport,
  currentSupplierEvidence,
} from "@/lib/sourcing/apply-import";
export const IMPORT_LABELS: Record<ImportField, string> = {
  name: "Name",
  dimensions: "Dimensions / units",
  specification: "Specification",
  supplier: "Supplier",
  unitPriceCents: "Unit price",
};
export function SupplierImportReview({
  projectId,
  item,
  currency,
  server,
  disabled,
  priceText,
  onApply,
}: {
  projectId: string;
  item: DesignItem;
  currency: string;
  server: boolean;
  disabled: boolean;
  onApply: (item: DesignItem, fields: ImportField[]) => void;
  priceText: string;
}) {
  const [result, setResult] = useState<ProductImport | null>(null),
    [key, setKey] = useState(""),
    [chosen, setChosen] = useState<ImportField[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const product = result?.products.find((p) => p.key === key),
    format = (field: ImportField, value: string | number) =>
      field === "unitPriceCents"
        ? `${(Number(value) / 100).toFixed(2)} ${currency}`
        : String(value);
  async function read() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const imported = productImportSchema.parse(
        await designRequest(
          `/api/projects/${encodeURIComponent(projectId)}/design/supplier-import`,
          { method: "POST", body: JSON.stringify({ url: item.supplierUrl }) },
        ),
      );
      setResult(imported);
      setKey(imported.products.length === 1 ? imported.products[0].key : "");
      setChosen([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const evidence = currentSupplierEvidence(item);
  return (
    <section className="supplier-import">
      <div className="row wrap">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={disabled || busy || !server || !item.supplierUrl}
          onClick={() => void read()}
        >
          {busy ? "Reading supplier page…" : "Review supplier page"}
        </button>
        <p className="small muted">
          {server
            ? "Read product details, then choose fields to apply."
            : "Supplier-page reading is available in the signed-in app. You can enter product details manually here."}
        </p>
      </div>
      {error && (
        <p role="alert" className="design-error">
          {error}
        </p>
      )}
      {result && (
        <div className="design-ai-review">
          <h3>Review product details</h3>
          <a
            href={result.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="small"
          >
            Open source page
          </a>
          {result.warnings.map((w) => (
            <p className="small muted" key={w}>
              {w}
            </p>
          ))}
          {result.products.length > 1 && (
            <label className="field">
              <span className="field-label">Product / variant</span>
              <select
                aria-label="Product / variant"
                className="input"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setChosen([]);
                }}
              >
                <option value="">Choose the exact product</option>
                {result.products.map((p) => (
                  <option value={p.key} key={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {product && (
            <>
              <div className="supplier-import-fields">
                {product.fields.map((f) => (
                  <div className="supplier-import-field" key={f.field}>
                    <label className="row">
                      <input
                        type="checkbox"
                        aria-label={`Import ${IMPORT_LABELS[f.field]}`}
                        checked={chosen.includes(f.field)}
                        onChange={(e) =>
                          setChosen((c) =>
                            e.target.checked
                              ? [...c, f.field]
                              : c.filter((field) => field !== f.field),
                          )
                        }
                      />
                      <strong>{IMPORT_LABELS[f.field]}</strong>
                    </label>
                    <p className="tiny muted">
                      Current:{" "}
                      {f.field === "unitPriceCents"
                        ? priceText.trim()
                          ? `${priceText} ${currency}`
                          : "Not set"
                        : format(f.field, item[f.field] ?? "") || "Not set"}
                    </p>
                    <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                      {format(f.field, f.value)}
                    </p>
                    <details>
                      <summary className="tiny muted">Source evidence</summary>
                      <p className="tiny muted">{f.selector}</p>
                      <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                        {f.excerpt}
                      </p>
                    </details>
                  </div>
                ))}
              </div>
              <p className="small muted">
                Fields not selected stay as they are. Applying updates the
                supplier link; save the selection to keep the changes.
              </p>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!chosen.length || disabled}
                  onClick={() => {
                    try {
                      onApply(
                        applySupplierImport(item, result, key, chosen),
                        chosen,
                      );
                      setResult(null);
                      setError("");
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Apply selected fields
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setResult(null)}
                >
                  Discard import
                </button>
              </div>
            </>
          )}
          {!result.products.length && (
            <p>
              No usable product facts were found. Enter its details manually.
            </p>
          )}
        </div>
      )}
      {evidence.length > 0 && (
        <details>
          <summary className="small">
            Imported field sources ({evidence.length})
          </summary>
          {IMPORT_FIELDS.flatMap((field) =>
            evidence.filter((e) => e.field === field),
          ).map((e) => (
            <div className="supplier-import-field" key={e.field}>
              <strong className="small">{IMPORT_LABELS[e.field]}</strong>
              <p className="tiny muted">
                Read{" "}
                {new Date(e.fetchedAt).toLocaleDateString("en-ZA", {
                  timeZone: "Africa/Johannesburg",
                })}{" "}
                · {e.selector}
              </p>
              <a
                href={e.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="small"
              >
                Source page
              </a>
              <p className="small">{e.excerpt}</p>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
