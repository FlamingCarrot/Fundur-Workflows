-- ==============================================================================
-- The assistant everywhere: automatic model choice, changes it makes straight
-- away with an undo, plan edits, and a log of every tool it runs.
-- ==============================================================================

-- Platform-wide AI switches, one row per key. 'auto_models' = {"enabled": bool};
-- no row means models are chosen automatically from the shortlist.
CREATE TABLE IF NOT EXISTS ai_platform_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_by VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Small, reversible changes are applied at once ("direct") and keep the change
-- that undoes them. 'undone' joins the statuses. Plan edits keep the plan as it
-- was in undo, and the mutation records the revision they produced.
ALTER TABLE ai_proposals ADD COLUMN IF NOT EXISTS direct BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_proposals ADD COLUMN IF NOT EXISTS undo JSONB;

-- Every tool the assistant ran, for the Admin's breakdown of what a reply did.
CREATE TABLE IF NOT EXISTS ai_tool_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chat_message_id UUID REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
    tool_name VARCHAR(100) NOT NULL,
    ok BOOLEAN NOT NULL DEFAULT TRUE,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_project ON ai_tool_calls(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_message ON ai_tool_calls(chat_message_id);
