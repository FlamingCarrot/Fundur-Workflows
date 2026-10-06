-- ==============================================================================
-- The AI cost log (P1-14). Every AI call is logged with its model, tokens and
-- cost; the costs the app shows are sums of this log, so they always match it.
-- ==============================================================================

ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS user_id VARCHAR(255);
-- Rand at the rate set with the model when the call ran.
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS cost_zar NUMERIC(12, 4) NOT NULL DEFAULT 0;
ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS error TEXT;
CREATE INDEX IF NOT EXISTS idx_ai_runs_workspace ON ai_runs(workspace_id, created_at);
