-- ==============================================================================
-- MCP server (src/lib/mcp): outside AI apps (Claude, ChatGPT, Cursor, agents)
-- use Fundur's assistant tools as the person who connected them.
-- ==============================================================================

-- Personal access tokens and OAuth logins. Only a hash of each secret is kept.
CREATE TABLE IF NOT EXISTS mcp_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'personal', -- 'personal' | 'oauth'
    client_id TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    refresh_hash TEXT UNIQUE,
    -- The first characters of the token, so she can tell her tokens apart.
    prefix VARCHAR(32) NOT NULL,
    -- May confirm changes that otherwise wait for her button in the app (deletes, completing phases, bulk moves).
    can_confirm BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    refresh_expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_user ON mcp_tokens(user_id, created_at DESC);

-- Apps that registered themselves for OAuth (RFC 7591). Public clients with PKCE only.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
    client_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    redirect_uris JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    can_confirm BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE
);

-- The assistant message in a project's (or her own) chat that collects what one connection did that day,
-- so the changes show in the app with their Undo buttons and the work's cost adds up there.
CREATE TABLE IF NOT EXISTS mcp_chat_anchors (
    token_id UUID NOT NULL REFERENCES mcp_tokens(id) ON DELETE CASCADE,
    scope TEXT NOT NULL, -- a project's id, or 'studio'
    day DATE NOT NULL,
    message_id UUID NOT NULL REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
    PRIMARY KEY (token_id, scope, day)
);
