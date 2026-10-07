ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_managed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS workspace_invitations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member','collaborator')),
 project_ids UUID[] NOT NULL DEFAULT '{}', created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 expires_at TIMESTAMPTZ NOT NULL, accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 accepted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_members (
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY (workspace_id, project_id, user_id)
);
CREATE TABLE IF NOT EXISTS workspace_user_features (
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 feature_key TEXT NOT NULL CHECK(feature_key IN ('ai','floor_plan','layout','sharing')),
 enabled BOOLEAN NOT NULL, PRIMARY KEY(workspace_id,user_id,feature_key)
);
CREATE TABLE IF NOT EXISTS workspace_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
 actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, subject TEXT,
 details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
