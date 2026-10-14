-- Each payment on an invoice, with its day, so income by month and part
-- payments add up. business_docs.paid_cents stays the running total.
CREATE TABLE IF NOT EXISTS business_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    doc_id UUID NOT NULL REFERENCES business_docs(id) ON DELETE CASCADE,
    -- Negative when a payment recorded earlier is corrected down.
    amount_cents BIGINT NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_payments_ws ON business_payments(workspace_id, paid_at);

INSERT INTO business_payments (workspace_id, doc_id, amount_cents, paid_at)
SELECT workspace_id, id, paid_cents, COALESCE(paid_at, updated_at)
FROM business_docs d
WHERE paid_cents > 0 AND NOT EXISTS (SELECT 1 FROM business_payments p WHERE p.doc_id = d.id);
