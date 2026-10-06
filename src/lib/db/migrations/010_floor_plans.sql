-- ==============================================================================
-- Floor plans (phase 3).
--
-- One editable plan per project, kept as geometry (walls, openings, columns,
-- rooms) rather than as a drawing, so a typed measurement can correct it. The
-- revision goes up with every save; a save made against an older revision is
-- refused, so two open editors never overwrite each other's corrections.
--
-- Named versions are full copies of the geometry, so restoring one returns
-- exactly what was saved. The corrections log keeps one line per change, with
-- who made it and when.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS floor_plans (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    geometry JSONB NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS floor_plan_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL,
    geometry JSONB NOT NULL,
    created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_floor_plan_versions_project ON floor_plan_versions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS floor_plan_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    summary VARCHAR(1000) NOT NULL,
    revision INTEGER NOT NULL,
    created_by VARCHAR(255) REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_floor_plan_corrections_project ON floor_plan_corrections(project_id, created_at DESC);
