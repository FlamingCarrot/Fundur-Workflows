-- Conversations: posts a person saved for later (with an optional reminder),
-- and posts written now to be sent later.
CREATE TABLE IF NOT EXISTS project_chat_saved (
    post_id UUID NOT NULL REFERENCES project_chat_messages(id) ON DELETE CASCADE,
    person_key VARCHAR(320) NOT NULL,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    remind_at TIMESTAMP WITH TIME ZONE,
    reminded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, person_key)
);
CREATE INDEX IF NOT EXISTS idx_chat_saved_due ON project_chat_saved(workspace_id, remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

CREATE TABLE IF NOT EXISTS project_chat_scheduled (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES project_chats(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES project_chat_messages(id) ON DELETE CASCADE,
    author_id VARCHAR(320) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL CHECK (length(body) <= 5000),
    attachments JSONB NOT NULL DEFAULT '[]',
    ask JSONB,
    send_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_scheduled_due ON project_chat_scheduled(workspace_id, send_at);
