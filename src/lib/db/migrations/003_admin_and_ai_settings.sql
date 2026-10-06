-- ==============================================================================
-- Platform admin and the default AI model (P1-12).
--
-- users.platform_role already exists. It is set to 'admin' for a sign-in whose
-- verified email is on the admin list (src/lib/auth/users.ts) and then stays
-- with that Auth0 user id.
--
-- Platform-wide provider keys and the model setting carry no workspace. Postgres
-- treats NULLs as distinct in a UNIQUE constraint, so platform rows get their
-- own partial unique indexes.
-- ==============================================================================

-- The last few characters of a key, so the settings page can say which key is
-- saved without ever sending the key itself back.
ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS key_hint VARCHAR(20);
ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_keys_platform ON provider_keys(provider) WHERE workspace_id IS NULL;

CREATE TABLE IF NOT EXISTS model_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL for the platform default
    role VARCHAR(50) NOT NULL DEFAULT 'default', -- 'default' now; 'orchestrator' | 'worker' in phase 4
    provider VARCHAR(100) NOT NULL,
    model VARCHAR(255) NOT NULL,
    -- US$ per million tokens, used to cost every call made with this model.
    input_usd_per_mtok NUMERIC(12, 4) NOT NULL DEFAULT 0,
    output_usd_per_mtok NUMERIC(12, 4) NOT NULL DEFAULT 0,
    -- Rand per US dollar for the costs the app shows.
    zar_per_usd NUMERIC(10, 4) NOT NULL DEFAULT 18,
    updated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_settings_platform ON model_settings(role) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_settings_workspace ON model_settings(workspace_id, role) WHERE workspace_id IS NOT NULL;
