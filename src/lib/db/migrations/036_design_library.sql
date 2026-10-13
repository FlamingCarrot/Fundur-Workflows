-- ==============================================================================
-- The design library: the practice's own blueprints (3D components, wall types
-- and assemblies of other blueprints) and materials.
--
-- Plans and other blueprints point at an entry by id, so changing it changes
-- every use. Each save adds a row to design_library_versions, so any earlier
-- version can be looked at or brought back. The defaults that ship with the app
-- live in code (ids starting "std:") and are never stored here.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS design_library (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('blueprint', 'material')),
    name VARCHAR(120) NOT NULL,
    body JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_design_library_workspace ON design_library(workspace_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS design_library_versions (
    entry_id UUID NOT NULL REFERENCES design_library(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    body JSONB NOT NULL,
    created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (entry_id, revision)
);
