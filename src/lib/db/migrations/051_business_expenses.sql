-- Money spent for a project (samples, travel, printing) to recharge the client,
-- with any markup. invoice_id is set once it is on an invoice.
CREATE TABLE IF NOT EXISTS business_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    user_id VARCHAR(255) NOT NULL,
    spent_on DATE NOT NULL,
    description VARCHAR(500) NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    markup_pct NUMERIC(6, 2) NOT NULL DEFAULT 0,
    billable BOOLEAN NOT NULL DEFAULT TRUE,
    invoice_id UUID REFERENCES business_docs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_business_expenses_ws ON business_expenses(workspace_id, spent_on DESC);
CREATE INDEX IF NOT EXISTS idx_business_expenses_project ON business_expenses(project_id) WHERE project_id IS NOT NULL;
