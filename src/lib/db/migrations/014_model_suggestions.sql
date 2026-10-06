-- ==============================================================================
-- Model suggestions (P4-17).
--
-- When a provider's daily model list brings a model that is cheaper than the
-- one in a role, or newer from the same maker at about the same price, with
-- the same capabilities, a suggestion is kept for the Admin to accept or
-- dismiss. A suggestion is made once per role and model, so a dismissed one
-- does not come back the next morning.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS model_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(40) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    current_model VARCHAR(255) NOT NULL,
    suggested_model VARCHAR(255) NOT NULL,
    suggested_name VARCHAR(255) NOT NULL,
    kind VARCHAR(20) NOT NULL, -- 'cheaper' | 'newer'
    reason TEXT NOT NULL,
    input_usd_per_mtok NUMERIC NOT NULL,
    output_usd_per_mtok NUMERIC NOT NULL,
    context_length INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending' | 'accepted' | 'dismissed'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_suggestions_once ON model_suggestions(role, provider, suggested_model);
CREATE INDEX IF NOT EXISTS idx_model_suggestions_pending ON model_suggestions(created_at) WHERE status = 'pending';
