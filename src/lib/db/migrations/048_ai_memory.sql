-- The assistant's notebook. After each finished task it writes a short note
-- (what was asked, what it did, the tools it used) and keeps what it learned
-- about the studio or the project as memories, which go into later prompts.
-- People can read, change and delete every memory; notes go with the message.
CREATE TABLE IF NOT EXISTS ai_task_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255),
    message_id UUID UNIQUE REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    tools JSONB NOT NULL DEFAULT '[]',
    changes JSONB NOT NULL DEFAULT '[]',
    learned JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_task_notes_scope ON ai_task_notes(workspace_id, project_id, created_at);

CREATE TABLE IF NOT EXISTS ai_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    -- Null: true for the whole studio. Set: true for that project only.
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    -- 'learned' (the assistant noted it) or 'person' (someone wrote it).
    source VARCHAR(20) NOT NULL DEFAULT 'learned',
    created_by VARCHAR(255),
    message_id UUID REFERENCES ai_chat_messages(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_memories_scope ON ai_memories(workspace_id, project_id, updated_at);
