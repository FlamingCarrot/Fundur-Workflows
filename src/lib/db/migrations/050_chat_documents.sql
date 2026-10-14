-- Documents the assistant writes in the chat (drafts, letters, specs, research
-- reports). Each opens in the chat's canvas, where people and the assistant
-- edit it; every save keeps the previous text as a version.
CREATE TABLE IF NOT EXISTS chat_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- Null for her own conversation outside any project.
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255),
    kind VARCHAR(20) NOT NULL DEFAULT 'document', -- 'document' | 'research'
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    -- Web pages a research report drew on: [{url, title}].
    sources JSONB NOT NULL DEFAULT '[]',
    version INTEGER NOT NULL DEFAULT 1,
    message_id UUID REFERENCES ai_chat_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_documents_scope ON chat_documents(workspace_id, project_id, updated_at);

CREATE TABLE IF NOT EXISTS chat_document_versions (
    document_id UUID NOT NULL REFERENCES chat_documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    saved_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (document_id, version)
);
