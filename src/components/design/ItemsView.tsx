/* eslint-disable @next/next/no-img-element -- Private project images must use authenticated routes. */
"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, Link2, Plus, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { DesignLink } from "./DesignLink";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { MissingProject } from "@/components/views/MissingProject";
import { getWorkflow, label } from "@/lib/workflow";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { downloadHref } from "@/lib/studio/uploads";
import { ITEM_STATUSES, type DesignItem } from "@/lib/design/schema";
import {
  generateInstallOrder,
  installationItems,
  lineTotal,
  money,
  newItem,
  parseMoney,
  procurementTotals,
  STATUS_LABELS,
} from "@/lib/design/model";
import type { Project } from "@/lib/studio/types";
import { useDesign } from "./useDesign";
import { ItemForm } from "./ItemForm";
import { SaveFeedback } from "./SaveFeedback";
import { DesignReferences } from "./DesignReferences";
import "./design.css";
export function ItemsView({
  projectId,
  registerKey,
}: {
  projectId: string;
  registerKey: string;
}) {
  const { ready, getProject, viewer } = useStudio();
  const project = getProject(projectId);
  return (
    <WhenReady ready={ready}>
      {project ? (
        <ItemsScreen
          key={`${viewer.userId}.${viewer.workspaceId}.${project.id}`}
          project={project}
          registerKey={registerKey}
        />
      ) : (
        <main className="page">
          <MissingProject />
        </main>
      )}
    </WhenReady>
  );
}
function ItemsScreen({
  project,
  registerKey,
}: {
  project: Project;
  registerKey: string;
}) {
  const editor = useDesign(project.id);
  const data = editor.data;
  const [form, setForm] = useState<DesignItem | null>(null),
    [supplier, setSupplier] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [query, setQuery] = useState(""),
    [onlyOpen, setOnlyOpen] = useState(true),
    [budgetError, setBudgetError] = useState("");
  const phases = getWorkflow(project).phases,
    phase = phases.find((p) =>
      p.modules.includes(`item_register:${registerKey}`),
    );
  const isDelivery = registerKey === "outstanding",
    isSourcing = registerKey === "register",
    isSchedule = registerKey === "schedule";
  const shown =
    data?.items.filter(
      (i) =>
        (!supplier || i.supplier === supplier) &&
        (!statusFilter || i.status === statusFilter) &&
        `${i.name} ${i.category} ${i.tags.join(" ")}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  const totals = data ? procurementTotals(data) : null;
  const saveItem = (item: DesignItem) => {
    editor.update((d) => ({
      ...d,
      items: d.items.some((i) => i.id === item.id)
        ? d.items.map((i) => (i.id === item.id ? item : i))
        : [...d.items, item],
    }));
    setForm(null);
  };
  const updateItem = (id: string, patch: Partial<DesignItem>) =>
    editor.update((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    }));
  const remove = (id: string) => {
    if (
      !window.confirm(
        "Remove this selection from the palette, schedule, sourcing and installation list?",
      )
    )
      return;
    editor.update((d) => ({
      ...d,
      items: d.items.filter((i) => i.id !== id),
      installOrder: d.installOrder.filter((i) => i !== id),
    }));
  };
  function move(id: string, delta: number) {
    if (!data) return;
    const order = installationItems(data).map((i) => i.id),
      n = order.indexOf(id),
      to = n + delta;
    if (to < 0 || to >= order.length) return;
    [order[n], order[to]] = [order[to], order[n]];
    editor.update((d) => ({ ...d, installOrder: order }));
  }
  if (!phase)
    return (
      <main className="page">
        <p>This register is not part of this workflow.</p>
        <Link href={`/projects/${project.id}`}>Back to project</Link>
      </main>
    );
  return (
    <FocusFrame
      beforeExit={editor.flush}
      wide
      exitHref={`/projects/${project.id}/phases/${phase.key}`}
      title={label(project, registerKey, "Items")}
      right={
        <span role="status" className="tiny muted">
          {editor.status}
        </span>
      }
    >
      <main className="design-page" style={swatchVar(project.swatch)}>
        <header className="row-between wrap design-header">
          <div>
            <p className="eyebrow">
              {project.name} · {phase.name}
            </p>
            <h1 className="display-m">
              {label(project, registerKey, "Items")}
            </h1>
            <p className="muted">
              {isDelivery
                ? "Every selection, its arrival and the work still to finish."
                : isSourcing
                  ? "Keep suppliers, prices and progress together."
                  : isSchedule
                    ? "Your concept selections, ready to specify without retyping."
                    : "Tag selections once. Use them throughout this project."}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!data}
            onClick={() => setForm(newItem(crypto.randomUUID()))}
          >
            <Plus size={16} />
            Add selection
          </button>
        </header>
        <nav className="design-tabs" aria-label="Project item views">
          {isSourcing && phases.some((p) => p.modules.includes("message_drafter")) && <DesignLink flush={editor.flush} href={`/projects/${project.id}/rfqs`}>Quote requests</DesignLink>}
          {isSchedule && phases.some((p) => p.modules.includes("regulatory_checklist")) && <DesignLink flush={editor.flush} href={`/projects/${project.id}/regulations`}>Regulation checklist</DesignLink>}
          {phases
            .flatMap((p) =>
              p.modules
                .filter((m) => m.startsWith("item_register:"))
                .map((m) => m.split(":")[1]),
            )
            .map((k) => (
              <DesignLink
                flush={editor.flush}
                key={k}
                href={`/projects/${project.id}/items/${k}`}
                aria-current={k === registerKey ? "page" : undefined}
              >
                {label(project, k, "Items")}
              </DesignLink>
            ))}
          <DesignLink
            flush={editor.flush}
            href={`/projects/${project.id}/documents#sharing-heading`}
          >
            <Link2 size={14} />
            Client links
          </DesignLink>
        </nav>
        <SaveFeedback editor={editor} />
        {data && (
          <>
            {isSchedule && (
              <DesignReferences
                project={project}
                data={data}
                flush={editor.flush}
              />
            )}
            {isSourcing && totals && (
              <section className="card procurement-summary">
                <div>
                  <p className="eyebrow">Selected quotes</p>
                  <h2>{money(totals.totalCents, data.currency)}</h2>
                  <p className="small muted">
                    {totals.unpriced} unpriced · {totals.delivered} of{" "}
                    {totals.total} delivered
                  </p>
                  {data.budgetCents != null && (
                    <p
                      className={
                        totals.totalCents > data.budgetCents
                          ? "design-error small"
                          : "small muted"
                      }
                    >
                      {money(
                        Math.abs(data.budgetCents - totals.totalCents),
                        data.currency,
                      )}{" "}
                      {totals.totalCents > data.budgetCents
                        ? "over"
                        : "remaining in"}{" "}
                      budget
                      {totals.unpriced ? " · excludes unpriced items" : ""}
                    </p>
                  )}
                </div>
                <label className="field">
                  <span className="field-label">
                    Procurement budget ({data.currency})
                  </span>
                  <input
                    className="input"
                    key={data.budgetCents}
                    inputMode="decimal"
                    defaultValue={
                      data.budgetCents == null
                        ? ""
                        : (data.budgetCents / 100).toFixed(2)
                    }
                    onBlur={(e) => {
                      try {
                        const budgetCents = parseMoney(e.target.value);
                        editor.update((d) => ({ ...d, budgetCents }));
                        setBudgetError("");
                      } catch (err) {
                        setBudgetError((err as Error).message);
                      }
                    }}
                    placeholder="Set a budget"
                  />
                  {budgetError && (
                    <span className="design-error small">{budgetError}</span>
                  )}
                </label>
                <p className="small muted">
                  Amounts use your chosen quote basis; include VAT and shipping
                  consistently. Unpriced items remain visible.
                </p>
              </section>
            )}
            <div className="row wrap design-toolbar">
              <label className="field">
                <span className="sr-only">Find selections</span>
                <input
                  className="input"
                  placeholder="Find a selection or tag…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {(isSourcing || isDelivery) && (
                <label className="row small">
                  Supplier
                  <select
                    className="input"
                    value={supplier}
                    aria-label="Supplier filter"
                    onChange={(e) => setSupplier(e.target.value)}
                  >
                    <option value="">All suppliers</option>
                    {[
                      ...new Set(
                        data.items.map((i) => i.supplier).filter(Boolean),
                      ),
                    ]
                      .sort()
                      .map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                  </select>
                </label>
              )}
              {(isSourcing || isDelivery) && (
                <label className="row small">
                  Status
                  <select
                    className="input"
                    value={statusFilter}
                    aria-label="Status filter"
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">All statuses</option>
                    {ITEM_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {isDelivery && (
                <>
                  <label className="row small">
                    <input
                      type="checkbox"
                      checked={onlyOpen}
                      onChange={(e) => setOnlyOpen(e.target.checked)}
                    />
                    Outstanding only
                  </label>
                  <button
                    className="btn btn-secondary btn-sm"
                    type="button"
                    onClick={() =>
                      editor.update((d) => ({
                        ...d,
                        installOrder: generateInstallOrder(d),
                      }))
                    }
                  >
                    Order by delivery date
                  </button>
                </>
              )}
            </div>
            {form && (
              <ItemForm
                key={form.id}
                item={form}
                project={project}
                currency={data.currency}
                phaseKey={phase.key}
                onSave={saveItem}
                onCancel={() => setForm(null)}
              />
            )}
            {!data.items.length ? (
              <section className="card design-empty">
                <h2>Start with a selection</h2>
                <p className="muted">
                  Add an item here, or add a card to the palette from your
                  concept board. The same records follow every stage.
                </p>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => setForm(newItem(crypto.randomUUID()))}
                >
                  Add your first selection
                </button>
              </section>
            ) : isSourcing ? (
              <div className="sourcing-lanes">
                {ITEM_STATUSES.map((status) => (
                  <section className="sourcing-lane" key={status}>
                    <h2>
                      {STATUS_LABELS[status]}{" "}
                      <span className="muted">
                        {shown.filter((i) => i.status === status).length}
                      </span>
                    </h2>
                    {shown
                      .filter((i) => i.status === status)
                      .map((i) => (
                        <article key={i.id} className="card sourcing-item">
                          <button
                            className="item-name-button"
                            type="button"
                            onClick={() => setForm(i)}
                          >
                            {i.name}
                          </button>
                          <p className="small muted">
                            {i.supplier || "Choose a supplier"}
                          </p>
                          <p className="small strong">
                            {money(lineTotal(i), data.currency)}
                          </p>
                          {i.deliveryDate && (
                            <p className="tiny muted">Due {i.deliveryDate}</p>
                          )}
                          <label className="field">
                            <span className="sr-only">Status for {i.name}</span>
                            <select
                              className="input"
                              value={i.status}
                              aria-label={`Status for ${i.name}`}
                              onChange={(e) =>
                                updateItem(i.id, {
                                  status: e.target
                                    .value as DesignItem["status"],
                                })
                              }
                            >
                              {ITEM_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </article>
                      ))}
                  </section>
                ))}
              </div>
            ) : isDelivery ? (
              <section className="card installation-list">
                <div className="row-between wrap">
                  <h2>Installation sequence</h2>
                  <p className="small muted">
                    {data.items.filter((i) => i.installDone).length} of{" "}
                    {data.items.length} installed / cleared
                  </p>
                </div>
                {installationItems(data)
                  .filter(
                    (i) =>
                      shown.some((s) => s.id === i.id) &&
                      (!onlyOpen || i.status !== "delivered" || !i.installDone),
                  )
                  .map((i, n) => (
                    <article className="installation-row" key={i.id}>
                      <button
                        type="button"
                        className="check-box"
                        role="checkbox"
                        aria-label={`Installation cleared for ${i.name}`}
                        aria-checked={i.installDone}
                        onClick={() =>
                          updateItem(i.id, { installDone: !i.installDone })
                        }
                      >
                        <Check size={15} />
                      </button>
                      <div className="grow">
                        <button
                          type="button"
                          className="item-name-button"
                          onClick={() => setForm(i)}
                        >
                          {i.name}
                        </button>
                        <p className="small muted">
                          {STATUS_LABELS[i.status]}
                          {i.deliveryDate
                            ? ` · due ${i.deliveryDate}`
                            : " · no delivery date"}
                        </p>
                        {i.notes && (
                          <p className="small installation-note">{i.notes}</p>
                        )}
                        {i.snagDocumentIds.length > 0 && (
                          <p className="tiny muted">
                            {i.snagDocumentIds.length} snag photo(s) · open to
                            review
                          </p>
                        )}
                      </div>
                      <div className="row">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${i.name} earlier`}
                          disabled={n === 0 && !onlyOpen && !supplier && !query}
                          onClick={() => move(i.id, -1)}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Move ${i.name} later`}
                          onClick={() => move(i.id, 1)}
                        >
                          <ArrowDown size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                {!shown.some(
                  (i) => i.status !== "delivered" || !i.installDone,
                ) &&
                  onlyOpen && (
                    <p className="muted">No outstanding items in this view.</p>
                  )}
                <p className="small muted">
                  Review site access, assembly dependencies and safety before
                  using this order.
                </p>
              </section>
            ) : isSchedule ? (
              <div className="schedule-scroll">
                <table className="design-schedule">
                  <thead>
                    <tr>
                      <th>Selection</th>
                      <th>Specification</th>
                      <th>Dimensions</th>
                      <th>Qty</th>
                      <th>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((i) => (
                      <tr key={i.id}>
                        <td>
                          <strong>{i.name}</strong>
                          <p className="tiny muted">
                            {i.category} {i.tags.join(" · ")}
                          </p>
                        </td>
                        <td style={{ whiteSpace: "pre-wrap" }}>
                          {i.specification || "To be specified"}
                        </td>
                        <td>{i.dimensions || "To be confirmed"}</td>
                        <td>{i.quantity}</td>
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            type="button"
                            onClick={() => setForm(i)}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="palette-grid">
                {shown.map((i) => (
                  <article className="card palette-item" key={i.id}>
                    {i.documentId && (
                      <img
                        src={downloadHref(project.id, i.documentId)}
                        alt={i.name}
                      />
                    )}
                    <div className="palette-item-body">
                      <p className="eyebrow">{i.category || "Selection"}</p>
                      <button
                        className="item-name-button"
                        type="button"
                        onClick={() => setForm(i)}
                      >
                        {i.name}
                      </button>
                      <p className="small muted">{i.tags.join(" · ")}</p>
                      <p className="small">
                        {i.specification || "Add your specification"}
                      </p>
                      <div className="row-between">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setForm(i)}
                        >
                          Edit selection
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Remove ${i.name}`}
                          onClick={() => remove(i.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {data.items.length > 0 && !shown.length && (
              <p className="muted">No selections match this filter.</p>
            )}
          </>
        )}
      </main>
    </FocusFrame>
  );
}
