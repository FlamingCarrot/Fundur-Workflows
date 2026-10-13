-- ==============================================================================
-- The assistant outside a project: on the design library, the planner and
-- anywhere else, each person has a conversation of their own with no project.
-- Its messages, the changes it proposed and the tools it ran keep a null
-- project and are found by workspace and person.
-- ==============================================================================

ALTER TABLE ai_chat_messages ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE ai_proposals ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE ai_tool_calls ALTER COLUMN project_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_studio
    ON ai_chat_messages(workspace_id, user_id, created_at) WHERE project_id IS NULL;
