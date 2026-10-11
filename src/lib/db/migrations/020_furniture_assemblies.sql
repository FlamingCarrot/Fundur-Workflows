CREATE TABLE IF NOT EXISTS furniture_assemblies (
 id UUID PRIMARY KEY,
 workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name VARCHAR(120) NOT NULL,
 items JSONB NOT NULL,
 created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_furniture_assemblies_workspace ON furniture_assemblies(workspace_id, created_at DESC);
