-- ==============================================================================
-- Working together on a project, and showing the client how it is going.
--
-- project_member_access: what one teammate may see and do on one project
-- (read only, hidden phases, steps and tools). No row means full access.
--
-- The team space: whiteboard notes, chats with their messages, and comments
-- that sit on a phase, a step, the plan or a board. Each note, message and
-- comment is its own row, so people working at once never overwrite each other.
--
-- client_invites: the client's progress page. Only a hash of the link's token
-- is kept, and the page opens only for someone signed in with the invited,
-- verified email address.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS project_member_access (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access JSONB NOT NULL,
    updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_whiteboard_notes (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    note JSONB NOT NULL,
    updated_by VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_whiteboard_notes_project ON project_whiteboard_notes(workspace_id, project_id);

CREATE TABLE IF NOT EXISTS project_chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    member_ids TEXT[] NOT NULL DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_project_chats_project ON project_chats(workspace_id, project_id, created_at);
-- The one chat everyone on the project is in has no member list.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_chats_everyone ON project_chats(project_id) WHERE cardinality(member_ids) = 0;

CREATE TABLE IF NOT EXISTS project_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES project_chats(id) ON DELETE CASCADE,
    author_id VARCHAR(255) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON project_chat_messages(chat_id, created_at);

CREATE TABLE IF NOT EXISTS project_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    anchor VARCHAR(120) NOT NULL,
    parent_id UUID REFERENCES project_comments(id) ON DELETE CASCADE,
    author_id VARCHAR(255) NOT NULL,
    author_name VARCHAR(255) NOT NULL,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_project_comments_anchor ON project_comments(workspace_id, project_id, anchor, created_at);

CREATE TABLE IF NOT EXISTS client_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    settings JSONB NOT NULL,
    created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMP WITH TIME ZONE,
    last_opened_at TIMESTAMP WITH TIME ZONE,
    open_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_client_invites_project ON client_invites(workspace_id, project_id, created_at DESC);
