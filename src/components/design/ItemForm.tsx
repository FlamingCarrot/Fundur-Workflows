/* eslint-disable @next/next/no-img-element -- Private project images must bypass the optimization cache. */
"use client";
import { SupplierImportReview } from "@/components/sourcing/SupplierImportReview";
import { currentSupplierEvidence } from "@/lib/sourcing/apply-import";
import { useState } from "react";
import { Sparkles, UploadCloud, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import {
  designItemSchema,
  ITEM_STATUSES,
  type DesignItem,
} from "@/lib/design/schema";
import { STATUS_LABELS, parseMoney } from "@/lib/design/model";
import { designRequest, uploadDesignImage } from "@/lib/design/client";
import { downloadHref } from "@/lib/studio/uploads";
import type { Project } from "@/lib/studio/types";
export function ItemForm({
  project,
  item,
  currency,
  phaseKey,
  onSave,
  onCancel,
}: {
  project: Project;
  item: DesignItem;
  currency: string;
  phaseKey: string;
  onSave: (item: DesignItem) => void;
  onCancel: () => void;
}) {
  const { viewer, persistence, fileStorage, receiveProject } = useStudio();
  const [draft, setDraft] = useState(item),
    [tags, setTags] = useState(item.tags.join(", ")),
    [price, setPrice] = useState(
      item.unitPriceCents == null ? "" : (item.unitPriceCents / 100).toFixed(2),
    );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ai, setAi] = useState<{
      text: string;
      costZar: number;
      reviewNote?: string;
    } | null>(null);
  const images = project.documents.filter(
    (d) => d.stored && /\.(png|jpe?g|gif|webp)$/i.test(d.name),
  );
  const edit = (patch: Partial<DesignItem>) =>
    setDraft((d) => ({ ...d, ...patch }));
  async function generate() {
    setBusy(true);
    setError("");
    try {
      setAi(
        await designRequest(
          `/api/projects/${encodeURIComponent(project.id)}/design/specification`,
          { method: "POST", body: JSON.stringify({ itemId: item.id }) },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function photo(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await uploadDesignImage(project.id, file, phaseKey);
      receiveProject(result.project);
      edit({ snagDocumentIds: [...draft.snagDocumentIds, result.doc.id] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="card item-editor"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        try {
          const parsed = designItemSchema.safeParse({
            ...draft,
            tags: [
              ...new Set(
                tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              ),
            ],
            unitPriceCents: parseMoney(price),
          });
          if (!parsed.success) throw new Error(parsed.error.issues[0].message);
          onSave({
            ...parsed.data,
            supplierEvidence: currentSupplierEvidence(parsed.data),
          });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <div className="row-between">
        <h2>{item.name ? "Edit selection" : "New selection"}</h2>
        <button
          className="icon-btn"
          type="button"
          aria-label="Close item editor"
          onClick={onCancel}
        >
          <X size={18} />
        </button>
      </div>
      <div className="item-form-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            autoFocus
            required
            className="input"
            value={draft.name}
            maxLength={200}
            onChange={(e) => edit({ name: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Category</span>
          <input
            className="input"
            value={draft.category}
            maxLength={100}
            placeholder="Furniture, finish, lighting…"
            onChange={(e) => edit({ category: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Tags</span>
          <input
            className="input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Comma-separated tags"
          />
        </label>
        <label className="field">
          <span className="field-label">Dimensions / units</span>
          <input
            className="input"
            value={draft.dimensions}
            maxLength={500}
            placeholder="e.g. 1,600 × 800 × 750 mm"
            onChange={(e) => edit({ dimensions: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Quantity</span>
          <input
            className="input"
            type="number"
            min={0.001}
            max={1_000_000}
            step={0.001}
            required
            value={draft.quantity}
            onChange={(e) => edit({ quantity: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Unit price ({currency})</span>
          <input
            className="input"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Leave blank until quoted"
          />
        </label>
        <label className="field">
          <span className="field-label">Supplier</span>
          <input
            className="input"
            value={draft.supplier}
            maxLength={200}
            onChange={(e) => edit({ supplier: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Supplier link</span>
          <input
            className="input"
            type="url"
            value={draft.supplierUrl ?? ""}
            onChange={(e) => edit({ supplierUrl: e.target.value || null })}
            placeholder="https://…"
          />
        </label>
        <label className="field">
          <span className="field-label">Sourcing status</span>
          <select
            className="input"
            value={draft.status}
            onChange={(e) =>
              edit({ status: e.target.value as DesignItem["status"] })
            }
          >
            {ITEM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Expected delivery</span>
          <input
            className="input"
            type="date"
            value={draft.deliveryDate ?? ""}
            onChange={(e) => edit({ deliveryDate: e.target.value || null })}
          />
        </label>
        <label className="field">
          <span className="field-label">Selection image</span>
          <select
            className="input"
            value={draft.documentId ?? ""}
            onChange={(e) => edit({ documentId: e.target.value || null })}
          >
            <option value="">No image</option>
            {images.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SupplierImportReview
        projectId={project.id}
        item={draft}
        currency={currency}
        server={persistence === "server"}
        disabled={busy}
        priceText={price}
        onApply={(imported, fields) => {
          setDraft(imported);
          if (fields.includes("unitPriceCents"))
            setPrice(
              imported.unitPriceCents == null
                ? ""
                : (imported.unitPriceCents / 100).toFixed(2),
            );
        }}
      />
      <label className="field">
        <span className="field-label">Specification</span>
        <textarea
          aria-label="Specification"
          className="textarea"
          rows={5}
          value={draft.specification}
          maxLength={5000}
          onChange={(e) => edit({ specification: e.target.value })}
        />
      </label>
      {project &&
        item.name &&
        viewer.features?.ai !== false &&
        viewer.workspaceRole !== "collaborator" && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void generate()}
          >
            <Sparkles size={15} />
            {busy ? "Working…" : "Draft specification from saved details"}
          </button>
        )}
      {ai && (
        <div className="design-ai-review">
          <p className="small strong">
            AI draft ·{" "}
            {new Intl.NumberFormat("en-ZA", {
              style: "currency",
              currency: "ZAR",
            }).format(ai.costZar)}
          </p>
          {ai.reviewNote && <p role="alert">{ai.reviewNote}</p>}
          <p style={{ whiteSpace: "pre-wrap" }}>{ai.text}</p>
          <div className="row wrap">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                edit({ specification: ai.text });
                setAi(null);
              }}
            >
              Use this draft
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAi(null)}
            >
              Discard
            </button>
          </div>
          <p className="small muted">
            Check every detail before saving. Unconfirmed measurements and
            compliance need your review.
          </p>
        </div>
      )}
      <label className="field">
        <span className="field-label">Private notes / installation snags</span>
        <textarea
          aria-label="Private notes / installation snags"
          className="textarea"
          rows={3}
          value={draft.notes}
          maxLength={5000}
          onChange={(e) => edit({ notes: e.target.value })}
        />
      </label>
      <div className="snag-photos">
        {draft.snagDocumentIds.map((id) => (
          <div key={id}>
            <a href={downloadHref(project.id, id)}>
              <img src={downloadHref(project.id, id)} alt="Installation snag" />
            </a>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                edit({
                  snagDocumentIds: draft.snagDocumentIds.filter(
                    (d) => d !== id,
                  ),
                })
              }
            >
              Remove photo
            </button>
          </div>
        ))}
      </div>
      {fileStorage && (
        <label className="btn btn-secondary">
          <UploadCloud size={15} />
          Add snag photo
          <input
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={busy}
            onChange={(e) => {
              void photo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      )}
      {error && (
        <p className="design-error" role="alert">
          {error}
        </p>
      )}
      <div className="row wrap">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Save selection
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
