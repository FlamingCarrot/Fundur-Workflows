-- ==============================================================================
-- Plans and subscriptions.
--
-- One subscription per workspace. A workspace without a row is on Free. The
-- plan in force is worked out from the row and the time (src/lib/billing/
-- plans.ts): free months and paid time run out on their own, back to Free.
-- Every change is logged in subscription_events, with who made it.
--
-- billing_settings holds platform switches, such as the beta that gives
-- every workspace Paid at no charge.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS subscriptions (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    plan VARCHAR(20) NOT NULL DEFAULT 'free', -- 'free' | 'paid'
    extra_seats INTEGER NOT NULL DEFAULT 0 CHECK (extra_seats >= 0),
    paid_until TIMESTAMP WITH TIME ZONE,
    comp_until TIMESTAMP WITH TIME ZONE,
    -- { "kind": "percent" | "amount", "value": number, "until": iso | null, "note": text }
    discount JSONB,
    source VARCHAR(20) NOT NULL DEFAULT 'default', -- 'default' | 'admin' | 'provider' | 'code'
    provider VARCHAR(40),
    provider_customer_id VARCHAR(255),
    provider_subscription_id VARCHAR(255),
    note TEXT,
    updated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind VARCHAR(40) NOT NULL, -- 'assign' | 'free_months' | 'discount' | 'seats' | 'code' | 'provider' ...
    summary TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}',
    actor VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_workspace ON subscription_events(workspace_id, created_at);

-- Codes the Admin hands out: free months of Paid, or a discount.
CREATE TABLE IF NOT EXISTS promo_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) NOT NULL UNIQUE, -- stored upper case
    kind VARCHAR(20) NOT NULL, -- 'free_months' | 'percent' | 'amount'
    value NUMERIC(10, 2) NOT NULL,
    -- How many months a discount runs (null: as long as the plan does); ignored for free months.
    months INTEGER,
    max_redemptions INTEGER,
    expires_at TIMESTAMP WITH TIME ZONE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    note TEXT,
    created_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
    code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    redeemed_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code_id, workspace_id)
);

CREATE TABLE IF NOT EXISTS billing_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id), -- one row
    beta_all_paid BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
INSERT INTO billing_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;
