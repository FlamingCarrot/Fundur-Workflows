-- ==============================================================================
-- User BYOK (Bring Your Own Keys) and AI settings.
-- Allows users to choose between Platform AI Orchestration and their own private
-- API keys (BYOK) for Anthropic, OpenAI, Gemini, xAI, OpenRouter.
-- ==============================================================================

ALTER TABLE provider_keys ADD COLUMN IF NOT EXISTS user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_provider_keys_platform;
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_keys_platform ON provider_keys(provider) WHERE workspace_id IS NULL AND user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_keys_user ON provider_keys(user_id, provider) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_ai_settings (
    user_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mode VARCHAR(50) NOT NULL DEFAULT 'platform', -- 'platform' | 'byok'
    auto_select BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin policy setting: whether BYOK is allowed across the platform
ALTER TABLE platform_access ADD COLUMN IF NOT EXISTS byok_allowed BOOLEAN NOT NULL DEFAULT TRUE;
