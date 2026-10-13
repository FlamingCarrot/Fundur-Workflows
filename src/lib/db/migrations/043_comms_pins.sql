-- Posts pinned to the top of their channel, like Slack and Teams.
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE project_chat_messages ADD COLUMN IF NOT EXISTS pinned_by TEXT;
CREATE INDEX IF NOT EXISTS idx_project_chat_messages_pinned ON project_chat_messages (chat_id, pinned_at) WHERE pinned_at IS NOT NULL;
