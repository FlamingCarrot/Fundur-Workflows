-- ==============================================================================
-- The Admin's shortlist of models (Settings, AI model).
--
-- The Admin browses everything a provider key can use and adds the models the
-- platform should use. The default model is picked from this list, and the
-- phase 4 model picker offers only these. Name, prices and context are copied
-- from the provider's list when a model is added, so the list reads without a
-- call to the provider.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS enabled_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL for the platform list
    provider VARCHAR(100) NOT NULL,
    model VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    input_usd_per_mtok NUMERIC(12, 4),
    output_usd_per_mtok NUMERIC(12, 4),
    context_length INTEGER,
    added_by VARCHAR(255),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_enabled_models_platform ON enabled_models(provider, model) WHERE workspace_id IS NULL;

-- The model already in use starts the list.
INSERT INTO enabled_models (workspace_id, provider, model, name, input_usd_per_mtok, output_usd_per_mtok, added_by)
SELECT NULL, provider, model, model, input_usd_per_mtok, output_usd_per_mtok, updated_by
FROM model_settings WHERE workspace_id IS NULL AND role = 'default'
ON CONFLICT DO NOTHING;
