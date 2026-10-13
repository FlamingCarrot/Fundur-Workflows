-- ==============================================================================
-- Running the studio as a business.
--
-- business_settings: one row per workspace: the studio's details, VAT, rates,
-- terms, number prefixes, and the enquiry form's link (a hash to find it by,
-- and the token sealed so the owner can see the link again).
-- time_entries: time worked, on a project (and phase) or not; a running timer
-- has no ended_at. invoice_id is set once the time is billed.
-- business_docs: proposals, invoices and purchase orders. A number is given
-- when one is first sent. The client's link works like a share link: a hash to
-- find it by, sealed so the owner can copy it again.
-- leads: enquiries from the form, or added by hand, through to won or lost.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS business_settings (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}',
    enquiry_token_hash TEXT UNIQUE,
    enquiry_token_sealed TEXT,
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(254) NOT NULL DEFAULT '',
    phone VARCHAR(50) NOT NULL DEFAULT '',
    company VARCHAR(200) NOT NULL DEFAULT '',
    budget VARCHAR(100) NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    source VARCHAR(20) NOT NULL DEFAULT 'manual', -- 'form' | 'manual'
    status VARCHAR(20) NOT NULL DEFAULT 'new', -- 'new' | 'contacted' | 'proposal' | 'won' | 'lost'
    notes TEXT NOT NULL DEFAULT '',
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leads_workspace ON leads(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS business_docs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL, -- 'proposal' | 'invoice' | 'purchase_order'
    number VARCHAR(40),
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft' | 'sent' | 'accepted' | 'declined' | 'paid' | 'void'
    title VARCHAR(200) NOT NULL DEFAULT '',
    party JSONB NOT NULL DEFAULT '{}',
    lines JSONB NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    vat_rate NUMERIC(5, 2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    issue_date DATE,
    due_date DATE,
    total_cents BIGINT NOT NULL DEFAULT 0,
    paid_cents BIGINT NOT NULL DEFAULT 0,
    sent_at TIMESTAMP WITH TIME ZONE,
    accepted_at TIMESTAMP WITH TIME ZONE,
    accepted_name VARCHAR(200),
    accepted_from VARCHAR(100),
    paid_at TIMESTAMP WITH TIME ZONE,
    token_hash TEXT UNIQUE,
    token_sealed TEXT,
    ai_drafted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, kind, number)
);
CREATE INDEX IF NOT EXISTS idx_business_docs_workspace ON business_docs(workspace_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_business_docs_project ON business_docs(project_id);

CREATE TABLE IF NOT EXISTS time_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    user_id VARCHAR(255) NOT NULL,
    phase_key VARCHAR(100),
    note VARCHAR(500) NOT NULL DEFAULT '',
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,
    minutes INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
    billable BOOLEAN NOT NULL DEFAULT TRUE,
    rate_cents INTEGER,
    invoice_id UUID REFERENCES business_docs(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_workspace ON time_entries(workspace_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
-- One running timer per person.
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_running ON time_entries(workspace_id, user_id) WHERE ended_at IS NULL;

-- The autopilot can point her at a document it drafted.
ALTER TABLE autopilot_asks ADD COLUMN IF NOT EXISTS link TEXT;
